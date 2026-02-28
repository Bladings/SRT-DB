import React, { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, Database, FileText, BarChart3, Settings, AlertCircle, CheckCircle2, Download } from 'lucide-react';

interface Report {
  id: number;
  title: string;
  url: string;
  date: string;
  type: string;
  summary: string;
  created_at: string;
}

interface Stats {
  total: number;
  byType: { type: string; count: number }[];
}

import { GoogleGenAI, Type } from '@google/genai';

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, byType: [] });
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  
  const [showSettings, setShowSettings] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [scrapeResult, setScrapeResult] = useState<{success: boolean, message: string} | null>(null);

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

  const handleEnrich = async () => {
    setEnriching(true);
    setScrapeResult(null);
    try {
      // 1. Fetch unenriched reports from backend
      const params = new URLSearchParams();
      if (username) params.append('username', username);
      if (password) params.append('password', password);
      
      const res = await fetch(`/api/reports/unenriched?${params.toString()}`);
      const data = await res.json();
      
      if (!data.reports || data.reports.length === 0) {
        setScrapeResult({ success: true, message: 'All reports are already enriched.' });
        setEnriching(false);
        return;
      }

      setScrapeResult({ success: true, message: `Extracting data for ${data.reports.length} reports...` });

      // 2. Initialize Gemini API
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY });
      const updates = [];

      // 3. Process each report
      for (const report of data.reports) {
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
          
          Article Text:
          ${report.content}
          `;

          const aiResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
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
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
          console.error(`Error enriching report ${report.id}:`, e);
        }
      }

      // 4. Send updates back to backend
      if (updates.length > 0) {
        const updateRes = await fetch('/api/reports/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates })
        });
        const updateData = await updateRes.json();
        
        if (updateData.success) {
          setScrapeResult({ success: true, message: `Successfully enriched ${updateData.updatedCount} reports.` });
        } else {
          setScrapeResult({ success: false, message: updateData.error || 'Failed to save enriched data' });
        }
      } else {
        setScrapeResult({ success: false, message: 'Failed to extract data from any reports.' });
      }
    } catch (error: any) {
      setScrapeResult({ success: false, message: error.message || 'Network error' });
    } finally {
      setEnriching(false);
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
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">SRT Intelligence DB</h1>
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
              onClick={() => setShowSettings(!showSettings)}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              </div>
              
              <div className="flex items-center justify-between pt-2">
                <div className="flex-1">
                  {scrapeResult && (
                    <div className={`flex items-center gap-2 text-sm ${scrapeResult.success ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {scrapeResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      {scrapeResult.message}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={handleEnrich}
                    disabled={enriching || scraping}
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
                    disabled={scraping || enriching}
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
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex items-center space-x-4">
            <div className="bg-indigo-50 p-3 rounded-xl">
              <FileText className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Total Reports</p>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
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
                <a 
                  key={report.id} 
                  href={report.url.startsWith('http') ? report.url : `https://rtraintelligence.com${report.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-6 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                          {report.type || 'Publication'}
                        </span>
                        {report.date && (
                          <span className="text-xs text-slate-500">{report.date}</span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors mb-2">
                        {report.title}
                      </h3>
                      {report.summary && (
                        <p className="text-sm text-slate-600 line-clamp-2">{report.summary}</p>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
