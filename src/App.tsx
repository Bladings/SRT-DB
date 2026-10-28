import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  Database,
  FileText,
  Settings,
  AlertCircle,
  CheckCircle2,
  Download,
  Trash2,
  Play,
  Square,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Layers,
  DollarSign,
  Building2,
  ShieldCheck,
  Calendar,
  SlidersHorizontal,
} from 'lucide-react';

interface Report {
  id: number;
  title: string;
  url: string;
  date: string;
  type: string;
  summary: string;
  content?: string;
  structured_data?: string;
  created_at: string;
}

interface Stats {
  total: number;
  extractedCount: number;
  byType: { type: string; count: number }[];
  totalTrancheVolumeMillions?: number;
  totalPortfolioVolumeMillions?: number;
  topOriginators?: { name: string; count: number }[];
  topAssetClasses?: { name: string; count: number }[];
}

interface BatchState {
  running: boolean;
  stopRequested: boolean;
  totalToProcess: number;
  processedCount: number;
  currentReportTitle: string;
  lastError: string | null;
  startedAt: string | null;
  remainingCount?: number;
}

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    extractedCount: 0,
    byType: [],
    totalTrancheVolumeMillions: 0,
    totalPortfolioVolumeMillions: 0,
    topOriginators: [],
    topAssetClasses: [],
  });
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [singleExtractingId, setSingleExtractingId] = useState<number | null>(null);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'all' | 'extracted' | 'pending'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // UI state
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [showSettings, setShowSettings] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [actionNotice, setActionNotice] = useState<{ success: boolean; message: string } | null>(null);
  const [testLoginLoading, setTestLoginLoading] = useState(false);

  // Background Batch Extraction State
  const [batchStatus, setBatchStatus] = useState<BatchState>({
    running: false,
    stopRequested: false,
    totalToProcess: 0,
    processedCount: 0,
    currentReportTitle: '',
    lastError: null,
    startedAt: null,
    remainingCount: 0,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch reports
  const fetchReports = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (typeFilter !== 'All') params.append('type', typeFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      params.append('sort', sortOrder);

      const res = await fetch(`/api/reports?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setReports(data);
      }
    } catch (error) {
      console.error('Failed to fetch reports', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch statistics
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats', error);
    }
  };

  // Poll batch extraction status
  const checkBatchStatus = async () => {
    try {
      const res = await fetch('/api/extract/batch/status');
      const data: BatchState = await res.json();
      setBatchStatus(data);

      if (data.running) {
        fetchStats();
      }
    } catch (e) {
      console.error('Status check error:', e);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [search, typeFilter, statusFilter, sortOrder]);

  useEffect(() => {
    fetchStats();
    checkBatchStatus();

    pollIntervalRef.current = setInterval(() => {
      checkBatchStatus();
    }, 2500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // When batch extraction state updates, refresh data
  useEffect(() => {
    if (!batchStatus.running && batchStatus.processedCount > 0) {
      fetchReports();
      fetchStats();
    }
  }, [batchStatus.running]);

  // Test credentials
  const handleTestLogin = async () => {
    if (!username || !password) {
      setActionNotice({ success: false, message: 'Please enter both username and password.' });
      return;
    }
    setTestLoginLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      setActionNotice({ success: data.success, message: data.message });
    } catch (err: any) {
      setActionNotice({ success: false, message: err.message || 'Login test failed.' });
    } finally {
      setTestLoginLoading(false);
    }
  };

  // Handle Scrape
  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    setScraping(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice({
          success: true,
          message: `Scrape finished! Found ${data.totalFound} items (${data.newInserted} newly added to database).`,
        });
        fetchReports();
        fetchStats();
      } else {
        setActionNotice({ success: false, message: data.error || 'Failed to complete scrape.' });
      }
    } catch (error: any) {
      setActionNotice({ success: false, message: error.message || 'Network error during scraping.' });
    } finally {
      setScraping(false);
    }
  };

  // Start Batch Extraction
  const handleStartBatchExtraction = async () => {
    setActionNotice(null);
    try {
      const res = await fetch('/api/extract/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          modelName: selectedModel,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionNotice({
          success: true,
          message: 'Server-side batch extraction worker started. You can track progress below.',
        });
        checkBatchStatus();
      } else {
        setActionNotice({ success: false, message: data.error || 'Failed to start batch extraction.' });
      }
    } catch (err: any) {
      setActionNotice({ success: false, message: err.message || 'Network error.' });
    }
  };

  // Stop Batch Extraction
  const handleStopBatchExtraction = async () => {
    try {
      const res = await fetch('/api/extract/batch/stop', { method: 'POST' });
      const data = await res.json();
      setActionNotice({ success: true, message: data.message });
      checkBatchStatus();
    } catch (err: any) {
      setActionNotice({ success: false, message: err.message || 'Failed to stop extraction.' });
    }
  };

  // Single Report Extraction
  const handleExtractSingle = async (reportId: number) => {
    setSingleExtractingId(reportId);
    setActionNotice(null);
    try {
      const res = await fetch('/api/extract/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          modelName: selectedModel,
          username,
          password,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReports((prev) =>
          prev.map((r) => (r.id === reportId ? { ...r, structured_data: data.structured_data } : r))
        );
        setExpandedReportId(reportId);
        fetchStats();
      } else {
        setActionNotice({ success: false, message: data.error || `Failed to extract report #${reportId}` });
      }
    } catch (err: any) {
      setActionNotice({ success: false, message: err.message || 'Network error during extraction.' });
    } finally {
      setSingleExtractingId(null);
    }
  };

  // Backup & Restore
  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoring(true);
    setActionNotice({ success: true, message: 'Parsing backup JSON file...' });

    try {
      const text = await file.text();
      let reportsData;
      try {
        reportsData = JSON.parse(text);
      } catch {
        throw new Error('Invalid JSON format. Please verify the backup file.');
      }

      if (!Array.isArray(reportsData)) {
        throw new Error('Backup file must contain an array of reports.');
      }

      const total = reportsData.length;
      setActionNotice({ success: true, message: `Uploading ${total} records in batches...` });

      const BATCH_SIZE = 100;
      let totalRestored = 0;

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = reportsData.slice(i, i + BATCH_SIZE);
        const isFirst = i === 0;

        const res = await fetch('/api/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clear: isFirst,
            reports: batch,
          }),
        });

        if (!res.ok) {
          throw new Error(`Server error (${res.status})`);
        }

        totalRestored += batch.length;
        setActionNotice({ success: true, message: `Restoring records (${totalRestored}/${total})...` });
      }

      setActionNotice({ success: true, message: `Successfully restored all ${total} reports from backup.` });
      fetchReports();
      fetchStats();
    } catch (error: any) {
      setActionNotice({ success: false, message: error.message || 'Error restoring database.' });
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Reset operations
  const handleDeleteScraped = async () => {
    setActionNotice({ success: true, message: 'Purging database records...' });
    try {
      const res = await fetch('/api/reports', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setActionNotice({ success: true, message: data.message });
        fetchReports();
        fetchStats();
      } else {
        setActionNotice({ success: false, message: data.error || 'Failed to purge data.' });
      }
    } catch (err: any) {
      setActionNotice({ success: false, message: err.message });
    }
  };

  const handleClearExtracted = async () => {
    setActionNotice({ success: true, message: 'Clearing all extracted structured fields...' });
    try {
      const res = await fetch('/api/reports/extracted', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setActionNotice({ success: true, message: data.message });
        fetchReports();
        fetchStats();
      } else {
        setActionNotice({ success: false, message: data.error || 'Failed to clear data.' });
      }
    } catch (err: any) {
      setActionNotice({ success: false, message: err.message });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-xs">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">Financial Reports Intelligence DB</h1>
              <p className="text-xs text-slate-500">Automated Financial Scraper & Structured Intelligence</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <a
              href="/api/export"
              download="financial-intelligence-reports.xlsx"
              className="flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-xs"
              title="Download formatted Excel workbook"
            >
              <Download className="w-4 h-4" />
              <span>Export Excel</span>
            </a>

            <button
              onClick={() => {
                setShowSettings(!showSettings);
                setActionNotice(null);
              }}
              className={`p-2 rounded-xl transition-all border ${
                showSettings
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Configure Scraper & Extraction Engine"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 flex-1 w-full">
        {/* Banner Alert for action notices */}
        {actionNotice && (
          <div
            className={`p-4 rounded-xl flex items-start gap-3 text-sm border animate-in fade-in duration-200 ${
              actionNotice.success
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {actionNotice.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 font-medium">{actionNotice.message}</div>
            <button
              onClick={() => setActionNotice(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-semibold uppercase"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Live Extraction Progress Card */}
        {batchStatus.running && (
          <div className="bg-white border border-indigo-200 rounded-2xl p-5 shadow-xs relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    Background Data Extraction in Progress
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Extracting structured deal and market fields directly into database
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleStopBatchExtraction}
                  disabled={batchStatus.stopRequested}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  {batchStatus.stopRequested ? 'Stopping...' : 'Pause Extraction'}
                </button>
              </div>
            </div>

            {/* Progress details */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600">
                <span className="truncate max-w-md text-slate-500">
                  Processing: <span className="text-slate-900 font-medium">{batchStatus.currentReportTitle || 'Processing report...'}</span>
                </span>
                <span className="font-semibold text-indigo-600 shrink-0">
                  {batchStatus.processedCount} of {batchStatus.totalToProcess} finished
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      batchStatus.totalToProcess > 0
                        ? Math.min(100, Math.round((batchStatus.processedCount / batchStatus.totalToProcess) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Settings / Scraper / Extraction Controls Panel */}
        {showSettings && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-6">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-semibold text-slate-900">Scraper & Data Extraction Settings</h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xs text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 transition-colors font-medium"
              >
                Close Settings
              </button>
            </div>

            <form onSubmit={handleScrape} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                    Target Portal Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. member@institution.com"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Optional. Required for member-protected publications.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                    Target Portal Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Held only in memory for active scraping sessions.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    Extraction Model Engine
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-colors cursor-pointer"
                  >
                    <option value="gemini-3.8-flash">High-Precision Neural Model (Recommended)</option>
                    <option value="gemini-3.1-flash-lite">High-Speed Model</option>
                    <option value="gemini-4-argon">Deep Reasoning Model</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">Extracts structured parameters using strict JSON contracts.</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTestLogin}
                    disabled={testLoginLoading || !username || !password}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors disabled:opacity-40"
                  >
                    {testLoginLoading ? 'Testing...' : 'Test Login Credentials'}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleStartBatchExtraction}
                    disabled={batchStatus.running || scraping || restoring}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-all disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Run Full Batch Extraction</span>
                  </button>

                  <button
                    type="submit"
                    disabled={scraping || batchStatus.running || restoring}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-all disabled:opacity-50"
                  >
                    {scraping ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>{scraping ? 'Scraping Site...' : 'Run Web Scraper'}</span>
                  </button>
                </div>
              </div>
            </form>

            {/* Backup & Portability Section */}
            <div className="mt-8 pt-6 border-t border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-600" />
                    Data Portability & Backup
                  </h3>
                  <p className="text-xs text-slate-500">
                    Export local database records as JSON or restore your database anytime.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mt-4">
                <a
                  href="/api/backup"
                  download="financial_database_backup.json"
                  className="px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors"
                >
                  Download JSON Backup
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
                  disabled={batchStatus.running || scraping || restoring}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors disabled:opacity-50"
                >
                  {restoring ? 'Restoring Data...' : 'Restore from JSON File'}
                </button>
              </div>

              {/* Reset Data */}
              <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500">Database Maintenance Operations:</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleClearExtracted}
                    disabled={batchStatus.running || scraping || restoring}
                    className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Clear Extracted Fields
                  </button>
                  <button
                    onClick={handleDeleteScraped}
                    disabled={batchStatus.running || scraping || restoring}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    Purge All Scraped Reports
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Analytics Key Performance Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Reports */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs flex items-center space-x-4">
            <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Reports</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{stats.total}</p>
            </div>
          </div>

          {/* Extracted Percentage */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Intelligence Extracted</span>
              <span className="text-xs font-bold text-emerald-700 px-2 py-0.5 bg-emerald-50 rounded-md border border-emerald-200">
                {stats.total > 0 ? Math.round((stats.extractedCount / stats.total) * 100) : 0}%
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900">{stats.extractedCount}</span>
                <span className="text-xs text-slate-500">/ {stats.total} enriched</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${stats.total > 0 ? (stats.extractedCount / stats.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Deal Tranche Volume */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs flex items-center space-x-4">
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Identified Tranche Vol</p>
              <p className="text-2xl font-bold text-blue-700 mt-0.5">
                {stats.totalTrancheVolumeMillions ? `${stats.totalTrancheVolumeMillions.toLocaleString()}M` : '—'}
              </p>
            </div>
          </div>

          {/* Portfolio Volume */}
          <div className="bg-white border border-slate-200/80 p-5 rounded-2xl shadow-xs flex items-center space-x-4">
            <div className="p-3 rounded-xl bg-violet-50 text-violet-600">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Identified Portfolio Vol</p>
              <p className="text-2xl font-bold text-violet-700 mt-0.5">
                {stats.totalPortfolioVolumeMillions ? `${stats.totalPortfolioVolumeMillions.toLocaleString()}M` : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Search, Filter & Quick Action Bar */}
        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals, originators, asset classes..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:bg-white transition-colors"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* Category Filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-transparent text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="All">All Categories</option>
                {stats.byType.map((stat) => (
                  <option key={stat.type} value={stat.type}>
                    {stat.type} ({stat.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-transparent text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="extracted">Extracted Only</option>
                <option value="pending">Pending Extraction</option>
              </select>
            </div>

            {/* Sort Order */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                className="bg-transparent text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            <button
              onClick={() => {
                fetchReports();
                fetchStats();
              }}
              className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
              title="Refresh Reports List"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Reports Feed */}
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-500">Loading intelligence reports...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="p-16 text-center space-y-3">
              <FileText className="w-12 h-12 text-slate-300 mx-auto" />
              <h3 className="text-base font-semibold text-slate-900">No reports match your criteria</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try resetting your filters or run the web scraper in Settings to fetch new publications.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {reports.map((report) => {
                const isExtracted = Boolean(report.structured_data);
                const isExpanded = expandedReportId === report.id;
                const isExtractingThis = singleExtractingId === report.id;
                let structuredObj: any = null;

                if (report.structured_data) {
                  try {
                    structuredObj = JSON.parse(report.structured_data);
                  } catch {
                    structuredObj = null;
                  }
                }

                return (
                  <div
                    key={report.id}
                    className="p-5 hover:bg-slate-50/80 transition-colors group"
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        {/* Badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {report.type || 'Publication'}
                          </span>

                          {report.date && (
                            <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              {report.date}
                            </span>
                          )}

                          {isExtracted ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Data Extracted
                            </span>
                          ) : (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              Raw Summary
                            </span>
                          )}

                          {/* Quick Highlight of Deal Originator / Currency if extracted */}
                          {structuredObj?.ORIGINATOR && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                              {structuredObj.ORIGINATOR}
                            </span>
                          )}
                          {structuredObj?.CURRENCY && structuredObj?.['TRANCHE AMOUNT (millions)'] && (
                            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {structuredObj.CURRENCY} {structuredObj['TRANCHE AMOUNT (millions)']}M Tranche
                            </span>
                          )}
                          {structuredObj?.STS && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200 flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-violet-600" /> STS
                            </span>
                          )}
                        </div>

                        {/* Title & Link */}
                        <div className="flex items-baseline gap-2">
                          <a
                            href={report.url.startsWith('http') ? report.url : `https://rtraintelligence.com${report.url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-base font-semibold text-slate-900 hover:text-indigo-600 transition-colors inline-flex items-center gap-1.5"
                          >
                            <span>{report.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600" />
                          </a>
                        </div>

                        {/* Summary */}
                        {report.summary && (
                          <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 leading-relaxed">
                            {report.summary}
                          </p>
                        )}
                      </div>

                      {/* Card Action Buttons */}
                      <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                        {/* On-Demand Single Report Extraction */}
                        <button
                          onClick={() => handleExtractSingle(report.id)}
                          disabled={isExtractingThis || batchStatus.running}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all border disabled:opacity-50 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-200"
                          title="Extract structured fields for this report"
                        >
                          {isExtractingThis ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          )}
                          <span>{isExtractingThis ? 'Parsing...' : isExtracted ? 'Re-extract' : 'Extract'}</span>
                        </button>

                        {/* View Data Toggle */}
                        {isExtracted && (
                          <button
                            onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3.5 h-3.5" />
                                <span>Hide Fields</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3.5 h-3.5" />
                                <span>View Data</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Structured Data View */}
                    {isExpanded && structuredObj && (
                      <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs animate-in fade-in duration-200">
                        <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200">
                          <span className="font-semibold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                            <Database className="w-3.5 h-3.5 text-indigo-600" />
                            Extracted Structured Intelligence
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            Schema: {report.type === 'Deal News' || report.type === 'Pipeline News' ? 'Deal / SRT Contract' : 'Market Analysis'}
                          </span>
                        </div>

                        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {Object.entries(structuredObj).map(([key, value]) => {
                            if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
                              return null;
                            }

                            return (
                              <div
                                key={key}
                                className={`p-2.5 rounded-lg bg-white border border-slate-200 ${
                                  Array.isArray(value) || key === 'KEY TAKEAWAYS' ? 'col-span-2 sm:col-span-3 lg:col-span-4' : ''
                                }`}
                              >
                                <dt className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                  {key}
                                </dt>
                                <dd className="text-slate-900 font-medium">
                                  {Array.isArray(value) ? (
                                    <ul className="list-disc pl-4 space-y-1 text-slate-700">
                                      {value.map((item, idx) => (
                                        <li key={idx}>{String(item)}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="font-mono text-xs">{String(value)}</span>
                                  )}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-500">
        <p>Financial Intelligence Database & Scraper &bull; All data retained locally in SQLite</p>
      </footer>
    </div>
  );
}
