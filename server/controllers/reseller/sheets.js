const pool = require("../../utilities/db");
const crypto = require("crypto");
const { fetchCsvSheet } = require("../../services/googleSheetsService");
const {
    normalizePartnerSheetTab,
    normalizePartnerSheetHeaders,
    normalizePartnerSheetRows,
    PARTNER_SHEET_CONFIG,
    GOOGLE_SHEETS_WEBHOOK_TOKEN,
} = require("./utils");
const { initialize } = require("./dbSetup");

const upsertPartnerSheetSnapshot = async ({ tab, title, headers, rows, sourceMeta = {} }) => {
    const normalizedTab = normalizePartnerSheetTab(tab);
    if (!normalizedTab) {
        throw new Error("Invalid partner sheet tab");
    }
    const sheetTitle = String(title || PARTNER_SHEET_CONFIG[normalizedTab].title).trim();
    const normalizedHeaders = normalizePartnerSheetHeaders(headers);
    const normalizedRows = normalizePartnerSheetRows(rows, normalizedHeaders);
    await pool.query(
        `INSERT INTO partner_sheet_snapshots (tab_key, title, headers, rows, source_meta, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (tab_key) DO UPDATE SET
       title = EXCLUDED.title,
       headers = EXCLUDED.headers,
       rows = EXCLUDED.rows,
       source_meta = EXCLUDED.source_meta,
       updated_at = NOW()`,
        [normalizedTab, sheetTitle, JSON.stringify(normalizedHeaders), JSON.stringify(normalizedRows), JSON.stringify(sourceMeta || {})],
    );

    return {
        tab: normalizedTab,
        title: sheetTitle,
        headers: normalizedHeaders,
        rows: normalizedRows,
        source_meta: sourceMeta,
    };
};

const readPartnerSheetSnapshot = async (tab) => {
    const normalizedTab = normalizePartnerSheetTab(tab);
    if (!normalizedTab) return null;
    const result = await pool.query(
        `SELECT tab_key AS tab, title, headers, rows, source_meta, updated_at
     FROM partner_sheet_snapshots
     WHERE tab_key = $1
     LIMIT 1`,
        [normalizedTab],
    );
    return result.rows[0] || null;
};

const getPartnerSheetList = async (req, res) => {
    try {
        const tab = String(req.query.tab || "").trim().toLowerCase();
        const config = PARTNER_SHEET_CONFIG[tab];

        if (!config) {
            return res.status(400).json({ message: "Invalid partner tab" });
        }

        res.set("Cache-Control", "private, max-age=10, must-revalidate");

        const cached = await readPartnerSheetSnapshot(tab);
        if (cached) {
            return res.json({
                tab,
                title: cached.title,
                headers: Array.isArray(cached.headers) ? cached.headers : [],
                rows: Array.isArray(cached.rows) ? cached.rows : [],
                row_count: Array.isArray(cached.rows) ? cached.rows.length : 0,
                fetched_at: cached.updated_at,
                source: "webhook-cache",
            });
        }

        const sheetUrl = String(process.env[config.envKey] || "").trim();
        if (!sheetUrl) {
            return res.status(503).json({
                message: `${config.title} sheet has no cached snapshot yet and no CSV fallback is configured`,
                env_key: config.envKey,
                hint: "Send a webhook sync first or configure the CSV URL fallback",
            });
        }

        const sheet = await fetchCsvSheet(sheetUrl);
        const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
        const headers = Array.isArray(sheet.headers) ? sheet.headers : [];

        res.json({
            tab,
            title: config.title,
            source_url: sheetUrl,
            headers,
            rows,
            row_count: rows.length,
            fetched_at: new Date().toISOString(),
            source: "csv-fallback",
        });
    } catch (error) {
        console.error("getPartnerSheetList:", error);
        res.status(500).json({ message: "Failed to load partner sheet data" });
    }
};

const ingestPartnerSheetWebhook = async (req, res) => {
    try {
        await initialize();
        if (!GOOGLE_SHEETS_WEBHOOK_TOKEN) {
            return res.status(503).json({ message: "Webhook token is not configured" });
        }

        const token = String(req.headers["x-webhook-token"] || req.body?.token || "").trim();

        // Timing-safe comparison: constant-time even on failure, prevents token oracle.
        const expectedBuf = Buffer.from(GOOGLE_SHEETS_WEBHOOK_TOKEN);
        const receivedBuf = Buffer.from(token);
        const tokenOk =
          token.length > 0 &&
          expectedBuf.length === receivedBuf.length &&
          crypto.timingSafeEqual(expectedBuf, receivedBuf);

        if (!tokenOk) {
            return res.status(401).json({ message: "Invalid webhook token" });
        }

        const tab = normalizePartnerSheetTab(req.body?.tab);
        if (!tab) {
            return res.status(400).json({ message: "Valid tab is required" });
        }

        // String caps: unbounded title/ids land in JSONB snapshots
        const title = String(req.body?.title || PARTNER_SHEET_CONFIG[tab].title).trim().slice(0, 200);
        const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        const sourceMeta = {
            spreadsheet_id: String(req.body?.spreadsheet_id || "").trim().slice(0, 200),
            sheet_name: String(req.body?.sheet_name || "").trim().slice(0, 200),
            updated_at: String(req.body?.updated_at || "").trim().slice(0, 50),
            row_count: rows.length,
        };

        const snapshot = await upsertPartnerSheetSnapshot({ tab, title, headers, rows, sourceMeta });

        res.json({
            message: "Partner sheet synced",
            tab: snapshot.tab,
            title: snapshot.title,
            row_count: snapshot.rows.length,
            updated_at: new Date().toISOString(),
        });
    } catch (error) {
        console.error("ingestPartnerSheetWebhook:", error);
        res.status(500).json({ message: "Failed to ingest partner sheet webhook" });
    }
};

module.exports = {
    getPartnerSheetList,
    ingestPartnerSheetWebhook,
};