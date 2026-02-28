import Database from 'better-sqlite3';

const db = new Database('reports.db');
const reports = db.prepare('SELECT id, url, type, structured_data FROM reports LIMIT 5').all();
console.log(reports);
