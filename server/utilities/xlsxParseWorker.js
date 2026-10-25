const { parentPort, workerData } = require('node:worker_threads');
const XLSX = require('xlsx');

try {
  // Untrusted decompression/parsing stays off the HTTP event loop.
  const workbook = XLSX.read(Buffer.from(workerData.buffer), { type: 'buffer', sheets: 0 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('Spreadsheet has no sheets');
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (![range.s.r, range.s.c, range.e.r, range.e.c].every(Number.isSafeInteger) ||
      range.s.r < 0 || range.s.c < 0 || range.e.r < range.s.r || range.e.c < range.s.c) {
    throw new Error('Invalid spreadsheet range');
  }
  if (range.e.r >= workerData.maxRows + 1) throw new Error(`Too many rows (max ${workerData.maxRows})`);
  if (range.e.c >= 100) throw new Error('Too many columns (max 100)');
  // Only plain cell values cross back; omit formulas, metadata and prototype keys.
  const worksheet = { '!ref': sheet['!ref'] || 'A1' };
  let cellCount = 0;
  for (const [address, cell] of Object.entries(sheet)) {
    if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address)) continue;
    if (++cellCount > 100000) throw new Error('Too many spreadsheet cells (max 100000)');
    const pos = XLSX.utils.decode_cell(address);
    if (pos.r > range.e.r || pos.c > range.e.c || pos.r < range.s.r || pos.c < range.s.c) {
      throw new Error('Invalid spreadsheet cell');
    }
    if (!cell || !['s', 'n', 'b', 'd', 'e', 'z'].includes(cell.t)) continue;
    const value = cell.v;
    if (typeof value === 'string' && value.length > 32767) throw new Error('Spreadsheet cell is too large');
    if (value != null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && !(value instanceof Date)) {
      throw new Error('Invalid spreadsheet value');
    }
    worksheet[address] = { t: cell.t, v: value };
    if (typeof cell.w === 'string' && cell.w.length <= 32767) worksheet[address].w = cell.w;
  }
  parentPort.postMessage({ worksheet });
} catch (error) {
  const safe = /^(Too many|Spreadsheet cell is too large|Invalid spreadsheet|Spreadsheet has no sheets)/.test(error.message || '');
  parentPort.postMessage({ error: safe ? error.message : 'Could not parse spreadsheet' });
}
