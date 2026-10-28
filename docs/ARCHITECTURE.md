# System Architecture & Technical Specifications

This document outlines the architecture, data structures, and pipeline workflows of the **Financial Reports Intelligence DB**.

---

## 1. High-Level Architecture

The system is constructed as a modern, decoupled full-stack TypeScript application:

```text
 ┌────────────────────────────────────────────────────────┐
 │                      Client (SPA)                      │
 │  - React 19 / TypeScript / Vite                        │
 │  - Tailwind CSS Styling (Modern Light Finance Theme)   │
 │  - State Management: React Hooks + Polling Interval    │
 │  - Zero external cloud dependencies                    │
 └───────────────────────────┬────────────────────────────┘
                             │
                      REST API (Port 3000)
                             │
 ┌───────────────────────────▼────────────────────────────┐
 │                  Server Application                    │
 │  - Express.js Runtime                                  │
 │  - SQLite (`better-sqlite3`) embedded storage          │
 │  - Web Scraper Engine (Axios + Cheerio)                │
 │  - Structured AI Extraction Engine                     │
 │  - Background Batch Processing Worker                  │
 │  - Excel Generation Engine (`exceljs`)                 │
 └───────────────────────────┬────────────────────────────┘
                             │
                      Filesystem & AI API
                             │
 ┌───────────────────────────▼────────────────────────────┐
 │                  Storage & Upstream                    │
 │  - `reports.db`: Local SQLite database file            │
 │  - Upstream Extraction API (Server-side authenticated) │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Scraping Engine Design

### Portal Navigation & DOM Traversal
The scraper is optimized for WordPress instances running JetEngine listing grids:

1. **Authentication Flow**:
   - `POST` to `/members-area/` with `log`, `pwd`, `wp-submit=Log In`, and `jet_login=1`.
   - Captures `set-cookie` headers and formats them into a reusable `Cookie` header string.
2. **Category Iteration**:
   - Loops over defined category paths:
     - `/publication-type/deal-news/`
     - `/publication-type/pipeline-news/`
     - `/publication-type/market-analysis/`
     - `/publication-type/regulatory-analysis/`
3. **Pagination Handling**:
   - Queries `?jsf=jet-engine:allpublication&pagenum={N}` starting from page 1.
   - Extracts:
     - URL: `.jet-engine-listing-overlay-link` (`href` attribute)
     - Type: `.jet-listing-dynamic-terms__link`
     - Title, Date, Summary: `.jet-listing-dynamic-field__content` indices
   - Terminates pagination when a page yields 0 new articles.
4. **Idempotent Storage**:
   - Uses SQLite `INSERT OR IGNORE INTO reports` with `url` as a unique constraint to avoid duplicate entries.

---

## 3. Structured Extraction Engine

### Model Pipeline
The extraction pipeline uses a server-side extraction engine with strict JSON schema enforcement:

- Temperature: `0.1` (Minimizes hallucinations and strictly enforces numeric formatting)
- Response MIME Type: `application/json`
- Response Schema: Strictly defined using `Type.OBJECT`, `Type.STRING`, `Type.NUMBER`, and `Type.ARRAY`

### Schema Contracts

#### Contract: Deal & Pipeline News
Enforces contract normalization across 24 financial parameters:
```typescript
{
  MONTH: string,
  YEAR: string,
  "TRANSACTION NAME": string,
  ORIGINATOR: string,
  "TRANCHE TYPE": string,
  CURRENCY: string,                          // ISO 3-letter (e.g., EUR, USD)
  "TRANCHE AMOUNT (millions)": number,       // Normalized float (e.g., 150)
  "ATTACHMENT POINT (%)": number,            // Normalized float (e.g., 1.5)
  "DETACHMENT POINT (%)": number,            // Normalized float (e.g., 8.5)
  PRICING: string,
  "PORTFOLIO SIZE (millions)": number,
  "ASSET CLASS": string,
  JURISDICTION: string,
  "PORTFOLIO WAL": string,
  "PORTFOLIO/CAPITAL CALCULATION APPROACH": string,
  "AMORTIZATION STRUCTURE": string,
  "DEAL STRUCTURE": string,
  "BILATERAL/SYNDICATED": string,
  "EXCESS SPREAD": string,
  "NUMBER OF BORROWERS": number,
  "CALL DATE": string,
  STS: string,
  INVESTOR: string,
  ARRANGER: string
}
```

#### Contract: Market & Regulatory Analysis
Extracts thematic and strategic intelligence:
```typescript
{
  "MAIN TOPIC": string,
  "KEY TAKEAWAYS": string[],
  "COMPANIES MENTIONED": string[],
  "REGULATORY FRAMEWORK": string,
  "MARKET SENTIMENT": string
}
```

### Server-Side Background Worker
- Runs asynchronously without blocking HTTP requests.
- Maintained in an in-memory status controller:
  - `running`: boolean
  - `stopRequested`: boolean flag for graceful pauses
  - `totalToProcess`: count of unenriched records
  - `processedCount`: incremental progress
  - `currentReportTitle`: active report title
- Implements exponential backoff when encountering network latency or temporary API rate limits.

---

## 4. SQLite Database Schema

The database resides in a single file `reports.db` in the root directory:

```sql
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
);
```

### Field Definitions:
- `id`: Auto-incrementing primary key.
- `title`: Extracted headline.
- `url`: Canonical permalink (unique index).
- `date`: Human-readable publication date string.
- `type`: Category taxonomy (e.g. `Deal News`, `Market Analysis`).
- `summary`: Short listing excerpt.
- `content`: Cached full article body (prevents refetching).
- `structured_data`: JSON string validated against the extraction schema.
- `created_at`: Ingestion timestamp.

---

## 5. Security & Portability

- **No Client API Keys**: All API keys are kept strictly on the server and are never bundled in client assets or exposed in client responses.
- **Local Persistence**: All reports and structured data reside in SQLite on your server/local filesystem.
- **Universal Deployment**: Runs on any standard Node.js environment, Linux VPS, Docker container, or cloud host.
