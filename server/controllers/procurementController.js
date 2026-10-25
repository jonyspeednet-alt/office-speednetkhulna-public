const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');

const normalizeText = (value) => String(value ?? '').trim();
const parseNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const requireProcurementAccess = (req, res, mode = 'view') => {
  if (resolvePermission(req.user, 'procurement.manage')) return true;
  res.status(403).json({ message: `Unauthorized: missing procurement permission` });
  return false;
};

const ensureProcurementSchema = async () => {
  // Similar to asset schema, we could auto-create tables here if needed.
  // For now, we assume migrations are run.
};

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'ordered', 'received', 'cancelled'];
const TERMINAL_STATUSES = new Set(['received', 'cancelled']);
// Allowed forward transitions; rejected can be reopened to pending
const STATUS_TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  rejected: ['pending'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: []
};

const isValidDate = (v) => {
  if (v === null || v === undefined || v === '') return true; // optional fields
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
};

const escapeLike = (v) => String(v).replace(/[\\%_]/g, (m) => `\\${m}`);

const listPurchaseOrders = async (req, res) => {
  try {
    if (!requireProcurementAccess(req, res, 'view')) return;

    const { search = '', status = '', page, limit } = req.query;
    const conditions = [];
    const params = [];

    if (status && VALID_STATUSES.includes(String(status))) {
      params.push(String(status));
      conditions.push(`po.status = $${params.length}`);
    }

    const q = String(search || '').trim();
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      const idx = params.length;
      conditions.push(`(po.po_number ILIKE $${idx} ESCAPE '\\' OR v.name ILIKE $${idx} ESCAPE '\\')`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Paginated mode: ?page&limit → { rows, total, page, limit }
    const pageNum = parseNum(req.query.page, 0);
    if (pageNum > 0) {
      const lim = Math.min(Math.max(parseNum(limit, 20), 1), 100);
      const offset = (pageNum - 1) * lim;
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM purchase_orders po
         LEFT JOIN asset_vendors v ON v.id = po.vendor_id ${where}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;
      const dataResult = await pool.query(
        `SELECT po.*, v.name AS vendor_name, u.full_name AS creator_name,
          (SELECT COUNT(*)::int FROM purchase_order_items poi WHERE poi.po_id = po.id) AS item_count
        FROM purchase_orders po
        LEFT JOIN asset_vendors v ON v.id = po.vendor_id
        LEFT JOIN users u ON u.id = po.created_by
        ${where}
        ORDER BY po.order_date DESC, po.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, lim, offset]
      );
      return res.json({ rows: dataResult.rows, total, page: pageNum, limit: lim });
    }

    const result = await pool.query(`
      SELECT
        po.*,
        v.name AS vendor_name,
        u.full_name AS creator_name,
        (SELECT COUNT(*)::int FROM purchase_order_items poi WHERE poi.po_id = po.id) AS item_count
      FROM purchase_orders po
      LEFT JOIN asset_vendors v ON v.id = po.vendor_id
      LEFT JOIN users u ON u.id = po.created_by
      ${where}
      ORDER BY po.order_date DESC, po.id DESC
      LIMIT 200
    `, params);

    res.json(result.rows);
  } catch (error) {
    console.error('listPurchaseOrders:', error);
    res.status(500).json({ message: 'Failed to load purchase orders' });
  }
};

const getPurchaseOrderDetails = async (req, res) => {
  try {
    if (!requireProcurementAccess(req, res, 'view')) return;

    const poId = parseNum(req.params.id, 0);
    if (!poId) return res.status(400).json({ message: 'Invalid PO ID' });

    const poResult = await pool.query(`
      SELECT po.*, v.name AS vendor_name, u.full_name AS creator_name
      FROM purchase_orders po
      LEFT JOIN asset_vendors v ON v.id = po.vendor_id
      LEFT JOIN users u ON u.id = po.created_by
      WHERE po.id = $1
    `, [poId]);

    if (!poResult.rows.length) return res.status(404).json({ message: 'Purchase Order not found' });

    const itemsResult = await pool.query(`
      SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY id ASC
    `, [poId]);

    res.json({
      ...poResult.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    console.error('getPurchaseOrderDetails:', error);
    res.status(500).json({ message: 'Failed to load purchase order details' });
  }
};

const createPurchaseOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireProcurementAccess(req, res, 'manage')) return;

    const { vendor_id, order_date, expected_delivery_date, notes, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required' });
    }
    // Bulk cap: each item becomes an INSERT in one transaction
    if (items.length > 200) {
      return res.status(400).json({ message: 'At most 200 items per purchase order' });
    }
    if (vendor_id === undefined || vendor_id === null || vendor_id === '') {
      return res.status(400).json({ message: 'Vendor is required' });
    }
    if (!isValidDate(order_date) || !isValidDate(expected_delivery_date)) {
      return res.status(400).json({ message: 'Invalid date provided' });
    }
    // Date range: NaN-only check above accepts year 1900/9999 into the ledger
    for (const d of [order_date, expected_delivery_date]) {
      if (d == null || d === '') continue;
      const t = new Date(d);
      if (t < new Date('2000-01-01') || t > new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)) {
        return res.status(400).json({ message: 'Date out of allowed range' });
      }
    }

    // Validate + sanitize line items server-side
    const cleanItems = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const name = normalizeText(it.item_name);
      const qty = Number(it.quantity);
      const price = Number(it.unit_price);
      if (!name) return res.status(400).json({ message: `Item #${i + 1}: name is required` });
      if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: `Item #${i + 1}: quantity must be greater than 0` });
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: `Item #${i + 1}: unit price cannot be negative` });
      // Upper bounds: qty*price overflow → Infinity/absurd total_amount
      if (qty > 1000000) return res.status(400).json({ message: `Item #${i + 1}: quantity too large` });
      if (price > 100000000) return res.status(400).json({ message: `Item #${i + 1}: unit price too large` });
      cleanItems.push({
        item_name: name,
        description: normalizeText(it.description),
        quantity: qty,
        unit_price: price,
        total_price: qty * price
      });
    }

    const totalAmount = cleanItems.reduce((sum, item) => sum + item.total_price, 0);

    await client.query('BEGIN');

    // Verify vendor exists
    const vendorCheck = await client.query('SELECT id, name FROM asset_vendors WHERE id = $1', [parseNum(vendor_id, 0)]);
    if (!vendorCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Selected vendor does not exist' });
    }

    // Human-readable PO number: PO-YYYYMM-XXXX (monthly sequence)
    const now = new Date();
    const prefix = `PO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Serialize allocation across API workers until this transaction commits.
    // MAX preserves sequence progress when an older order has been deleted.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('purchase-order-number'), hashtext($1))", [prefix]);
    const seqResult = await client.query(
      `SELECT COALESCE(MAX(substring(po_number from '[0-9]+$')::numeric), 0) AS c
       FROM purchase_orders WHERE po_number LIKE $1 AND po_number ~ '^PO-[0-9]{6}-[0-9]+$'`,
      [`${prefix}-%`]
    );
    const seq = String(BigInt(seqResult.rows[0]?.c || 0) + 1n).padStart(4, '0');
    const poNumber = `${prefix}-${seq}`;

    const poResult = await client.query(`
      INSERT INTO purchase_orders (
        po_number, vendor_id, order_date, expected_delivery_date, total_amount, status, created_by, notes,
        vendor_name, po_date
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $3)
      RETURNING *
    `, [
      poNumber,
      parseNum(vendor_id, null),
      order_date || new Date(),
      expected_delivery_date || null,
      totalAmount,
      req.user?.id || null,
      normalizeText(notes),
      vendorCheck.rows[0].name
    ]);

    const poId = poResult.rows[0].id;

    for (const item of cleanItems) {
      await client.query(`
        INSERT INTO purchase_order_items (
          po_id, item_name, description, quantity, unit_price, total_price
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        poId,
        item.item_name,
        item.description,
        item.quantity,
        item.unit_price,
        item.total_price
      ]);
    }

    await client.query('COMMIT');
    res.status(201).json(poResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createPurchaseOrder:', error);
    res.status(500).json({ message: 'Failed to create purchase order' });
  } finally {
    client.release();
  }
};

const updatePOStatus = async (req, res) => {
  try {
    if (!requireProcurementAccess(req, res, 'manage')) return;

    const poId = parseNum(req.params.id, 0);
    const { status } = req.body;

    if (!poId || !status) return res.status(400).json({ message: 'PO ID and status are required' });
    if (!VALID_STATUSES.includes(String(status))) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` });
    }

    const current = await pool.query('SELECT status FROM purchase_orders WHERE id = $1', [poId]);
    if (!current.rows.length) return res.status(404).json({ message: 'Purchase Order not found' });

    const from = current.rows[0].status;
    const allowed = STATUS_TRANSITIONS[from] || [];
    if (TERMINAL_STATUSES.has(from) && !allowed.includes(status)) {
      return res.status(403).json({ message: `PO is ${from} — status cannot be changed` });
    }
    if (from !== status && !allowed.includes(status)) {
      return res.status(400).json({ message: `Cannot move PO from ${from} to ${status}` });
    }

    const result = await pool.query(`
      UPDATE purchase_orders
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND status = $3
      RETURNING *
    `, [status, poId, from]);

    if (!result.rows.length) return res.status(409).json({ message: 'Purchase Order changed; reload before changing its status' });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('updatePOStatus:', error);
    res.status(500).json({ message: 'Failed to update purchase order status' });
  }
};

module.exports = {
  listPurchaseOrders,
  getPurchaseOrderDetails,
  createPurchaseOrder,
  updatePOStatus
};
