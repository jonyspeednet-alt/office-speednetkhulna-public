const DEFAULT_TIMEOUT_MS = 15000;

const getFetchTimeoutMs = () => {
  const raw = Number(process.env.GOOGLE_SHEETS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
};

const normalizeGoogleSheetCsvUrl = (rawUrl) => {
  const url = String(rawUrl || '').trim();
  if (!url) return '';

  if (/\/export\?(?:[^#]*&)?format=csv/i.test(url)) {
    return url;
  }

  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (!sheetIdMatch) return url;

  const gidMatch = url.match(/[?&#]gid=(\d+)/i);
  const gidPart = gidMatch ? `&gid=${gidMatch[1]}` : '';
  return `https://docs.google.com/spreadsheets/d/${sheetIdMatch[1]}/export?format=csv${gidPart}`;
};

const parseCsvText = (input) => {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  return rows
    .map((cols) => cols.map((value) => String(value ?? '').trim()))
    .filter((cols) => cols.some((value) => value !== ''));
};

const rowsToObjects = (tableRows) => {
  if (!Array.isArray(tableRows) || tableRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headerRow, ...dataRows] = tableRows;
  const headers = headerRow.map((header, index) => {
    const normalized = String(header || '').trim();
    return normalized || `Column ${index + 1}`;
  });

  const rows = dataRows.map((cols, rowIndex) => {
    const row = { __rowNumber: rowIndex + 2 };
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? '';
    });
    return row;
  });

  return { headers, rows };
};

const fetchCsvSheet = async (url) => {
  const normalizedUrl = normalizeGoogleSheetCsvUrl(url);
  if (!normalizedUrl) {
    throw new Error('Google Sheets URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getFetchTimeoutMs());

  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'office.speednetkhulna.com/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch sheet: HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    // Byte cap: unbounded response.text() on attacker-influenced CSV/JSON
    const MAX_SHEET_BYTES = 5 * 1024 * 1024;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_SHEET_BYTES) {
      throw new Error('Sheet payload too large');
    }
    let bodyText = await response.text();
    if (bodyText.length > MAX_SHEET_BYTES) {
      throw new Error('Sheet payload too large');
    }
    if (!bodyText.trim()) {
      return { url: normalizedUrl, headers: [], rows: [] };
    }

    if (contentType.includes('application/json')) {
      const parsed = JSON.parse(bodyText);
      const values = Array.isArray(parsed?.values) ? parsed.values : [];
      return rowsToObjects(values);
    }

    return rowsToObjects(parseCsvText(bodyText));
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  fetchCsvSheet,
  normalizeGoogleSheetCsvUrl,
  parseCsvText,
  rowsToObjects
};
