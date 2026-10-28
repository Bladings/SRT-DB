# Financial Reports Intelligence DB - User Guide

This guide walks you through every feature of the Financial Reports Scraper and Intelligence Database, from initial scraping to structured extraction, filtering, and Excel export.

---

## Table of Contents
1. [Overview](#1-overview)
2. [Configuring Portal Access & Running the Scraper](#2-configuring-portal-access--running-the-scraper)
3. [Running Structured Data Extraction](#3-running-structured-data-extraction)
   - [Full Background Batch Extraction](#full-background-batch-extraction)
   - [On-Demand Single Report Extraction](#on-demand-single-report-extraction)
4. [Browsing, Searching & Filtering Deal Intelligence](#4-browsing-searching--filtering-deal-intelligence)
5. [Exporting to Excel for Financial Modeling](#5-exporting-to-excel-for-financial-modeling)
6. [Backup, Portability & Disaster Recovery](#6-backup-portability--disaster-recovery)
7. [Maintenance & Resetting Data](#7-maintenance--resetting-data)

---

## 1. Overview

The platform is designed to track capital relief, risk transfer, and securitisation transactions. It transforms unstructured market commentary and deal announcements into standardized financial data points:

- **Originator Bank & Arranger**
- **Tranche Sizes & Currency**
- **Attachment & Detachment Points (%)**
- **Pricing Spreads (bps or margin)**
- **Portfolio Size & Asset Class**
- **WAL, Amortization & STS Status**

All intelligence is stored locally in an embedded SQLite database (`reports.db`), ensuring privacy, fast queries, and zero external database dependencies.

---

## 2. Configuring Portal Access & Running the Scraper

To fetch the latest publications from the target portal:

1. Click the **Settings** gear icon in the top right corner.
2. If the publication portal requires authentication:
   - Enter your **Username** (or email).
   - Enter your **Password**.
   - Click **Test Login Credentials** to verify your access. The server will attempt a session login and confirm if cookies were received.
3. Click **Run Web Scraper**.
4. The scraper will query all category listings:
   - Deal News
   - Pipeline News
   - Market Analysis
   - Regulatory Analysis
5. The system automatically deduplicates articles using their permanent URL. Only newly published reports will be added to the database.

---

## 3. Running Structured Data Extraction

The application uses a server-side high-precision extraction engine to read article contents and extract structured parameters.

### Full Background Batch Extraction
If you have multiple un-enriched reports:
1. Open the **Settings** drawer.
2. Select your preferred extraction engine:
   - **High-Precision Neural Model (Recommended)**: Ideal for high accuracy, speed, and strict adherence to financial schemas.
   - **High-Speed Model**: Optimized for fast throughput.
   - **Deep Reasoning Model**: For complex, lengthy regulatory documents.
3. Click **Run Full Batch Extraction**.
4. The extraction worker runs in the background on the server. You can monitor live progress:
   - Current report being processed
   - Total count and completion percentage
   - Real-time deal volume accumulation in the analytics bar
5. You can safely close or refresh your browser tab; the background worker continues running on the server.
6. Click **Pause Extraction** if you wish to pause the worker at any time.

### On-Demand Single Report Extraction
If you want to extract or re-extract a specific publication without running a full batch:
1. Locate the report in the feed.
2. Click the **Extract** (or **Re-extract**) button located on the right side of the card.
3. The server will immediately fetch the article body (if not already cached), run the structured extraction prompt, update SQLite, and open the expanded field view.

---

## 4. Browsing, Searching & Filtering Deal Intelligence

### Search Bar
Type in the search bar to query across:
- Deal or article title
- Originator name (e.g. `Santander`, `BNP`, `Intesa`)
- Asset class (e.g. `Large Corporate`, `SME`, `Auto Loan`, `CRE`)
- Keyword summary

### Filters
- **Category Filter**: View only *Deal News*, *Pipeline News*, *Market Analysis*, or *Regulatory Analysis*.
- **Status Filter**:
  - `Extracted Only`: Displays only reports that have structured data populated.
  - `Pending Extraction`: Shows newly scraped items waiting for extraction.
- **Sort Order**: Toggle between `Newest First` and `Oldest First`.

### Inspecting Extracted Fields
Click **View Data** on any enriched card to open the field breakdown:
- Numeric metrics (amounts in millions, percentage points) are cleanly tagged.
- Currency and pricing spreads are highlighted.
- Market Analysis reports display an executive list of **Key Takeaways** and **Companies Mentioned**.

---

## 5. Exporting to Excel for Financial Modeling

Click the **Export Excel** button in the top navigation bar to download a multi-sheet spreadsheet (`financial-intelligence-reports.xlsx`):

- **Summary Overview Sheet**: Export metadata, total record counts, and enrichment rates.
- **Deal News Sheet**: Standardized columns for all completed SRT / securitisation deals with attachment points, detachment points, pricing, WAL, and portfolio volume.
- **Pipeline News Sheet**: Deals currently in structuring or roadshow phases.
- **Market Analysis & Regulatory Analysis Sheets**: Macro trends, key takeaways, and regulatory commentary.

All sheets feature:
- Frozen header rows (remain visible while scrolling).
- High-contrast header styling with bold white typography.
- Word wrap enabled for multi-line summaries and takeaways.
- Auto-sized columns to avoid truncated numbers.

---

## 6. Backup, Portability & Disaster Recovery

To preserve your data across environments or share your database:

### Creating a Backup
1. Open the **Settings** drawer.
2. Under **Data Portability & Backup**, click **Download JSON Backup**.
3. A complete dump of your `reports` table will be saved as `financial_database_backup.json`.

### Restoring from Backup
1. Click **Restore from JSON File**.
2. Select your `.json` backup file.
3. The server will stream and insert records into SQLite in transactional batches.

---

## 7. Maintenance & Resetting Data

Under the **Settings** drawer:
- **Clear Extracted Fields**: Resets `structured_data` to `NULL` for all reports so you can re-extract with an updated model or prompt, while keeping the scraped articles and titles intact.
- **Purge All Scraped Reports**: Wipes the database clean for a fresh scrape.
