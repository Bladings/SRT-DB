import React, { useState, useEffect, useRef } from 'react';
import { Search, Filter, RefreshCw, Database, FileText, BarChart3, Settings, AlertCircle, CheckCircle2, Download, Trash2, XCircle } from 'lucide-react';

interface Report {
  id: number;
  title: string;
  url: string;
  date: string;
  type: string;
  summary: string;
  created_at: string;
  structured_data?: string;
}

interface Stats {
  total: number;
  extractedCount: number;
  byType: { type: string; count: number }[];
}

import { GoogleGenAI, Type } from '@google/genai';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, extractedCount: 0, byType: [] });
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  
  const [showSettings, setShowSettings] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [scrapeResult, setScrapeResult] = useState<{success: boolean, message: string} | null>(null);

  const stopExtractionRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoring(true);
    setScrapeResult({ success: true, message: 'Processing backup file locally...' });

    try {
      const text = await file.text();
      let reportsData;
      
      try {
        reportsData = JSON.parse(text);
      } catch (parseError) {
        throw new Error('Invalid JSON format. Please make sure you selected the .json backup file.');
      }
      
      if (!Array.isArray(reportsData)) {
        throw new Error('Backup file must contain an array of reports.');
      }

      const total = reportsData.length;
      setScrapeResult({ success: true, message: `Starting upload of ${total} reports in batches...` });
      
      const BATCH_SIZE = 50;
      let totalRestored = 0;

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = reportsData.slice(i, i + BATCH_SIZE);
        const isFirstBatch = i === 0;

        const res = await fetch('/api/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clear: isFirstBatch,
            reports: batch
          })
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Server error (${res.status}): ${errorText.substring(0, 100)}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to restore backup batch');
        }

        totalRestored += batch.length;
        setScrapeResult({ success: true, message: `Restoring... (${totalRestored}/${total})` });
        
        // Small delay to ensure the server has time to process the transaction
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setScrapeResult({ success: true, message: `Successfully restored ${total} reports from backup!` });
      fetchReports();
      fetchStats();
    } catch (error: any) {
      console.error('Restore error:', error);
      setScrapeResult({ success: false, message: error.message || 'Error restoring backup' });
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (typeFilter !== 'All') params.append('type', typeFilter);
      
      const res = await fetch(`/api/reports?${params.toString()}`);
      const data = await res.json();
      setReports(data);
    } catch (error) {
      console.error('Failed to fetch reports', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats', error);
    }
  };

  useEffect(() => {
    fetchReports();
    fetchStats();
  }, [search, typeFilter]);

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    setScraping(true);
    setScrapeResult(null);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        setScrapeResult({ success: true, message: `Found ${data.totalFound} reports. Inserted ${data.newInserted} new reports.` });
        fetchReports();
        fetchStats();
      } else {
        setScrapeResult({ success: false, message: data.error || 'Failed to scrape' });
      }
    } catch (error: any) {
      setScrapeResult({ success: false, message: error.message || 'Network error' });
    } finally {
      setScraping(false);
    }
  };

  const handleDeleteScraped = async () => {
    // Note: confirm dialogs are blocked in this iframe environment, so we proceed directly
    setScrapeResult({ success: true, message: 'Deleting all scraped reports...' });
    try {
      const res = await fetch('/api/reports', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setScrapeResult({ success: true, message: data.message });
        fetchReports();
        fetchStats();
      } else {
        setScrapeResult({ success: false, message: data.error || 'Failed to delete data' });
      }
    } catch (error: any) {
      setScrapeResult({ success: false, message: error.message || 'Network error' });
    }
  };

  const handleDeleteExtracted = async () => {
    // Note: confirm dialogs are blocked in this iframe environment, so we proceed directly
    setScrapeResult({ success: true, message: 'Clearing all extracted data...' });
    try {
      const res = await fetch('/api/reports/extracted', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setScrapeResult({ success: true, message: data.message });
        fetchReports();
        fetchStats();
      } else {
        setScrapeResult({ success: false, message: data.error || 'Failed to clear data' });
      }
    } catch (error: any) {
      setScrapeResult({ success: false, message: error.message || 'Network error' });
    }
  };

  const handleStopExtraction = () => {
    stopExtractionRef.current = true;
    setScrapeResult({ success: true, message: 'Stopping extraction after current batch...' });
  };

  const handleEnrich = async () => {
    setEnriching(true);
    stopExtractionRef.current = false;
    setScrapeResult({ success: true, message: 'Starting extraction process for all reports...' });
    
    let totalProcessed = 0;
    let hasMore = true;

    try {
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });

      while (hasMore) {
        if (stopExtractionRef.current) {
          setScrapeResult({ success: true, message: `Extraction stopped by user. Processed ${totalProcessed} reports.` });
          break;
        }

        // 1. Fetch unenriched reports from backend
        const params = new URLSearchParams();
        if (username) params.append('username', username);
        if (password) params.append('password', password);
        
        const res = await fetch(`/api/reports/unenriched?${params.toString()}`);
        const data = await res.json();
        
        if (!data.reports || data.reports.length === 0) {
          hasMore = false;
          break;
        }

        const batchToProcess = data.reports;
        
        if (batchToProcess.length === 0) {
          hasMore = false;
          break;
        }

        setScrapeResult({ success: true, message: `Extracting data... (Processed ${totalProcessed} so far, working on next batch of ${batchToProcess.length}. Please keep this tab open.)` });

        const updates = [];

        // 2. Process each report
        for (const report of batchToProcess) {
          if (stopExtractionRef.current) break;

          try {
            let schemaProperties: any = {};
            if (report.type === 'Deal News' || report.type === 'Pipeline News') {
              schemaProperties = {
                MONTH: { type: Type.STRING },
                YEAR: { type: Type.STRING },
                "TRANSACTION NAME": { type: Type.STRING },
                ORIGINATOR: { type: Type.STRING },
                "TRANCHE TYPE": { type: Type.STRING },
                CURRENCY: { type: Type.STRING },
                "TRANCHE AMOUNT (millions)": { type: Type.NUMBER },
                "ATTACHMENT POINT (%)": { type: Type.NUMBER },
                "DETACHMENT POINT (%)": { type: Type.NUMBER },
                PRICING: { type: Type.STRING },
                "PORTFOLIO SIZE (millions)": { type: Type.NUMBER },
                "ASSET CLASS": { type: Type.STRING },
                JURISDICTION: { type: Type.STRING },
                "PORTFOLIO WAL": { type: Type.STRING },
                "PORTFOLIO/CAPITAL CALCULATION APPROACH": { type: Type.STRING },
                "AMORTIZATION STRUCTURE": { type: Type.STRING },
                "DEAL STRUCTURE": { type: Type.STRING },
                "BILATERAL/SYNDICATED": { type: Type.STRING },
                "EXCESS SPREAD": { type: Type.STRING },
                "NUMBER OF BORROWERS": { type: Type.NUMBER },
                "CALL DATE": { type: Type.STRING },
                STS: { type: Type.STRING },
                INVESTOR: { type: Type.STRING },
                ARRANGER: { type: Type.STRING },
              };
            } else {
              schemaProperties = {
                "KEY TAKEAWAYS": { type: Type.ARRAY, items: { type: Type.STRING } },
                "MAIN TOPIC": { type: Type.STRING },
                "COMPANIES MENTIONED": { type: Type.ARRAY, items: { type: Type.STRING } },
              };
            }

            const prompt = `
            Extract the following information from the article text.
            If a field is not mentioned, leave it empty or null.
            
            CRITICAL FORMATTING RULES:
            - CURRENCY: Always use standard 3-letter ISO codes (e.g., USD, EUR, GBP). Do not use symbols like $ or £.
            - AMOUNTS (millions): If the field specifies "(millions)", output the raw number in millions (e.g., for $1.5 billion, output 1500; for $50 million, output 50).
            - PERCENTAGES: Output as a raw number without the '%' symbol (e.g., 5.5).
            - DATES/MONTHS: Standardize months to full names (e.g., "January", "February") and years to 4 digits (e.g., "2024").
            - BILATERAL/SYNDICATED: Output exactly "Bilateral" or "Syndicated" if known.
            - TEXT: Keep names and text clean, without trailing punctuation or unnecessary whitespace.
            
            Article Text:
            ${report.content}
            `;

            const aiResponse = await ai.models.generateContent({
              model: selectedModel,
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: schemaProperties
                }
              }
            });

            updates.push({
              id: report.id,
              structured_data: aiResponse.text
            });
            
            // 5 second delay to stay under the 15 Requests Per Minute free tier limit
            await new Promise(resolve => setTimeout(resolve, 5000));
          } catch (e) {
            console.error(`Error enriching report ${report.id}:`, e);
            // Extra delay on error (likely rate limit)
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }

        // 3. Send updates back to backend
        if (updates.length > 0) {
          const updateRes = await fetch('/api/reports/enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates })
          });
          const updateData = await updateRes.json();
          
          if (updateData.success) {
            totalProcessed += updateData.updatedCount;
          }
        }
      }

      if (!stopExtractionRef.current) {
        if (totalProcessed > 0) {
          setScrapeResult({ success: true, message: `Finished! Successfully extracted data for all ${totalProcessed} reports.` });
        } else {
          setScrapeResult({ success: true, message: 'All reports are already enriched.' });
        }
      }
    } catch (error: any) {
      setScrapeResult({ success: false, message: error.message || 'Network error' });
    } finally {
      setEnriching(false);
      fetchReports();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Database className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Financial Reports DB</h1>
          </div>
          <div className="flex items-center space-x-2">
            <a 
              href="/api/export"
              download
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-full transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </a>
            <button 
              onClick={() => {
                setShowSettings(!showSettings);
                setScrapeResult(null);
              }}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Settings / Scraper Panel */}
        {showSettings && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-top-4 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-indigo-600" />
                Data Synchronisation
              </h2>
            </div>
            
            <form onSubmit={handleScrape} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Username (Optional)</label>
                  <input 
                    type="text" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="For protected reports"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Password (Optional)</label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">AI Model</label>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white"
                  >
                    <option value="gemini-3-flash-preview">Gemini 3 Flash (Default)</option>
                    <option value="gemini-flash-latest">Gemini 1.5 Flash</option>
                    <option value="gemini-flash-lite-latest">Gemini Flash Lite</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                  </select>
                </div>
              </div>
              
              <div className="flex items-center justify-between pt-2">
                <div className="flex-1">
                </div>
                <div className="flex gap-2">
                  {enriching && (
                    <button 
                      type="button"
                      onClick={handleStopExtraction}
                      className="bg-rose-100 hover:bg-rose-200 text-rose-700 px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                      <XCircle className="w-4 h-4" /> Stop
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={handleEnrich}
                    disabled={enriching || scraping || restoring}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {enriching ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Extracting...</>
                    ) : (
                      <><Database className="w-4 h-4" /> Extract Data</>
                    )}
                  </button>
                  <button 
                    type="submit" 
                    disabled={scraping || enriching || restoring}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {scraping ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Scraping...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Run Scraper</>
                    )}
                  </button>
                </div>
              </div>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-500" />
                Backup & Restore
              </h3>
              <p className="text-xs text-slate-500 mb-4">Save your progress to a file so you can restore it later if the server resets.</p>
              
              {scrapeResult && (
                <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${scrapeResult.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                  {scrapeResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {scrapeResult.message}
                </div>
              )}

              <div className="flex flex-wrap gap-3 mb-8">
                <a
                  href="/api/backup"
                  download="financial_database_backup.json"
                  className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  Download Backup File
                </a>
                <input 
                  type="file" 
                  accept=".json" 
                  ref={fileInputRef} 
                  onChange={handleRestore} 
                  className="hidden" 
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={enriching || scraping || restoring}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {restoring ? 'Restoring...' : 'Restore from Backup'}
                </button>
              </div>

              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-500" />
                Danger Zone
              </h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDeleteExtracted}
                  disabled={enriching || scraping || restoring}
                  className="px-4 py-2 text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  Clear All Extracted Data
                </button>
                <button
                  onClick={handleDeleteScraped}
                  disabled={enriching || scraping || restoring}
                  className="px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  Delete All Scraped Reports
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center space-x-4">
            <div className="bg-indigo-50 p-3 rounded-xl">
              <FileText className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Total Reports</p>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center space-x-4">
            <div className="bg-emerald-50 p-3 rounded-xl">
              <Database className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-500">Extraction Progress</p>
              <div className="flex items-end justify-between mb-1">
                <p className="text-2xl font-bold text-slate-900">{stats.extractedCount} <span className="text-sm font-normal text-slate-500">/ {stats.total}</span></p>
                <span className="text-sm font-medium text-emerald-600">{stats.total > 0 ? Math.round((stats.extractedCount / stats.total) * 100) : 0}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full transition-all duration-500" style={{ width: `${stats.total > 0 ? (stats.extractedCount / stats.total) * 100 : 0}%` }}></div>
              </div>
            </div>
          </div>
          
          {stats.byType.slice(0, 2).map((stat, idx) => (
            <div key={stat.type} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center space-x-4">
              <div className="bg-emerald-50 p-3 rounded-xl">
                <BarChart3 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">{stat.type || 'Uncategorized'}</p>
                <p className="text-2xl font-bold text-slate-900">{stat.count}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div className="relative w-full sm:w-96">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search reports..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </div>
          
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="w-5 h-5 text-slate-400" />
            <select 
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full sm:w-auto bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            >
              <option value="All">All Categories</option>
              {stats.byType.map(stat => (
                <option key={stat.type} value={stat.type}>{stat.type || 'Uncategorized'}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reports List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900">No reports found</h3>
              <p className="text-slate-500 mt-1">Try adjusting your search or run the scraper to fetch data.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reports.map((report) => (
                <div key={report.id} className="block p-6 hover:bg-slate-50 transition-colors group">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                          {report.type || 'Publication'}
                        </span>
                        {report.date && (
                          <span className="text-xs text-slate-500">{report.date}</span>
                        )}
                        {report.structured_data && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            Data Extracted
                          </span>
                        )}
                      </div>
                      <a 
                        href={report.url.startsWith('http') ? report.url : `https://rtraintelligence.com${report.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-lg font-semibold text-slate-900 hover:text-indigo-600 transition-colors mb-2 block"
                      >
                        {report.title}
                      </a>
                      {report.summary && (
                        <p className="text-sm text-slate-600 line-clamp-2 mb-3">{report.summary}</p>
                      )}
                      
                      {report.structured_data && (
                        <div className="mt-4">
                          <button
                            onClick={() => setExpandedReportId(expandedReportId === report.id ? null : report.id)}
                            className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                          >
                            {expandedReportId === report.id ? (
                              <><ChevronUp className="w-4 h-4" /> Hide Extracted Data</>
                            ) : (
                              <><ChevronDown className="w-4 h-4" /> View Extracted Data</>
                            )}
                          </button>
                          
                          {expandedReportId === report.id && (
                            <div className="mt-3 p-4 bg-slate-100 rounded-xl border border-slate-200 text-sm">
                              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                                {Object.entries(JSON.parse(report.structured_data)).map(([key, value]) => {
                                  if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
                                  return (
                                    <div key={key} className="flex flex-col">
                                      <dt className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{key}</dt>
                                      <dd className="text-slate-900 font-mono text-xs">
                                        {Array.isArray(value) ? (
                                          <ul className="list-disc pl-4 space-y-1">
                                            {value.map((item, i) => <li key={i}>{item}</li>)}
                                          </ul>
                                        ) : (
                                          String(value)
                                        )}
                                      </dd>
                                    </div>
                                  );
                                })}
                              </dl>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
