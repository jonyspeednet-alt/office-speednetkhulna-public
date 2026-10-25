const XLSX = require("xlsx");
const { openFirstSheet, sanitizeRows } = require("../utilities/xlsxGuard");
const pool = require("../utilities/db");
const { lockProductMonth, financialError } = require("../utilities/channelFinancialLock");
const { initChannelPartnerTables } = require("../utilities/channelPartnerInit");
const {
  roundAmount,
  monthToServiceDate,
  sumProductDeduction,
  getProductDeductionForMonth,
  isCommissionMonthLocked,
} = require("../utilities/channelProductHelpers");
const { generateCommissionInternal } = require("./channelPartnerController");

const parseAmount = (v, d = 0) => {
  if (v === null || v === undefined || v === "") return d;
  if (typeof v === "number") return Number.isFinite(v) ? v : d;
  const cleaned = String(v)
    .replace(/[,৳$]/g, "")
    .replace(/[^0-9.-]/g, "")
    .trim();
  if (!cleaned) return d;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : d;
};

const normalizeSheetHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const getSheetValue = (row, aliases) => {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }
  const normalizedAliases = aliases.map(normalizeSheetHeader);
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeSheetHeader(key))) return value;
  }
  return undefined;
};

const listProducts = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const activeOnly = String(req.query.active_only || "1") !== "0";
    const result = await pool.query(
      `SELECT * FROM channel_products
       WHERE ($1::boolean IS FALSE OR is_active = TRUE)
       ORDER BY sort_order ASC NULLS LAST, name ASC
       LIMIT 500`,
      [activeOnly],
    );
    res.json(result.rows);
  } catch (error) {
    console.error("channelProduct.listProducts:", error);
    res.status(500).json({ message: "Failed to load products" });
  }
};

const createProduct = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const {
      product_code,
      name,
      category,
      unit_price,
      unit,
      sort_order,
      is_active,
    } = req.body;
    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    if (unit_price != null && Number(String(unit_price).replace(/[^0-9.\-]/g, '')) < 0) {
      return res.status(400).json({ message: "unit_price cannot be negative" });
    }
    const code = String(product_code || name)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 100);
    const result = await pool.query(
      `INSERT INTO channel_products
        (product_code, name, category, unit_price, unit, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (product_code) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         unit_price = EXCLUDED.unit_price,
         unit = EXCLUDED.unit,
         sort_order = EXCLUDED.sort_order,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING *`,
      [
        code,
        String(name).trim(),
        String(category || "").trim(),
        roundAmount(parseAmount(unit_price, 0)),
        String(unit || "pcs").trim(),
        parseInt(sort_order || 0, 10) || 0,
        is_active !== false,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("channelProduct.createProduct:", error);
    res.status(500).json({ message: "Failed to save product" });
  }
};

const updateProduct = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { productId } = req.params;
    const { name, category, unit_price, unit, sort_order, is_active } = req.body;
    if (unit_price != null && Number(String(unit_price).replace(/[^0-9.\-]/g, '')) < 0) {
      return res.status(400).json({ message: "unit_price cannot be negative" });
    }
    const result = await pool.query(
      `UPDATE channel_products SET
        name = COALESCE($1, name),
        category = COALESCE($2, category),
        unit_price = COALESCE($3, unit_price),
        unit = COALESCE($4, unit),
        sort_order = COALESCE($5, sort_order),
        is_active = COALESCE($6, is_active),
        updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        name != null ? String(name).trim() : null,
        category != null ? String(category).trim() : null,
        unit_price != null ? roundAmount(parseAmount(unit_price, 0)) : null,
        unit != null ? String(unit).trim() : null,
        sort_order != null ? parseInt(sort_order, 10) : null,
        is_active != null ? Boolean(is_active) : null,
        productId,
      ],
    );
    if (!result.rows.length) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("channelProduct.updateProduct:", error);
    res.status(500).json({ message: "Failed to update product" });
  }
};

const importProducts = async (req, res) => {
  try {
    await initChannelPartnerTables();
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    // S14: guarded parse (type check + row cap + proto-key strip)
    let worksheet;
    try {
      ({ worksheet } = await openFirstSheet(req.file));
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }

    // Detect if first row is a merged "Product" title row by reading header: 1
    const rowsRaw = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    let rangeOption = 0;
    if (rowsRaw.length > 1) {
      const firstRow = rowsRaw[0];
      const nonEmptyCount = firstRow.filter((cell) => cell !== undefined && cell !== "").length;
      if (nonEmptyCount === 1 && String(firstRow[0] || "").toLowerCase().includes("product")) {
        rangeOption = 1; // Skip the "Product" title row
      }
    }

    const rows = sanitizeRows(XLSX.utils.sheet_to_json(worksheet, {
      range: rangeOption,
      defval: "",
    }));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const name = getSheetValue(row, [
        "Product Discription",
        "Product Description",
        "name",
        "product_name",
        "product",
        "পণ্য",
        "প্রোডাক্ট",
      ]);
      if (!String(name || "").trim()) {
        skipped += 1;
        continue;
      }
      const codeRaw = getSheetValue(row, [
        "product_code",
        "code",
        "sku",
        "id",
        "কোড",
      ]);
      const code = String(codeRaw || name)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .slice(0, 100);
      const price = roundAmount(
        parseAmount(
          getSheetValue(row, [
            "Price",
            "unit_price",
            "price",
            "rate",
            "amount",
            "দাম",
            "মূল্য",
          ]),
          0,
        ),
      );
      if (price < 0) { skipped += 1; continue; }
      const category = String(
        getSheetValue(row, ["category", "type", "ক্যাটাগরি"]) || "",
      ).trim();
      const unit = String(
        getSheetValue(row, ["unit", "ইউনিট"]) || "pcs",
      ).trim();

      const existing = await pool.query(
        `SELECT id FROM channel_products WHERE product_code = $1`,
        [code],
      );
      await pool.query(
        `INSERT INTO channel_products
          (product_code, name, category, unit_price, unit, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (product_code) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           unit_price = EXCLUDED.unit_price,
           unit = EXCLUDED.unit,
           updated_at = NOW()`,
        [code, String(name).trim(), category, price, unit],
      );
      if (existing.rows.length) updated += 1;
      else created += 1;
    }

    res.json({
      total: rows.length,
      created,
      updated,
      skipped,
    });
  } catch (error) {
    console.error("channelProduct.importProducts:", error);
    res.status(500).json({ message: "Failed to import products" });
  }
};

const getUserProducts = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, userId } = req.params;
    const month = req.query.month;
    const serviceMonth = monthToServiceDate(month);
    if (!serviceMonth) {
      return res.status(400).json({ message: "Valid month (YYYY-MM) required" });
    }

    const [catalog, usage] = await Promise.all([
      pool.query(
        `SELECT * FROM channel_products WHERE is_active = TRUE ORDER BY sort_order ASC NULLS LAST, name ASC`,
      ),
      pool.query(
        `SELECT u.*, p.name AS product_name, p.product_code
         FROM channel_user_product_usage u
         JOIN channel_products p ON p.id = u.product_id
         WHERE u.reseller_id = $1 AND u.user_id = $2 AND u.service_month = $3::date`,
        [resellerId, userId, serviceMonth],
      ),
    ]);

    res.json({
      month,
      catalog: catalog.rows,
      usage: usage.rows,
      line_total: roundAmount(
        usage.rows.reduce((s, r) => s + Number(r.line_total || 0), 0),
      ),
    });
  } catch (error) {
    console.error("channelProduct.getUserProducts:", error);
    res.status(500).json({ message: "Failed to load user products" });
  }
};

const saveUserProducts = async (req, res) => {
  const client = await pool.connect();
  try {
    await initChannelPartnerTables();
    const { resellerId, userId } = req.params;
    const { month, items } = req.body;
    const serviceMonth = monthToServiceDate(month);
    if (!serviceMonth) {
      return res.status(400).json({ message: "Valid month (YYYY-MM) required" });
    }
    if (await isCommissionMonthLocked(resellerId, month)) {
      return res.status(403).json({
        message: "This month is finalized. Product usage cannot be changed.",
      });
    }

    if (!Array.isArray(items) || items.length > 200 || items.some((item) => !item ||
        !Number.isSafeInteger(Number(item.product_id)) || Number(item.product_id) <= 0 ||
        !Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0) ||
        new Set(items.map((item) => Number(item.product_id))).size !== items.length) {
      return res.status(400).json({ message: 'items must contain at most 200 valid unique products and nonnegative quantities' });
    }
    const normalizedItems = items;
    const activeIds = normalizedItems
      .filter((i) => Number(i.quantity || 0) > 0)
      .map((i) => Number(i.product_id))
      .filter(Boolean);

    await client.query("BEGIN");
    await lockProductMonth(client, resellerId, month);
    const userCheck = await client.query(
      `SELECT id FROM channel_partner_users WHERE id = $1 AND reseller_id = $2 FOR UPDATE`,
      [userId, resellerId],
    );
    if (!userCheck.rows.length) {
      throw financialError(404, "User not found");
    }



    if (activeIds.length === 0) {
      await client.query(
        `DELETE FROM channel_user_product_usage
         WHERE reseller_id = $1 AND user_id = $2 AND service_month = $3::date`,
        [resellerId, userId, serviceMonth],
      );
    } else {
      await client.query(
        `DELETE FROM channel_user_product_usage
         WHERE reseller_id = $1 AND user_id = $2 AND service_month = $3::date
           AND product_id <> ALL($4::int[])`,
        [resellerId, userId, serviceMonth, activeIds],
      );
    }

    for (const item of normalizedItems) {
      const productId = Number(item.product_id);
      const qty = roundAmount(parseAmount(item.quantity, 0));
      if (!productId || qty <= 0) continue;

      const productResult = await client.query(
        `SELECT id, unit_price FROM channel_products WHERE id = $1 AND is_active = TRUE`,
        [productId],
      );
      if (!productResult.rows.length) continue;

      const unitPrice = roundAmount(productResult.rows[0].unit_price);
      const lineTotal = roundAmount(qty * unitPrice);

      await client.query(
        `INSERT INTO channel_user_product_usage
          (reseller_id, user_id, product_id, service_month, quantity, unit_price_snapshot, line_total, note, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, product_id, service_month) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           unit_price_snapshot = EXCLUDED.unit_price_snapshot,
           line_total = EXCLUDED.line_total,
           note = EXCLUDED.note,
           updated_at = NOW()
         WHERE channel_user_product_usage.reseller_id=EXCLUDED.reseller_id`,
        [
          resellerId,
          userId,
          productId,
          serviceMonth,
          qty,
          unitPrice,
          lineTotal,
          String(item.note || "").trim(),
          req.user?.id || null,
        ],
      );
    }

    await client.query("COMMIT");

    try {
      await generateCommissionInternal(resellerId, month);
    } catch (ce) {
      console.warn("Commission sync after user product save failed:", ce.message);
    }

    const total = await getProductDeductionForMonth(resellerId, month);
    res.json({ success: true, product_deduction_month: total });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    console.error("channelProduct.saveUserProducts:", error);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to save user products" });
  } finally {
    client.release();
  }
};

const getPartnerProductUsage = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.query.month;
    const serviceMonth = monthToServiceDate(month);
    if (!serviceMonth) {
      return res.status(400).json({ message: "Valid month (YYYY-MM) required" });
    }

    const result = await pool.query(
      `SELECT
        u.id AS usage_id,
        u.user_id,
        cpu.user_name,
        cpu.user_id_code,
        u.product_id,
        p.name AS product_name,
        p.product_code,
        u.quantity,
        u.unit_price_snapshot,
        u.line_total
       FROM channel_user_product_usage u
       JOIN channel_partner_users cpu ON cpu.id = u.user_id
       JOIN channel_products p ON p.id = u.product_id
       WHERE u.reseller_id = $1 AND u.service_month = $2::date
       ORDER BY cpu.user_name ASC, p.name ASC`,
      [resellerId, serviceMonth],
    );

    const total = roundAmount(
      result.rows.reduce((s, r) => s + Number(r.line_total || 0), 0),
    );

    res.json({ month, items: result.rows, total_product_deduction: total });
  } catch (error) {
    console.error("channelProduct.getPartnerProductUsage:", error);
    res.status(500).json({ message: "Failed to load product usage" });
  }
};

const getProductSummary = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.query.month;
    const serviceMonth = monthToServiceDate(month);
    if (!serviceMonth) {
      return res.status(400).json({ message: "Valid month (YYYY-MM) required" });
    }

    const [byProduct, byUser, total] = await Promise.all([
      pool.query(
        `SELECT p.id, p.name, p.product_code,
                COALESCE(SUM(u.quantity), 0)::numeric AS total_qty,
                COALESCE(SUM(u.line_total), 0)::numeric AS total_amount
         FROM channel_user_product_usage u
         JOIN channel_products p ON p.id = u.product_id
         WHERE u.reseller_id = $1 AND u.service_month = $2::date
         GROUP BY p.id, p.name, p.product_code
         ORDER BY total_amount DESC`,
        [resellerId, serviceMonth],
      ),
      pool.query(
        `SELECT cpu.id AS user_id, cpu.user_name, cpu.user_id_code,
                COALESCE(SUM(u.line_total), 0)::numeric AS total_amount,
                COUNT(u.id)::int AS product_count
         FROM channel_partner_users cpu
         LEFT JOIN channel_user_product_usage u
           ON u.user_id = cpu.id AND u.reseller_id = cpu.reseller_id
          AND u.service_month = $2::date
         WHERE cpu.reseller_id = $1
         GROUP BY cpu.id, cpu.user_name, cpu.user_id_code
         HAVING COALESCE(SUM(u.line_total), 0) > 0
         ORDER BY total_amount DESC`,
        [resellerId, serviceMonth],
      ),
      getProductDeductionForMonth(resellerId, month),
    ]);

    res.json({
      month,
      total_product_deduction: total,
      by_product: byProduct.rows,
      by_user: byUser.rows,
    });
  } catch (error) {
    console.error("channelProduct.getProductSummary:", error);
    res.status(500).json({ message: "Failed to load product summary" });
  }
};

/**
 * POST /:resellerId/products/import-usage
 * Bulk-import user-product usage from an Excel file.
 *
 * Expected columns (flexible aliases):
 *   User ID / User Code / user_id_code
 *   User Name / name
 *   Product / Product Name / Product Description
 *   Qty / Quantity
 *   Price / Unit Price / Rate        (optional – falls back to catalog price)
 *   Month / service_month            (optional – falls back to ?month query param)
 */
const importUserProductUsage = async (req, res) => {
  const client = await pool.connect();
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.query.month; // "YYYY-MM"
    const serviceMonth = monthToServiceDate(month);
    if (!serviceMonth) {
      return res.status(400).json({ message: "Valid ?month=YYYY-MM required" });
    }
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    console.log("[ImportUsage] Incoming request resellerId:", resellerId, "month:", month);

    if (await isCommissionMonthLocked(resellerId, month)) {
      return res.status(403).json({
        message: "This month is finalized. Product usage cannot be changed.",
      });
    }

    // ── Parse Excel (S14: guarded) ───────────────────────────────────────────
    let worksheet;
    try {
      ({ worksheet } = await openFirstSheet(req.file));
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Auto-detect header row (skip title/merged rows with 1 or fewer columns)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      const row = rawRows[i];
      const nonEmptyCount = row.filter((cell) => cell !== undefined && cell !== "").length;
      if (nonEmptyCount <= 1) continue;

      const joined = row.map((c) => String(c || "").toLowerCase()).join(" ");
      if (joined.includes("user") || joined.includes("product") || joined.includes("qty") || joined.includes("description") || joined.includes("quantity")) {
        headerRowIdx = i;
        break;
      }
    }
    const rows = sanitizeRows(XLSX.utils.sheet_to_json(worksheet, {
      range: headerRowIdx,
      defval: "",
    }));

    // Detect if this is user-wise or reseller-wide.
    const keys = rows.length > 0 ? Object.keys(rows[0]).map(normalizeSheetHeader) : [];
    const isUserWise = keys.some(k => 
      k.includes("user") || 
      k.includes("client") || 
      k.includes("customer") || 
      k.includes("subscriber") || 
      k.includes("partner") || 
      k.includes("member")
    );

    console.log("[ImportUsage] Excel parsed rows count:", rows.length, "keys:", keys, "isUserWise:", isUserWise);

    if (!isUserWise) {
      // Reseller-wide total product usage import
      let totalSum = 0;
      const itemsList = [];
      let catalogCreated = 0;
      let catalogUpdated = 0;

      await client.query("BEGIN");
      await lockProductMonth(client, resellerId, month);

      for (const row of rows) {
        const name = getSheetValue(row, [
          "Product Discription",
          "Product Description",
          "name",
          "product_name",
          "product",
          "পণ্য",
          "প্রোডাক্ট",
        ]);
        if (!String(name || "").trim()) continue;

        const codeRaw = getSheetValue(row, [
          "product_code",
          "code",
          "sku",
          "id",
          "কোড",
        ]);
        const code = String(codeRaw || name)
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_")
          .slice(0, 100);

        const qty = roundAmount(
          parseAmount(getSheetValue(row, ["Qty", "Quantity", "qty", "পরিমাণ"]), 0),
        );
        const price = roundAmount(
          parseAmount(
            getSheetValue(row, [
              "Price",
              "Unit Price",
              "Rate",
              "unit_price",
              "price",
              "rate",
              "amount",
              "দাম",
              "মূল্য",
            ]),
            0,
          ),
        );

        if (qty <= 0) continue;

        const amount = parseAmount(
          getSheetValue(row, [
            "Amount",
            "Total Amount",
            "total_amount",
            "মোট দাম",
            "মোট মূল্য",
          ]),
          -1,
        );
        const lineTotal = roundAmount(amount >= 0 ? amount : qty * price);
        totalSum = roundAmount(totalSum + lineTotal);

        itemsList.push(`${String(name).trim()} (${qty} ${price > 0 ? `@ ${price} ৳` : ''})`);

        // Also upsert this product into channel_products (so the catalog is updated)
        const existing = await client.query(
          `SELECT id FROM channel_products WHERE product_code = $1`,
          [code],
        );
        await client.query(
          `INSERT INTO channel_products
            (product_code, name, category, unit_price, is_active)
           VALUES ($1, $2, '', $3, TRUE)
           ON CONFLICT (product_code) DO UPDATE SET
             name = EXCLUDED.name,
             unit_price = EXCLUDED.unit_price,
             updated_at = NOW()`,
          [code, String(name).trim(), price],
        );
        if (existing.rows.length) catalogUpdated += 1;
        else catalogCreated += 1;
      }

      // Save to channel_partner_manual_product_charges
      const note = `Excel Import: ${itemsList.join(", ")}`;
      await client.query(
        `INSERT INTO channel_partner_manual_product_charges
          (reseller_id, month, amount, note, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (reseller_id, month) DO UPDATE SET
           amount = EXCLUDED.amount,
           note = EXCLUDED.note,
           updated_at = NOW()`,
        [resellerId, month, totalSum, note.slice(0, 1000), req.user?.id || null],
      );

      await client.query("COMMIT");

      try {
        await generateCommissionInternal(resellerId, month);
      } catch (ce) {
        console.warn("Commission sync after partner total product import failed:", ce.message);
      }

      const total = await getProductDeductionForMonth(resellerId, month);
      return res.json({
        success: true,
        type: "partner_total",
        saved: rows.length,
        total_rows: rows.length,
        total_product_deduction: total,
        catalog_created: catalogCreated,
        catalog_updated: catalogUpdated,
        amount: totalSum,
      });
    }

    // ── Load DB lookup tables ─────────────────────────────────────────────────
    const [usersRes, productsRes] = await Promise.all([
      pool.query(
        `SELECT id, user_name, user_id_code FROM channel_partner_users WHERE reseller_id = $1`,
        [resellerId],
      ),
      pool.query(
        `SELECT id, name, product_code, unit_price FROM channel_products WHERE is_active = TRUE`,
      ),
    ]);

    // Build lookup maps (lowercase for fuzzy matching)
    const userByCode = {};
    const userByName = {};
    for (const u of usersRes.rows) {
      if (u.user_id_code) userByCode[String(u.user_id_code).trim().toLowerCase()] = u;
      if (u.user_name) userByName[String(u.user_name).trim().toLowerCase()] = u;
    }

    const productByName = {};
    const productByCode = {};
    for (const p of productsRes.rows) {
      if (p.name) productByName[String(p.name).trim().toLowerCase()] = p;
      if (p.product_code) productByCode[String(p.product_code).trim().toLowerCase()] = p;
    }

    const resolveUser = (row) => {
      const codeRaw = getSheetValue(row, [
        "User ID", "User Code", "user_id_code", "User ID Code", "ID", "ইউজার আইডি",
      ]);
      if (codeRaw) {
        const u = userByCode[String(codeRaw).trim().toLowerCase()];
        if (u) return u;
      }
      const nameRaw = getSheetValue(row, [
        "User Name", "user_name", "Name", "নাম", "ইউজার",
      ]);
      if (nameRaw) {
        return userByName[String(nameRaw).trim().toLowerCase()] || null;
      }
      return null;
    };

    const resolveProduct = (row) => {
      const nameRaw = getSheetValue(row, [
        "Product", "Product Name", "Product Discription", "Product Description",
        "product_name", "পণ্য", "প্রোডাক্ট",
      ]);
      if (nameRaw) {
        const key = String(nameRaw).trim().toLowerCase();
        if (productByName[key]) return productByName[key];
        // fuzzy: starts-with
        for (const [k, p] of Object.entries(productByName)) {
          if (k.startsWith(key.slice(0, 6)) || key.startsWith(k.slice(0, 6))) return p;
        }
      }
      const codeRaw = getSheetValue(row, ["product_code", "code", "sku"]);
      if (codeRaw) return productByCode[String(codeRaw).trim().toLowerCase()] || null;
      return null;
    };

    // ── Process rows ──────────────────────────────────────────────────────────
    let saved = 0;
    let skipped = 0;
    const errors = [];

    await client.query("BEGIN");
    await lockProductMonth(client, resellerId, month);
    const lockedOwners = await client.query('SELECT id FROM channel_partner_users WHERE reseller_id=$1 ORDER BY id FOR UPDATE', [resellerId]);
    const ownedUserIds = new Set(lockedOwners.rows.map((row) => Number(row.id)));
    for (const row of rows) {
      const user = resolveUser(row);
      const product = resolveProduct(row);
      const qty = roundAmount(
        parseAmount(getSheetValue(row, ["Qty", "Quantity", "qty", "পরিমাণ"]), 0),
      );

      if (!user) {
        const label = getSheetValue(row, ["User ID", "User Name", "User Code", "Name"]);
        if (label) errors.push(`ইউজার পাওয়া যায়নি: "${label}"`);
        skipped++;
        continue;
      }
      if (!product) {
        const label = getSheetValue(row, ["Product", "Product Name", "Product Discription"]);
        if (label) errors.push(`প্রোডাক্ট পাওয়া যায়নি: "${label}"`);
        skipped++;
        continue;
      }
      if (qty <= 0) {
        skipped++;
        continue;
      }

      if (!ownedUserIds.has(Number(user.id))) throw financialError(403, "Product user does not belong to this reseller");

      // Price: use Excel value if provided, else catalog price
      const excelPrice = parseAmount(
        getSheetValue(row, ["Price", "Unit Price", "Rate", "unit_price", "দাম", "মূল্য"]),
        -1,
      );
      const unitPrice = roundAmount(excelPrice >= 0 ? excelPrice : Number(product.unit_price));
      const lineTotal = roundAmount(qty * unitPrice);

      await client.query(
        `INSERT INTO channel_user_product_usage
          (reseller_id, user_id, product_id, service_month, quantity, unit_price_snapshot, line_total, note, created_by)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)
         ON CONFLICT (user_id, product_id, service_month) DO UPDATE SET
           quantity              = EXCLUDED.quantity,
           unit_price_snapshot   = EXCLUDED.unit_price_snapshot,
           line_total            = EXCLUDED.line_total,
           note                  = EXCLUDED.note,
           updated_at            = NOW()
         WHERE channel_user_product_usage.reseller_id=EXCLUDED.reseller_id`,
        [
          resellerId,
          user.id,
          product.id,
          serviceMonth,
          qty,
          unitPrice,
          lineTotal,
          "",
          req.user?.id || null,
        ],
      );
      saved++;
    }
    await client.query("COMMIT");

    try {
      await generateCommissionInternal(resellerId, month);
    } catch (ce) {
      console.warn("Commission sync after user product import failed:", ce.message);
    }

    const total = await getProductDeductionForMonth(resellerId, month);
    res.json({
      saved,
      skipped,
      total_rows: rows.length,
      total_product_deduction: total,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore */ }
    console.error("channelProduct.importUserProductUsage:", error);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to import product usage" });
  } finally {
    client.release();
  }
};

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  importProducts,
  importUserProductUsage,
  getUserProducts,
  saveUserProducts,
  getPartnerProductUsage,
  getProductSummary,
};
