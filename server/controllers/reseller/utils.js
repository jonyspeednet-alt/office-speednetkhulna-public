const pool = require("../../utilities/db");
const { resolvePermission } = require("../../utilities/permissionRegistry");

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const normalizePartnerType = (value) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["mac_partner", "mac partner", "mac"].includes(raw)) return "mac_partner";
  if (["distribution_partner", "distribution partner", "distribution"].includes(raw)) return "distribution_partner";
  if (["channel_partner", "channel partner", "chanel_partner", "chanel partner", "channel", "chanel"].includes(raw)) return "channel_partner";
  return "";
};

const normalizedPartnerTypeSql = (columnSql = "COALESCE(r.partner_type, '')") => `CASE
  WHEN LOWER(${columnSql}) IN ('distribution_partner', 'distribution partner', 'distribution') THEN 'distribution_partner'
  WHEN LOWER(${columnSql}) IN ('mac_partner', 'mac partner', 'mac') THEN 'mac_partner'
  WHEN LOWER(${columnSql}) IN ('channel_partner', 'channel partner', 'chanel_partner', 'chanel partner', 'channel', 'chanel') THEN 'channel_partner'
  ELSE 'distribution_partner'
END`;

const getDhakaYmFromDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
};

const parseYMD = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value).trim();
  const ymd = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normalizeMonthYm = (rawValue) => {
  const raw = String(rawValue || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
};

const getOtcAppliedMonthYm = (reseller = {}) => {
  const rawValue = reseller.otc_charge_applied_month;
  if (rawValue instanceof Date) {
    const ym = getDhakaYmFromDate(rawValue);
    if (ym) return ym;
  }
  const raw = String(rawValue || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  const normalized = normalizeMonthYm(raw);
  if (normalized) return normalized;
  const parsedYm = getDhakaYmFromDate(raw);
  if (parsedYm) return parsedYm;
  const fallbackDate = parseYMD(reseller.joining_date || reseller.created_at);
  if (!fallbackDate) return null;
  return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, "0")}`;
};

const isAdminRole = (user) => {
  // Name-based bypass only applies to legacy users without a role_id — a
  // role_id-linked role must rely on its actual configured permissions,
  // even if it's literally named "Admin"/"Super Admin".
  if (user?.role_id) return false;
  const role = normalizeRole(user?.role_name || user?.role);
  return role === "admin" || role === "super admin" || role === "superadmin";
};

const hasAnyPermission = (user, keys = []) => keys.some((k) => resolvePermission(user, k));

const canViewResellerFinancials = (user) =>
  isAdminRole(user) ||
  hasAnyPermission(user, [
    "billing.logs.view",
    "billing.monthly_summary.view",
    "billing.generate_bill",
    "billing.invoice.view",
    "billing.invoice.static_view",
  ]);

const PARTNER_SHEET_CONFIG = {
  mac_partner: {
    title: "Mac Partner",
    envKey: "GOOGLE_SHEETS_MAC_PARTNER_CSV_URL",
  },
  distribution_partner: {
    title: "Distribution Partner",
    envKey: "GOOGLE_SHEETS_DISTRIBUTION_PARTNER_CSV_URL",
  },
};

const GOOGLE_SHEETS_WEBHOOK_TOKEN = String(process.env.GOOGLE_SHEETS_WEBHOOK_TOKEN || "").trim();

const normalizeBwType = (raw) => {
  const val = String(raw || "").toLowerCase().trim();
  const map = {
    iig: "iig_bw",
    iig_bw: "iig_bw",
    bdix: "bdix_bw",
    bdix_bw: "bdix_bw",
    ggc: "ggc_bw",
    ggc_bw: "ggc_bw",
    fna: "fna_bw",
    fna_bw: "fna_bw",
    cdn: "cdn_bw",
    cdn_bw: "cdn_bw",
    bcdn: "bcdn_bw",
    bcdn_bw: "bcdn_bw",
    other: "bcdn_bw",
    nttn: "nttn_capacity",
    nttn_capacity: "nttn_capacity",
  };
  return map[val] || "iig_bw";
};

const parseAmount = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const parseWholeNumber = (v, d = 0) => {
  const n = Math.trunc(parseAmount(v, d));
  return Number.isFinite(n) ? n : d;
};

const parseBillDetailsSnapshot = (raw, context = "") => {
  if (raw == null) return { items: [], valid: false };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) {
      if (context) console.warn(`[InvoiceSnapshot] non-array bill_details (${context})`);
      return { items: [], valid: false };
    }
    const items = parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        ...item,
        total: parseAmount(item.total, 0),
        bw: parseAmount(item.bw, 0),
        rate: parseAmount(item.rate, 0),
        days: parseAmount(item.days, 0),
      }));
    return { items, valid: true };
  } catch (error) {
    if (context) console.warn(`[InvoiceSnapshot] invalid JSON bill_details (${context}): ${error.message}`);
    return { items: [], valid: false };
  }
};

const getDhakaMonthYm = (date = new Date()) => {
  const local = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}`;
};

const previousMonthYm = (ym) => {
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(5, 7));
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const nextMonthYm = (ym) => {
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(5, 7));
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthStartDateFromYm = (ym) => `${ym}-01`;

const normalizeChangeType = (raw) => {
  const val = String(raw || "").toLowerCase().trim();
  if (["increase", "upgrade", "inc", "up", "add", "+"].includes(val)) return "increase";
  if (["decrease", "downgrade", "dec", "down", "reduce", "-"].includes(val)) return "decrease";
  return "";
};

const normalizeBillBwType = (raw) => {
  const val = String(raw || "").toUpperCase().trim();
  const map = {
    IIG: "IIG",
    IIG_BW: "IIG",
    BDIX: "BDIX",
    BDIX_BW: "BDIX",
    GGC: "GGC",
    GGC_BW: "GGC",
    FNA: "FNA",
    FNA_BW: "FNA",
    CDN: "CDN",
    CDN_BW: "CDN",
    BCDN: "BCDN",
    BCDN_BW: "BCDN",
    OTHER: "BCDN",
    NTTN: "NTTN",
    NTTN_CAPACITY: "NTTN",
  };
  return map[val] || "";
};

const BILL_BW_MAP = {
  IIG: { col: "iig_bw", rate: "rate_iig" },
  BDIX: { col: "bdix_bw", rate: "rate_bdix" },
  GGC: { col: "ggc_bw", rate: "rate_ggc" },
  FNA: { col: "fna_bw", rate: "rate_fna" },
  CDN: { col: "cdn_bw", rate: "rate_cdn" },
  BCDN: { col: "bcdn_bw", rate: "rate_bcdn" },
  NTTN: { col: "nttn_capacity", rate: "rate_nttn" },
};

const fmtDayMon = (dateObj) => dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

const toDateOnlyString = (value) => {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = parseYMD(raw);
  if (!parsed) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
};

// Shared SQL expression to derive a canonical log_type from billing_logs.
// Uses to_jsonb for safe JSON access; falls back to change_desc heuristics
// for legacy records created before the log_type column existed.
// Once migration 20260613 has been applied (log_type NOT NULL + backfilled),
// this can be simplified to just: log_type
const LOG_TYPE_EXPR = () => `COALESCE(to_jsonb(billing_logs)->>'log_type', CASE WHEN LOWER(COALESCE(change_desc,'')) LIKE 'discount:%' THEN 'discount' WHEN COALESCE(transaction_amount,0) > 0 THEN 'payment' ELSE 'adjustment' END)`;

const LOG_TYPE_EXPR_SIMPLE = () => `COALESCE(log_type, CASE WHEN LOWER(COALESCE(change_desc,'')) LIKE 'discount:%' THEN 'discount' WHEN COALESCE(transaction_amount,0) > 0 THEN 'payment' ELSE 'adjustment' END)`;

const monthInfo = (monthStr) => {
  const y = Number(String(monthStr).slice(0, 4));
  const m = Number(String(monthStr).slice(5, 7));
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const daysInMonth = monthEnd.getDate();
  return {
    monthStart,
    monthEnd,
    daysInMonth,
    monthStartStr: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`,
    monthEndStr: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
    ym: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`,
  };
};

const getDhakaDate = (date = new Date()) => {
  const local = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
  const d = new Date(local);
  // Add simple subtract helper for month
  d.subtract = (amount, unit) => {
    if (unit === "month") {
      d.setMonth(d.getMonth() - amount);
    }
    return d;
  };
  return d;
};

const getMonthYear = (ym) => {
  const parts = String(ym).split("-");
  return {
    y: parseInt(parts[0], 10),
    m: parseInt(parts[1], 10)
  };
};

const getStartOfMonth = (y, m) => new Date(y, m - 1, 1, 0, 0, 0, 0);
const getEndOfMonth = (y, m) => new Date(y, m, 0, 23, 59, 59, 999);

// Partner-sheet webhook normalization + caps. These were imported by
// sheets.js but never defined (every webhook call 500'd). Caps bound the
// JSONB snapshot size per call.
const MAX_SHEET_HEADERS = 50;
const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_CELL = 2000;
const normalizePartnerSheetTab = (tab) => {
  const t = String(tab || '').trim();
  return PARTNER_SHEET_CONFIG[t] ? t : null;
};
const normalizePartnerSheetHeaders = (headers) => {
  if (!Array.isArray(headers)) return [];
  return headers.slice(0, MAX_SHEET_HEADERS).map((h) => String(h ?? '').slice(0, 200));
};
const cellCap = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v).slice(0, MAX_SHEET_CELL);
};
const normalizePartnerSheetRows = (rows, headers) => {
  if (!Array.isArray(rows)) return [];
  const cols = Array.isArray(headers) ? headers.length : 0;
  return rows.slice(0, MAX_SHEET_ROWS).map((r) => {
    if (Array.isArray(r)) return r.slice(0, Math.max(cols, 1)).map(cellCap);
    if (r && typeof r === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(r).slice(0, Math.max(cols, 1))) o[String(k).slice(0, 200)] = cellCap(v);
      return o;
    }
    return cellCap(r);
  });
};

module.exports = {
  LOG_TYPE_EXPR,
  LOG_TYPE_EXPR_SIMPLE,
  normalizePartnerSheetTab,
  normalizePartnerSheetHeaders,
  normalizePartnerSheetRows,
  normalizeRole,
  normalizePartnerType,
  normalizedPartnerTypeSql,
  getDhakaYmFromDate,
  getOtcAppliedMonthYm,
  isAdminRole,
  hasAnyPermission,
  canViewResellerFinancials,
  PARTNER_SHEET_CONFIG,
  GOOGLE_SHEETS_WEBHOOK_TOKEN,
  normalizeBwType,
  parseAmount,
  parseWholeNumber,
  parseBillDetailsSnapshot,
  getDhakaMonthYm,
  getDhakaDate,
  getMonthYear,
  getStartOfMonth,
  getEndOfMonth,
  previousMonthYm,
  nextMonthYm,
  monthStartDateFromYm,
  normalizeChangeType,
  normalizeBillBwType,
  BILL_BW_MAP,
  fmtDayMon,
  parseYMD,
  toDateOnlyString,
  monthInfo,
};
