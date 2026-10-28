import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('reports.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    date TEXT,
    type TEXT,
    summary TEXT,
    content TEXT,
    structured_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add structured_data and content columns if they don't exist
try {
  db.exec('ALTER TABLE reports ADD COLUMN structured_data TEXT');
} catch (e) {
  // Column already exists
}
try {
  db.exec('ALTER TABLE reports ADD COLUMN content TEXT');
} catch (e) {
  // Column already exists
}

// Server-side Gemini client initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Extraction Schema Definitions
const DEAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    MONTH: { type: Type.STRING, description: 'Full month name (e.g. January, October)' },
    YEAR: { type: Type.STRING, description: '4-digit year (e.g. 2024)' },
    'TRANSACTION NAME': { type: Type.STRING, description: 'Name of the securitisation or SRT deal' },
    ORIGINATOR: { type: Type.STRING, description: 'Originator bank or financial institution' },
    'TRANCHE TYPE': { type: Type.STRING, description: 'Tranche type (e.g. Mezzanine, Senior, First Loss)' },
    CURRENCY: { type: Type.STRING, description: '3-letter ISO currency code (USD, EUR, GBP)' },
    'TRANCHE AMOUNT (millions)': { type: Type.NUMBER, description: 'Tranche amount in millions (pure number, e.g. 150 for 150M, 1200 for 1.2B)' },
    'ATTACHMENT POINT (%)': { type: Type.NUMBER, description: 'Attachment point as a number (e.g. 1.5 for 1.5%)' },
    'DETACHMENT POINT (%)': { type: Type.NUMBER, description: 'Detachment point as a number (e.g. 8.5 for 8.5%)' },
    PRICING: { type: Type.STRING, description: 'Pricing spread or margin (e.g. 950 bps, Euribor + 8%)' },
    'PORTFOLIO SIZE (millions)': { type: Type.NUMBER, description: 'Total portfolio size in millions' },
    'ASSET CLASS': { type: Type.STRING, description: 'Asset class (e.g. Large Corporate, SME, CRE, Residential)' },
    JURISDICTION: { type: Type.STRING, description: 'Country or geographic jurisdiction' },
    'PORTFOLIO WAL': { type: Type.STRING, description: 'Weighted average life' },
    'PORTFOLIO/CAPITAL CALCULATION APPROACH': { type: Type.STRING, description: 'Regulatory approach (e.g. IRB, SEC-ERBA, Standardised)' },
    'AMORTIZATION STRUCTURE': { type: Type.STRING, description: 'Pro-rata, Sequential, etc.' },
    'DEAL STRUCTURE': { type: Type.STRING, description: 'Synthetic, True Sale, CLN, Financial Guarantee' },
    'BILATERAL/SYNDICATED': { type: Type.STRING, description: 'Bilateral or Syndicated' },
    'EXCESS SPREAD': { type: Type.STRING, description: 'Excess spread structure' },
    'NUMBER OF BORROWERS': { type: Type.NUMBER, description: 'Number of borrowers or loans' },
    'CALL DATE': { type: Type.STRING, description: 'Call date or time to call' },
    STS: { type: Type.STRING, description: 'STS status: Yes / No / Compliant' },
    INVESTOR: { type: Type.STRING, description: 'Investor(s) involved' },
    ARRANGER: { type: Type.STRING, description: 'Arranger or financial advisor' },
  },
};

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    'MAIN TOPIC': { type: Type.STRING, description: 'Primary topic of the analysis' },
    'KEY TAKEAWAYS': { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Core takeaways or strategic insights' },
    'COMPANIES MENTIONED': { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Banks, funds, or organizations mentioned' },
    'REGULATORY FRAMEWORK': { type: Type.STRING, description: 'Relevant regulations (e.g. Basel IV, CRT, CRR, SRT guidelines)' },
    'MARKET SENTIMENT': { type: Type.STRING, description: 'Market sentiment: Bullish, Bearish, Cautious, Stable, or Expanding' },
  },
};

// Helper: authenticate with rtraintelligence.com
async function getAuthCookies(username?: string, password?: string): Promise<string> {
  if (!username || !password) return '';

  const axiosInstance = axios.create({
    baseURL: 'https://rtraintelligence.com',
    withCredentials: true,
  });

  const loginData = new URLSearchParams();
  loginData.append('log', username);
  loginData.append('pwd', password);
  loginData.append('wp-submit', 'Log In');
  loginData.append('redirect_to', 'https://rtraintelligence.com/publications/');
  loginData.append('jet_login', '1');

  try {
    await axiosInstance.post('/members-area/', loginData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      maxRedirects: 0,
    });
    return '';
  } catch (err: any) {
    if (err.response && err.response.status === 302) {
      const cookies = err.response.headers['set-cookie'] || [];
      return cookies.map((c: string) => c.split(';')[0]).join('; ');
    }
    return '';
  }
}

// Scrape reports list
async function scrapeReports(username?: string, password?: string) {
  try {
    const axiosInstance = axios.create({
      baseURL: 'https://rtraintelligence.com',
      withCredentials: true,
    });

    const cookieHeader = await getAuthCookies(username, password);
    const reports: any[] = [];

    const categories = [
      '/publication-type/deal-news/',
      '/publication-type/pipeline-news/',
      '/publication-type/market-analysis/',
      '/publication-type/regulatory-analysis/',
    ];

    for (const cat of categories) {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        try {
          const url = page === 1 ? cat : `${cat}?jsf=jet-engine:allpublication&pagenum=${page}`;
          const catRes = await axiosInstance.get(url, {
            headers: cookieHeader ? { Cookie: cookieHeader } : {},
          });
          const $cat = cheerio.load(catRes.data);

          let pageArticlesFound = 0;
          $cat('.jet-listing-grid__item').each((_, el) => {
            const articleUrl = $cat(el).find('.jet-engine-listing-overlay-link').attr('href');
            const type = $cat(el).find('.jet-listing-dynamic-terms__link').text().trim();

            const fields = $cat(el).find('.jet-listing-dynamic-field__content');
            const title = $cat(fields[0]).text().trim();
            let date = $cat(fields[1]).text().trim();
            const summary = $cat(fields[2]).text().trim();

            if (date.startsWith('Published: ')) {
              date = date.replace('Published: ', '');
            }

            if (title && articleUrl) {
              reports.push({
                title,
                url: articleUrl,
                date,
                summary,
                type: type || cat.split('/')[2].replace('-', ' '),
              });
              pageArticlesFound++;
            }
          });

          if (pageArticlesFound === 0) {
            hasMore = false;
          } else {
            page++;
          }
        } catch (e) {
          console.error(`Error scraping category ${cat} page ${page}:`, e);
          hasMore = false;
        }
      }
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO reports (title, url, date, type, summary)
      VALUES (?, ?, ?, ?, ?)
    `);

    let insertedCount = 0;
    const insertMany = db.transaction((reportsToInsert) => {
      for (const report of reportsToInsert) {
        const result = insert.run(report.title, report.url, report.date, report.type, report.summary);
        if (result.changes > 0) insertedCount++;
      }
    });

    insertMany(reports);
    return { success: true, totalFound: reports.length, newInserted: insertedCount };
  } catch (error: any) {
    console.error('Scraping error:', error);
    return { success: false, error: error.message };
  }
}

// Fetch article full content if not already stored
async function getArticleContent(report: any, cookieHeader: string): Promise<string> {
  if (report.content && report.content.trim().length > 50) {
    return report.content;
  }

  try {
    const res = await axios.get(report.url, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      timeout: 10000,
    });
    const $ = cheerio.load(res.data);
    const content =
      $('.elementor-widget-theme-post-content').text().trim() ||
      $('.entry-content').text().trim() ||
      $('main').text().trim();

    if (content) {
      db.prepare('UPDATE reports SET content = ? WHERE id = ?').run(content, report.id);
      return content;
    }
  } catch (err: any) {
    console.error(`Failed to fetch article content for report ${report.id}:`, err.message);
  }

  return report.summary || report.title;
}

// Extract single report structured data
async function extractReportStructuredData(reportId: number, modelName = 'gemini-3.8-flash', cookieHeader = '') {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('API key is not configured. Please set GEMINI_API_KEY in your .env file or environment variables.');
  }

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as any;
  if (!report) {
    throw new Error(`Report #${reportId} not found`);
  }

  const content = await getArticleContent(report, cookieHeader);
  const isDeal = report.type === 'Deal News' || report.type === 'Pipeline News';
  const schema = isDeal ? DEAL_SCHEMA : ANALYSIS_SCHEMA;

  const prompt = `
Extract structured financial data from the following report.
If a field is not mentioned or unknown, set it to null.

CRITICAL FINANCIAL EXTRACTION RULES:
- CURRENCY: Standard 3-letter ISO code (e.g., USD, EUR, GBP). Do not use currency symbols.
- AMOUNTS (millions): Convert amounts to raw numbers in millions (e.g., $1.5 billion -> 1500; €75 million -> 75).
- PERCENTAGES: Format as a raw number without '%' symbol (e.g., 8.25).
- DATES/MONTHS: Use full month name (e.g., "September") and 4-digit year (e.g., "2024").
- STRUCTURE: Clean labels, no trailing punctuation.

Report Title: ${report.title}
Report Date: ${report.date || 'Unknown'}
Report Category: ${report.type || 'General'}

Article Content:
${content}
`;

  const aiResponse = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.1,
    },
  });

  const structuredDataText = aiResponse.text?.trim() || '{}';
  db.prepare('UPDATE reports SET structured_data = ? WHERE id = ?').run(structuredDataText, reportId);

  return {
    id: reportId,
    structured_data: structuredDataText,
  };
}

// Background Batch Extraction State
const batchExtractionState = {
  running: false,
  stopRequested: false,
  totalToProcess: 0,
  processedCount: 0,
  currentReportTitle: '',
  lastError: null as string | null,
  startedAt: null as string | null,
};

async function runBatchExtractionWorker(username?: string, password?: string, modelName = 'gemini-3.8-flash') {
  if (batchExtractionState.running) return;

  batchExtractionState.running = true;
  batchExtractionState.stopRequested = false;
  batchExtractionState.lastError = null;
  batchExtractionState.startedAt = new Date().toISOString();
  batchExtractionState.processedCount = 0;

  try {
    const cookieHeader = await getAuthCookies(username, password);
    const unenriched = db.prepare('SELECT id, title, type, url, content, summary FROM reports WHERE structured_data IS NULL').all() as any[];

    batchExtractionState.totalToProcess = unenriched.length;

    for (const report of unenriched) {
      if (batchExtractionState.stopRequested) {
        break;
      }

      batchExtractionState.currentReportTitle = report.title;

      let retries = 0;
      let success = false;

      while (!success && retries < 3 && !batchExtractionState.stopRequested) {
        try {
          await extractReportStructuredData(report.id, modelName, cookieHeader);
          batchExtractionState.processedCount++;
          success = true;

          // Safe delay to stay well under rate limits while keeping throughput high
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (err: any) {
          retries++;
          console.error(`Error processing report #${report.id} (attempt ${retries}):`, err.message);
          batchExtractionState.lastError = `Report #${report.id}: ${err.message}`;
          // Wait longer on error/rate limit
          await new Promise((resolve) => setTimeout(resolve, 6000));
        }
      }
    }
  } catch (error: any) {
    console.error('Fatal error in batch extraction worker:', error);
    batchExtractionState.lastError = error.message;
  } finally {
    batchExtractionState.running = false;
    batchExtractionState.stopRequested = false;
    batchExtractionState.currentReportTitle = '';
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ limit: '500mb', extended: true }));

  // API Routes

  // 1. Get reports with search and filter
  app.get('/api/reports', (req, res) => {
    try {
      const { type, status, search, sort } = req.query;
      let query = 'SELECT * FROM reports WHERE 1=1';
      const params: any[] = [];

      if (type && type !== 'All') {
        query += ' AND type = ?';
        params.push(type);
      }

      if (status === 'extracted') {
        query += ' AND structured_data IS NOT NULL';
      } else if (status === 'pending') {
        query += ' AND structured_data IS NULL';
      }

      if (search) {
        query += ' AND (title LIKE ? OR summary LIKE ? OR structured_data LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (sort === 'oldest') {
        query += ' ORDER BY id ASC';
      } else {
        query += ' ORDER BY id DESC';
      }

      const reports = db.prepare(query).all(...params);
      res.json(reports);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch reports' });
    }
  });

  // 2. Comprehensive Analytics Stats
  app.get('/api/stats', (req, res) => {
    try {
      const total = (db.prepare('SELECT COUNT(*) as count FROM reports').get() as { count: number }).count;
      const extractedCount = (db.prepare('SELECT COUNT(*) as count FROM reports WHERE structured_data IS NOT NULL').get() as { count: number }).count;
      const byType = db.prepare('SELECT type, COUNT(*) as count FROM reports GROUP BY type').all();

      // Aggregate Deal Volumes and metrics from structured_data
      const extractedRows = db.prepare('SELECT structured_data FROM reports WHERE structured_data IS NOT NULL').all() as { structured_data: string }[];
      let totalTrancheVolumeMillions = 0;
      let totalPortfolioVolumeMillions = 0;
      const originatorsMap: Record<string, number> = {};
      const assetClassesMap: Record<string, number> = {};

      for (const row of extractedRows) {
        try {
          const parsed = JSON.parse(row.structured_data);
          if (parsed['TRANCHE AMOUNT (millions)']) {
            const amt = Number(parsed['TRANCHE AMOUNT (millions)']);
            if (!isNaN(amt)) totalTrancheVolumeMillions += amt;
          }
          if (parsed['PORTFOLIO SIZE (millions)']) {
            const size = Number(parsed['PORTFOLIO SIZE (millions)']);
            if (!isNaN(size)) totalPortfolioVolumeMillions += size;
          }
          if (parsed.ORIGINATOR) {
            const org = String(parsed.ORIGINATOR).trim();
            if (org) originatorsMap[org] = (originatorsMap[org] || 0) + 1;
          }
          if (parsed['ASSET CLASS']) {
            const ac = String(parsed['ASSET CLASS']).trim();
            if (ac) assetClassesMap[ac] = (assetClassesMap[ac] || 0) + 1;
          }
        } catch {
          // ignore unparsable
        }
      }

      const topOriginators = Object.entries(originatorsMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      const topAssetClasses = Object.entries(assetClassesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      res.json({
        total,
        extractedCount,
        byType,
        totalTrancheVolumeMillions: Math.round(totalTrancheVolumeMillions),
        totalPortfolioVolumeMillions: Math.round(totalPortfolioVolumeMillions),
        topOriginators,
        topAssetClasses,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch stats: ' + error.message });
    }
  });

  // 3. Test Credentials
  app.post('/api/test-login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
      }
      const cookieHeader = await getAuthCookies(username, password);
      if (cookieHeader) {
        res.json({ success: true, message: 'Credentials validated successfully. Session established.' });
      } else {
        res.json({ success: false, message: 'Login did not return a session cookie. Check username or password.' });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 4. Scrape Publications
  app.post('/api/scrape', async (req, res) => {
    const { username, password } = req.body;
    const result = await scrapeReports(username, password);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  });

  // 5. Single Report Extraction On-Demand
  app.post('/api/extract/single', async (req, res) => {
    try {
      const { reportId, modelName, username, password } = req.body;
      if (!reportId) {
        return res.status(400).json({ error: 'Missing reportId' });
      }

      const cookieHeader = await getAuthCookies(username, password);
      const result = await extractReportStructuredData(reportId, modelName || 'gemini-3.8-flash', cookieHeader);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('Single extraction error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 6. Start Server-Side Batch Extraction
  app.post('/api/extract/batch/start', async (req, res) => {
    try {
      const { username, password, modelName } = req.body;
      if (batchExtractionState.running) {
        return res.json({
          success: true,
          message: 'Batch extraction is already in progress.',
          state: batchExtractionState,
        });
      }

      // Start asynchronous background runner
      runBatchExtractionWorker(username, password, modelName || 'gemini-3.8-flash');

      res.json({
        success: true,
        message: 'Background extraction started.',
        state: batchExtractionState,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 7. Get Batch Extraction Status
  app.get('/api/extract/batch/status', (req, res) => {
    const remainingCount = (
      db.prepare('SELECT COUNT(*) as count FROM reports WHERE structured_data IS NULL').get() as { count: number }
    ).count;

    res.json({
      ...batchExtractionState,
      remainingCount,
    });
  });

  // 8. Stop Batch Extraction
  app.post('/api/extract/batch/stop', (req, res) => {
    if (batchExtractionState.running) {
      batchExtractionState.stopRequested = true;
      res.json({ success: true, message: 'Stopping batch extraction after current report completes.' });
    } else {
      res.json({ success: true, message: 'Batch extraction is not running.' });
    }
  });

  // 9. Manual Report Update
  app.put('/api/reports/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { title, date, type, summary, structured_data } = req.body;

      db.prepare(`
        UPDATE reports 
        SET title = COALESCE(?, title),
            date = COALESCE(?, date),
            type = COALESCE(?, type),
            summary = COALESCE(?, summary),
            structured_data = COALESCE(?, structured_data)
        WHERE id = ?
      `).run(title, date, type, summary, structured_data, id);

      const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
      res.json({ success: true, report: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 10. Clear Extracted Data or Scraped Data
  app.delete('/api/reports', (req, res) => {
    try {
      db.prepare('DELETE FROM reports').run();
      res.json({ success: true, message: 'All scraped data deleted.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/reports/extracted', (req, res) => {
    try {
      db.prepare('UPDATE reports SET structured_data = NULL').run();
      res.json({ success: true, message: 'All extracted data cleared.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 11. Backup & Restore
  app.get('/api/backup', (req, res) => {
    try {
      const reports = db.prepare('SELECT * FROM reports ORDER BY id ASC').all();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=financial_database_backup.json');
      res.send(JSON.stringify(reports, null, 2));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/restore', (req, res) => {
    try {
      const isArray = Array.isArray(req.body);
      const reports = isArray ? req.body : req.body.reports;
      const shouldClear = isArray ? true : req.body.clear;

      if (!Array.isArray(reports)) {
        return res.status(400).json({ error: 'Invalid backup file format. Expected an array of reports.' });
      }

      if (shouldClear) {
        db.prepare('DELETE FROM reports').run();
      }

      const insert = db.prepare(`
        INSERT OR REPLACE INTO reports (id, title, url, date, type, summary, content, structured_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((items) => {
        for (const item of items) {
          if (!item.title || !item.url) continue;
          insert.run(
            item.id,
            item.title,
            item.url,
            item.date || null,
            item.type || null,
            item.summary || null,
            item.content || null,
            item.structured_data || null,
            item.created_at || new Date().toISOString()
          );
        }
      });

      insertMany(reports);
      res.json({ success: true, message: `Successfully restored ${reports.length} reports.` });
    } catch (error: any) {
      console.error('Restore error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 12. Enhanced Excel Export with Professional Formatting
  app.get('/api/export', async (req, res) => {
    try {
      const reports = db.prepare('SELECT * FROM reports ORDER BY id DESC').all() as any[];

      if (reports.length === 0) {
        return res.status(404).send('No reports to export');
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Financial Intelligence Database';
      workbook.lastModifiedBy = 'Financial Intelligence Database';
      workbook.created = new Date();

      // Summary Cover Sheet
      const summarySheet = workbook.addWorksheet('Summary Overview');
      summarySheet.views = [{ showGridLines: true }];
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 32 },
        { header: 'Value', key: 'value', width: 28 },
      ];
      summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      summarySheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
      };

      const extractedCount = reports.filter((r) => r.structured_data).length;
      summarySheet.addRow({ metric: 'Total Scraped Reports', value: reports.length });
      summarySheet.addRow({ metric: 'Reports with Extracted Data', value: extractedCount });
      summarySheet.addRow({ metric: 'Export Date', value: new Date().toISOString() });

      // Group reports by category
      const reportsByType: Record<string, any[]> = {};
      for (const report of reports) {
        const type = report.type || 'Other';
        if (!reportsByType[type]) {
          reportsByType[type] = [];
        }
        reportsByType[type].push(report);
      }

      for (const [type, typeReports] of Object.entries(reportsByType)) {
        const sheetName = type.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
        const sheet = workbook.addWorksheet(sheetName);
        sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: true }];

        let columns: any[] = [];

        if (type === 'Deal News' || type === 'Pipeline News') {
          columns = [
            { header: 'MONTH', key: 'MONTH', width: 14 },
            { header: 'YEAR', key: 'YEAR', width: 10 },
            { header: 'TRANSACTION NAME', key: 'TRANSACTION NAME', width: 32 },
            { header: 'ORIGINATOR', key: 'ORIGINATOR', width: 24 },
            { header: 'TRANCHE TYPE', key: 'TRANCHE TYPE', width: 18 },
            { header: 'CURRENCY', key: 'CURRENCY', width: 12 },
            { header: 'TRANCHE AMOUNT (M)', key: 'TRANCHE AMOUNT (millions)', width: 22 },
            { header: 'ATTACH POINT (%)', key: 'ATTACHMENT POINT (%)', width: 18 },
            { header: 'DETACH POINT (%)', key: 'DETACHMENT POINT (%)', width: 18 },
            { header: 'PRICING', key: 'PRICING', width: 20 },
            { header: 'PORTFOLIO SIZE (M)', key: 'PORTFOLIO SIZE (millions)', width: 22 },
            { header: 'ASSET CLASS', key: 'ASSET CLASS', width: 20 },
            { header: 'JURISDICTION', key: 'JURISDICTION', width: 18 },
            { header: 'PORTFOLIO WAL', key: 'PORTFOLIO WAL', width: 16 },
            { header: 'CALCULATION APPROACH', key: 'PORTFOLIO/CAPITAL CALCULATION APPROACH', width: 30 },
            { header: 'AMORTIZATION', key: 'AMORTIZATION STRUCTURE', width: 20 },
            { header: 'DEAL STRUCTURE', key: 'DEAL STRUCTURE', width: 20 },
            { header: 'STRUCTURE TYPE', key: 'BILATERAL/SYNDICATED', width: 18 },
            { header: 'EXCESS SPREAD', key: 'EXCESS SPREAD', width: 18 },
            { header: 'NO. OF BORROWERS', key: 'NUMBER OF BORROWERS', width: 18 },
            { header: 'CALL DATE', key: 'CALL DATE', width: 16 },
            { header: 'STS', key: 'STS', width: 12 },
            { header: 'INVESTOR', key: 'INVESTOR', width: 24 },
            { header: 'ARRANGER', key: 'ARRANGER', width: 24 },
            { header: 'SOURCE URL', key: 'url', width: 45 },
          ];
        } else {
          columns = [
            { header: 'TITLE', key: 'title', width: 38 },
            { header: 'DATE', key: 'date', width: 16 },
            { header: 'MAIN TOPIC', key: 'MAIN TOPIC', width: 28 },
            { header: 'KEY TAKEAWAYS', key: 'KEY TAKEAWAYS', width: 55 },
            { header: 'COMPANIES MENTIONED', key: 'COMPANIES MENTIONED', width: 32 },
            { header: 'REGULATORY FRAMEWORK', key: 'REGULATORY FRAMEWORK', width: 26 },
            { header: 'MARKET SENTIMENT', key: 'MARKET SENTIMENT', width: 18 },
            { header: 'SUMMARY', key: 'summary', width: 45 },
            { header: 'SOURCE URL', key: 'url', width: 45 },
          ];
        }

        sheet.columns = columns;

        // Header Styling
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: type === 'Deal News' ? 'FF3730A3' : 'FF065F46' },
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 26;

        for (const report of typeReports) {
          let rowData: any = {
            title: report.title,
            date: report.date,
            summary: report.summary,
            url: report.url,
          };

          if (report.structured_data) {
            try {
              const parsed = JSON.parse(report.structured_data);
              for (const [k, v] of Object.entries(parsed)) {
                if (Array.isArray(v)) {
                  rowData[k] = v.join('\n• ');
                  if (rowData[k]) rowData[k] = '• ' + rowData[k];
                } else {
                  rowData[k] = v;
                }
              }
            } catch (e) {
              console.error('Failed to parse structured data for export', report.id);
            }
          }

          const addedRow = sheet.addRow(rowData);
          addedRow.alignment = { vertical: 'top', wrapText: true };
        }
      }

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="financial-intelligence-reports.xlsx"');

      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Failed to export data: ' + error.message });
    }
  });

  // Vite middleware for development, static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
