// SheetJS 0.20.3 is pinned to the official distribution. Untrusted parsing
// remains isolated in a bounded worker; only validated plain cells return
// to the HTTP process. Keep these resource limits when updating the library.
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 3000;
const MAX_CONCURRENT_PARSERS = 2;
let activeParsers = 0;

const MAX_XLSX_ROWS = 5000;
const ALLOWED_EXT = new Set([".xlsx", ".xls", ".csv"]);
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  // Browsers/Excel often send generic types for .xlsx — allowed only when the
  // filename extension is a spreadsheet type (checked together below).
  "application/octet-stream",
]);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const extOf = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? `.${m[1].toLowerCase()}` : "";
};

const assertSpreadsheetFile = (file) => {
  if (!file || !file.buffer || !file.buffer.length) {
    const err = new Error("No file uploaded");
    err.status = 400;
    throw err;
  }
  const ext = extOf(file.originalname);
  const mime = String(file.mimetype || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(mime)) {
    const err = new Error("Only .xlsx / .xls / .csv files are allowed");
    err.status = 400;
    throw err;
  }
};

// Parse + return { workbook, worksheet } of the first sheet, enforcing the
// row cap from the sheet range (cheap — before any row loops or DB queries).
const openFirstSheet = async (file) => {
  assertSpreadsheetFile(file);
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    const err = new Error('Spreadsheet must be <= 5MB');
    err.status = 400;
    throw err;
  }
  if (activeParsers >= MAX_CONCURRENT_PARSERS) {
    const err = new Error('Spreadsheet parser busy. Please try again later.');
    err.status = 429;
    throw err;
  }
  activeParsers++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'xlsxParseWorker.js'), {
        workerData: { buffer: file.buffer, maxRows: MAX_XLSX_ROWS },
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      let settled = false;
      let result;
      const finishError = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Keep the concurrency slot until the worker has actually stopped.
        worker.terminate().then(() => {
          const err = new Error(message);
          err.status = 400;
          reject(err);
        }, reject);
      };
      const timer = setTimeout(() => finishError('Spreadsheet parsing timed out'), PARSE_TIMEOUT_MS);
      worker.on('message', (message) => { result = message; });
      worker.once('error', () => finishError('Could not parse spreadsheet'));
      worker.once('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0 && result?.worksheet) return resolve({ worksheet: result.worksheet });
        const err = new Error(result?.error || 'Could not parse spreadsheet');
        err.status = 400;
        reject(err);
      });
    });
  } finally {
    activeParsers--;
  }
};

// Strip prototype-pollution keys from parsed row objects (in place).
const sanitizeRows = (rows) => {
  if (!Array.isArray(rows)) return rows;
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const key of DANGEROUS_KEYS) {
        if (Object.prototype.hasOwnProperty.call(row, key)) delete row[key];
      }
    }
  }
  return rows;
};

module.exports = { openFirstSheet, sanitizeRows, assertSpreadsheetFile, MAX_XLSX_ROWS };
