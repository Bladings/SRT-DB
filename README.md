# Financial Reports Scraper & Intelligence DB

An automated financial report scraper, structured data extraction engine, and analytics database designed for capital relief, securitisation, risk transfer, and credit portfolio intelligence.

The application automatically harvests publications from financial intelligence portals, extracts complex structured transaction parameters using a high-precision neural extraction engine with strict JSON schema enforcement, persists the data in a local SQLite database, and exports professionally styled multi-tab Excel workbooks ready for financial modeling.

---

## Key Features

- **Automated Web Scraping**: Extracts publication lists, categories, publication dates, summaries, and full article contents from WordPress JetEngine portals.
- **Session Authentication**: Supports authenticated scraping for gated and subscriber-only publications with automatic session cookie handling.
- **Structured Data Extraction**: Converts unstructured financial deal write-ups and market commentary into structured, normalized contract parameters (attachment points, detachment points, tranche sizes, pricing spreads, WAL, regulatory capital calculations, STS status, and more).
- **Dual Extraction Modes**:
  - **Server-Side Batch Worker**: Non-blocking background worker with live progress tracking, error recovery, and rate-limit backoff.
  - **On-Demand Single Extraction**: Instant parse or re-extraction for individual deal cards directly from the feed.
- **Local SQLite Database**: Zero-configuration, zero-latency persistence in `reports.db` with structured columns and full indexing.
- **Multi-Tab Excel Export**: Generates workbooks with distinct sheets for Deal News, Pipeline News, Market Analysis, and Regulatory Analysis, featuring frozen headers, auto-calculated column widths, bold styling, and formatted cells.
- **Data Portability**: Full JSON backup and restore capabilities for seamless migrations and disaster recovery.
- **Advanced Filtering & Search**: Instant full-text search across deal titles, summaries, originators, asset classes, and structured fields, with category and extraction status filters.
- **Light Theme**: Clean, responsive modern light mode dashboard with analytics cards and deal badges.

---

## Architecture Overview

```text
┌───────────────────────────────────────────────────────────┐
│                      Client Layer                         │
│       React 19 + TypeScript + Tailwind CSS (Vite SPA)     │
│   - Modern Light Mode Financial Dashboard                 │
│   - Live Extraction Status Polling                        │
│   - Feed with Expandable Deal Field Badges                │
│   - Search, Filters & Analytics Cards                     │
│   - Single-Click On-Demand Parser                         │
└─────────────────────────────┬─────────────────────────────┘
                              │ REST API Calls
┌─────────────────────────────▼─────────────────────────────┐
│                      Backend Server                       │
│                   Express.js (Node.js)                    │
│                                                           │
│  ┌─────────────────────────┐   ┌────────────────────────┐ │
│  │     Scraping Engine     │   │  Extraction Worker     │ │
│  │   Axios + Cheerio +     │   │  High-Precision Engine │ │
│  │   JetEngine DOM Parser  │   │  Strict JSON Schemas   │ │
│  └────────────┬────────────┘   └───────────┬────────────┘ │
│               │                            │              │
│               └─────────────┬──────────────┘              │
│                             │                             │
│                 ┌───────────▼───────────┐                 │
│                 │   better-sqlite3 DB   │                 │
│                 │      reports.db       │                 │
│                 └───────────┬───────────┘                 │
│                             │                             │
│                 ┌───────────▼───────────┐                 │
│                 │   ExcelJS Exporter    │                 │
│                 │  Formatted Workbooks  │                 │
│                 └───────────────────────┘                 │
└───────────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Publication Discovery & Scraping
The scraper targets publication endpoints across four primary categories:
- `/publication-type/deal-news/`
- `/publication-type/pipeline-news/`
- `/publication-type/market-analysis/`
- `/publication-type/regulatory-analysis/`

1. **Authentication (Optional)**: If credentials are provided, a `POST` request is dispatched to `/members-area/`. Session cookies (`wordpress_logged_in_*`, `PHPSESSID`) are captured from response headers and reused in subsequent requests.
2. **Pagination Traversal**: The scraper queries `?jsf=jet-engine:allpublication&pagenum={page}` iteratively, parsing `.jet-listing-grid__item` blocks with Cheerio until no further publications are returned.
3. **Deduplication**: Publications are ingested using `INSERT OR IGNORE INTO reports (title, url, date, type, summary)` using the unique article URL.

### 2. Full Article Extraction
When structured extraction begins, the engine inspects each report:
- If article body text is not yet stored, the engine fetches the publication URL with session cookies and extracts the article content from `.elementor-widget-theme-post-content`, `.entry-content`, or `main`.
- The extracted text is cached in the `content` column of the SQLite database to eliminate redundant network requests.

### 3. Structured Intelligence Extraction
The server sends the article text to the structured extraction engine using strict JSON schema validation.

- **Deal & Pipeline News Schema**:
  - Enforces ISO currency codes (`USD`, `EUR`, `GBP`).
  - Converts numbers to pure millions (e.g., `$1.2B` -> `1200`).
  - Normalizes percentages as raw floats without `%` signs (e.g., `8.25`).
  - Captures SRT/securitisation parameters including originator, tranche type, attachment/detachment points, WAL, pricing, and capital calculation approach.
- **Market & Regulatory Analysis Schema**:
  - Extracts main topic, bulleted key takeaways, institutions mentioned, regulatory frameworks (Basel IV, CRR, SRT guidance), and market sentiment.

### 4. Background Worker & Rate Limiting
- The extraction loop runs asynchronously on the server.
- Automatically retries on temporary rate limit or network errors with exponential backoff.
- The UI polls `/api/extract/batch/status` every 2.5 seconds to display real-time progress.
- Users can close or refresh the browser without interrupting the extraction job.

### 5. Multi-Tab Excel Export
- Aggregates reports by category into dedicated sheets.
- Adds a **Summary Overview** sheet with record counts and extraction health.
- Formats headers with custom fills (Navy for Deals, Emerald for Analysis), white bold text, and frozen top rows.
- Sets column widths and enables word wrapping for bulleted takeaways.

---

## Data Schema Reference

### Deal News & Pipeline News Fields

| Column Header | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `MONTH` | String | Full publication or issuance month | `October` |
| `YEAR` | String | 4-digit issuance year | `2024` |
| `TRANSACTION NAME` | String | Deal title or project code | `Colosseum 2024-1` |
| `ORIGINATOR` | String | Originator bank or lending institution | `Intesa Sanpaolo` |
| `TRANCHE TYPE` | String | Structural tranche | `Mezzanine` |
| `CURRENCY` | String | 3-letter ISO currency code | `EUR` |
| `TRANCHE AMOUNT (M)` | Number | Tranche size in millions | `145` |
| `ATTACH POINT (%)` | Number | Attachment point percentage | `1.5` |
| `DETACH POINT (%)` | Number | Detachment point percentage | `8.5` |
| `PRICING` | String | Margin spread or coupon | `Euribor + 750 bps` |
| `PORTFOLIO SIZE (M)` | Number | Reference portfolio notional in millions | `2100` |
| `ASSET CLASS` | String | Underlying credit collateral | `Large Corporate / SME` |
| `JURISDICTION` | String | Country or geographic area | `Italy` |
| `PORTFOLIO WAL` | String | Weighted average life | `3.4 years` |
| `CALCULATION APPROACH` | String | Regulatory capital approach | `SEC-IRBA` |
| `AMORTIZATION` | String | Amortization structure | `Pro-rata with triggers` |
| `DEAL STRUCTURE` | String | Transaction legal format | `Synthetic / Financial Guarantee` |
| `STRUCTURE TYPE` | String | Placement structure | `Bilateral` |
| `EXCESS SPREAD` | String | Excess spread mechanism | `Synthetic excess spread 50 bps` |
| `NO. OF BORROWERS` | Number | Number of portfolio obligors | `480` |
| `CALL DATE` | String | First optional call or replenishment end | `October 2027` |
| `STS` | String | Simple, Transparent, and Standardised status | `Yes` |
| `INVESTOR` | String | Anchor or participating investors | `PGGM / Aozora` |
| `ARRANGER` | String | Placement agent or structuring bank | `BNP Paribas` |
| `SOURCE URL` | String | Original article permalink | `https://...` |

### Market & Regulatory Analysis Fields

| Column Header | Type | Description |
| :--- | :--- | :--- |
| `TITLE` | String | Headline of analysis |
| `DATE` | String | Publication date |
| `MAIN TOPIC` | String | Core subject matter |
| `KEY TAKEAWAYS` | Array[String] | Bulleted strategic highlights and implications |
| `COMPANIES MENTIONED` | Array[String] | Banks, regulatory bodies, and funds referenced |
| `REGULATORY FRAMEWORK` | String | Relevant legislation (Basel IV, CRR, SRT guidelines) |
| `MARKET SENTIMENT` | String | Bullish, Bearish, Cautious, Stable, or Expanding |
| `SUMMARY` | String | Overview excerpt |
| `SOURCE URL` | String | Original article permalink |

---

## Running Locally on Your Machine

The project is completely self-contained and runs on standard Node.js without any proprietary dependencies.

### 1. Prerequisites
- **Node.js** (v18, v20, or v22+)
- **npm** (included with Node.js) or **bun** / **yarn** / **pnpm**

### 2. Clone and Install
```bash
git clone <your-repository-url>
cd <repository-directory>
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` and set your extraction API key and preferred port:
```env
GEMINI_API_KEY="your_api_key_here"
PORT=3000
NODE_ENV=development
```

### 4. Start in Development Mode
```bash
npm run dev
```
Open your browser to `http://localhost:3000`. The Vite development server and Express backend will run together with hot reloading.

### 5. Build & Run in Production Locally
```bash
npm run build
npm start
```
The server will build the optimized React client into `dist/` and serve it directly via Express.

---

## Deploying to a Standard Website / VPS / Cloud

You can deploy this project to any traditional cloud provider, virtual private server (VPS), Docker container, or platform-as-a-service (PaaS).

### Option A: Standard Linux VPS (Ubuntu / Debian / RHEL)

1. **Install Node.js & PM2**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

2. **Clone & Build**:
   ```bash
   git clone <your-repository-url> /var/www/financial-reports-app
   cd /var/www/financial-reports-app
   npm install
   cp .env.example .env
   nano .env # Paste your GEMINI_API_KEY and configure PORT=3000
   npm run build
   ```

3. **Run with PM2 Process Manager**:
   ```bash
   pm2 start "npm start" --name "financial-intelligence"
   pm2 save
   pm2 startup
   ```

4. **Nginx Reverse Proxy Configuration (Optional for SSL/Domain)**:
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

### Option B: Docker Deployment

Create a `Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]
```

Build and run the container:
```bash
docker build -t financial-reports-db .
docker run -d -p 3000:3000 -v $(pwd)/reports.db:/app/reports.db -e GEMINI_API_KEY="your_key" --name financial-reports-db financial-reports-db
```
*(Mounting `reports.db` preserves your SQLite database across container restarts!)*

### Option C: PaaS (Render, Railway, DigitalOcean App Platform, Fly.io)

1. Connect your GitHub repository.
2. Build Command: `npm run build`
3. Start Command: `npm start`
4. Set Environment Variables in dashboard:
   - `GEMINI_API_KEY`: `<your-api-key>`
   - `NODE_ENV`: `production`

---

## API Reference

### Reports & Queries
- `GET /api/reports`
  - Query parameters:
    - `type` (optional): Filter by category (`Deal News`, `Market Analysis`, etc.).
    - `status` (optional): `all`, `extracted`, or `pending`.
    - `search` (optional): Search string across title, summary, and structured fields.
    - `sort` (optional): `newest` or `oldest`.
- `GET /api/stats`
  - Returns total counts, extraction progress, deal volume sums, and top originators.
- `PUT /api/reports/:id`
  - Manually update or correct any report field or structured JSON.

### Scraping
- `POST /api/scrape`
  - Body: `{ username?: string, password?: string }`
  - Scrapes all publication listing grids and saves new reports to SQLite.
- `POST /api/test-login`
  - Body: `{ username: string, password: string }`
  - Verifies portal login credentials without running a full scrape.

### Intelligence Extraction
- `POST /api/extract/single`
  - Body: `{ reportId: number, modelName?: string, username?: string, password?: string }`
  - Immediately extracts structured data for a single report.
- `POST /api/extract/batch/start`
  - Body: `{ username?: string, password?: string, modelName?: string }`
  - Launches server-side background extraction worker.
- `GET /api/extract/batch/status`
  - Returns `{ running, totalToProcess, processedCount, currentReportTitle, lastError, remainingCount }`.
- `POST /api/extract/batch/stop`
  - Requests graceful termination of active extraction worker.

### Export & Portability
- `GET /api/export`
  - Generates and streams `financial-intelligence-reports.xlsx`.
- `GET /api/backup`
  - Downloads complete SQLite database as `financial_database_backup.json`.
- `POST /api/restore`
  - Body: `{ clear: boolean, reports: Array }`
  - Restores reports and structured intelligence from backup.
- `DELETE /api/reports`
  - Purges all reports from the database.
- `DELETE /api/reports/extracted`
  - Resets all extracted fields to `NULL` while preserving scraped articles.

---

## License

MIT License. Designed for financial data research, credit risk modeling, and securitisation analytics.
