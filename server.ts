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

// Add structured_data column if it doesn't exist (for existing databases)
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

async function scrapeReports(username?: string, password?: string) {
  try {
    const axiosInstance = axios.create({
      baseURL: 'https://rtraintelligence.com',
      withCredentials: true,
    });

    let cookies: string[] = [];

    if (username && password) {
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
      } catch (err: any) {
        if (err.response && err.response.status === 302) {
          cookies = err.response.headers['set-cookie'] || [];
        } else {
          throw err;
        }
      }
    }

    const cookieHeader = cookies.length > 0 ? cookies.map(c => c.split(';')[0]).join('; ') : '';
    const reports: any[] = [];
    
    const categories = [
      '/publication-type/deal-news/',
      '/publication-type/pipeline-news/',
      '/publication-type/market-analysis/',
      '/publication-type/regulatory-analysis/'
    ];

    for (const cat of categories) {
      let page = 1;
      let hasMore = true;
      
      while (hasMore) { 
        try {
          const url = page === 1 ? cat : `${cat}?jsf=jet-engine:allpublication&pagenum=${page}`;
          const catRes = await axiosInstance.get(url, {
            headers: cookieHeader ? { Cookie: cookieHeader } : {}
          });
          const $cat = cheerio.load(catRes.data);
          
          let pageArticlesFound = 0;
          $cat('.jet-listing-grid__item').each((i, el) => {
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
              reports.push({ title, url: articleUrl, date, summary, type: type || cat.split('/')[2].replace('-', ' ') });
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

    // Insert into database
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


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ limit: '500mb', extended: true }));

  // API Routes
  app.get('/api/reports', (req, res) => {
    try {
      const { type, search } = req.query;
      let query = 'SELECT * FROM reports WHERE 1=1';
      const params: any[] = [];

      if (type && type !== 'All') {
        query += ' AND type = ?';
        params.push(type);
      }

      if (search) {
        query += ' AND (title LIKE ? OR summary LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      query += ' ORDER BY id DESC';
      
      const reports = db.prepare(query).all(...params);
      res.json(reports);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch reports' });
    }
  });

  app.post('/api/scrape', async (req, res) => {
    const { username, password } = req.body;
    const result = await scrapeReports(username, password);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  });

  app.get('/api/stats', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*) as count FROM reports').get() as { count: number };
      const extracted = db.prepare('SELECT COUNT(*) as count FROM reports WHERE structured_data IS NOT NULL').get() as { count: number };
      const byType = db.prepare('SELECT type, COUNT(*) as count FROM reports GROUP BY type').all();
      res.json({ total: total.count, extractedCount: extracted.count, byType });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  app.get('/api/backup', (req, res) => {
    try {
      const reports = db.prepare('SELECT * FROM reports').all();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=financial_database_backup.json');
      res.send(JSON.stringify(reports));
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

      // Clear existing data if requested
      if (shouldClear) {
        db.prepare('DELETE FROM reports').run();
      }

      const insert = db.prepare(`
        INSERT OR REPLACE INTO reports (id, title, url, date, type, summary, content, structured_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((items) => {
        for (const item of items) {
          if (!item.title || !item.url) continue; // Skip invalid rows
          
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
      res.json({ success: true, message: `Successfully restored ${reports.length} reports from backup.` });
    } catch (error: any) {
      console.error('Restore error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/reports/unenriched', async (req, res) => {
    try {
      const { username, password } = req.query;
      const reportsToEnrich = db.prepare('SELECT id, url, type FROM reports WHERE structured_data IS NULL LIMIT 10').all() as any[];
      
      if (reportsToEnrich.length === 0) {
        return res.json({ reports: [] });
      }

      const axiosInstance = axios.create({
        baseURL: 'https://rtraintelligence.com',
        withCredentials: true,
      });

      let cookies: string[] = [];
      if (username && password) {
        const loginData = new URLSearchParams();
        loginData.append('log', username as string);
        loginData.append('pwd', password as string);
        loginData.append('wp-submit', 'Log In');
        loginData.append('redirect_to', 'https://rtraintelligence.com/publications/');
        loginData.append('jet_login', '1');

        try {
          await axiosInstance.post('/members-area/', loginData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            maxRedirects: 0,
          });
        } catch (err: any) {
          if (err.response && err.response.status === 302) {
            cookies = err.response.headers['set-cookie'] || [];
          }
        }
      }

      const cookieHeader = cookies.length > 0 ? cookies.map(c => c.split(';')[0]).join('; ') : '';
      const updateContent = db.prepare('UPDATE reports SET content = ? WHERE id = ?');

      const reportsWithContent = [];
      for (const report of reportsToEnrich) {
        try {
          const catRes = await axiosInstance.get(report.url, {
            headers: cookieHeader ? { Cookie: cookieHeader } : {}
          });
          const $ = cheerio.load(catRes.data);
          const content = $('.elementor-widget-theme-post-content').text().trim() || $('.entry-content').text().trim() || $('main').text().trim();
          
          if (content) {
            updateContent.run(content, report.id);
            reportsWithContent.push({ ...report, content });
          }
        } catch (e) {
          console.error(`Error fetching content for report ${report.id}:`, e);
        }
      }

      res.json({ reports: reportsWithContent });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/reports/enrich', (req, res) => {
    try {
      const { updates } = req.body;
      if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: 'Invalid updates format' });
      }

      const updateReport = db.prepare('UPDATE reports SET structured_data = ? WHERE id = ?');
      let updatedCount = 0;

      const updateMany = db.transaction((items) => {
        for (const item of items) {
          const result = updateReport.run(item.structured_data, item.id);
          if (result.changes > 0) updatedCount++;
        }
      });

      updateMany(updates);
      res.json({ success: true, updatedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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

  app.get('/api/export', async (req, res) => {
    try {
      const reports = db.prepare('SELECT * FROM reports ORDER BY id DESC').all() as any[];
      
      if (reports.length === 0) {
        return res.status(404).send('No data to export');
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Financial Reports DB';
      workbook.lastModifiedBy = 'Financial Reports DB';
      workbook.created = new Date();

      // Group reports by type
      const reportsByType: Record<string, any[]> = {};
      for (const report of reports) {
        const type = report.type || 'Other';
        if (!reportsByType[type]) {
          reportsByType[type] = [];
        }
        reportsByType[type].push(report);
      }

      for (const [type, typeReports] of Object.entries(reportsByType)) {
        // Create a valid sheet name (max 31 chars, no special chars)
        const sheetName = type.replace(/[\\/*?:\[\]]/g, '').substring(0, 31);
        const sheet = workbook.addWorksheet(sheetName);

        // Determine columns based on type
        let columns: any[] = [];
        
        if (type === 'Deal News' || type === 'Pipeline News') {
          columns = [
            { header: 'MONTH', key: 'MONTH', width: 15 },
            { header: 'YEAR', key: 'YEAR', width: 10 },
            { header: 'TRANSACTION NAME', key: 'TRANSACTION NAME', width: 30 },
            { header: 'ORIGINATOR', key: 'ORIGINATOR', width: 20 },
            { header: 'TRANCHE TYPE', key: 'TRANCHE TYPE', width: 20 },
            { header: 'CURRENCY', key: 'CURRENCY', width: 15 },
            { header: 'TRANCHE AMOUNT (millions)', key: 'TRANCHE AMOUNT (millions)', width: 25 },
            { header: 'ATTACHMENT POINT (%)', key: 'ATTACHMENT POINT (%)', width: 25 },
            { header: 'DETACHMENT POINT (%)', key: 'DETACHMENT POINT (%)', width: 25 },
            { header: 'PRICING', key: 'PRICING', width: 20 },
            { header: 'PORTFOLIO SIZE (millions)', key: 'PORTFOLIO SIZE (millions)', width: 25 },
            { header: 'ASSET CLASS', key: 'ASSET CLASS', width: 20 },
            { header: 'JURISDICTION', key: 'JURISDICTION', width: 20 },
            { header: 'PORTFOLIO WAL', key: 'PORTFOLIO WAL', width: 20 },
            { header: 'PORTFOLIO/CAPITAL CALCULATION APPROACH', key: 'PORTFOLIO/CAPITAL CALCULATION APPROACH', width: 40 },
            { header: 'AMORTIZATION STRUCTURE', key: 'AMORTIZATION STRUCTURE', width: 25 },
            { header: 'DEAL STRUCTURE', key: 'DEAL STRUCTURE', width: 20 },
            { header: 'BILATERAL/SYNDICATED', key: 'BILATERAL/SYNDICATED', width: 25 },
            { header: 'EXCESS SPREAD', key: 'EXCESS SPREAD', width: 20 },
            { header: 'NUMBER OF BORROWERS', key: 'NUMBER OF BORROWERS', width: 25 },
            { header: 'CALL DATE', key: 'CALL DATE', width: 20 },
            { header: 'STS', key: 'STS', width: 15 },
            { header: 'INVESTOR', key: 'INVESTOR', width: 20 },
            { header: 'ARRANGER', key: 'ARRANGER', width: 20 },
            { header: 'URL', key: 'url', width: 40 },
          ];
        } else {
          columns = [
            { header: 'TITLE', key: 'title', width: 40 },
            { header: 'DATE', key: 'date', width: 20 },
            { header: 'MAIN TOPIC', key: 'MAIN TOPIC', width: 30 },
            { header: 'KEY TAKEAWAYS', key: 'KEY TAKEAWAYS', width: 50 },
            { header: 'COMPANIES MENTIONED', key: 'COMPANIES MENTIONED', width: 30 },
            { header: 'SUMMARY', key: 'summary', width: 50 },
            { header: 'URL', key: 'url', width: 40 },
          ];
        }

        sheet.columns = columns;

        // Make header row bold
        sheet.getRow(1).font = { bold: true };

        // Add data
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
              
              // Handle arrays (like KEY TAKEAWAYS) by joining them
              for (const [k, v] of Object.entries(parsed)) {
                if (Array.isArray(v)) {
                  rowData[k] = v.join('\\n• ');
                  if (rowData[k]) rowData[k] = '• ' + rowData[k];
                } else {
                  rowData[k] = v;
                }
              }
            } catch (e) {
              console.error('Failed to parse structured data for report', report.id);
            }
          }

          sheet.addRow(rowData);
        }
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="financial-reports.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Failed to export data' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
