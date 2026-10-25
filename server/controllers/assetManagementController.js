const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');
const { DESK_SEED_ROWS } = require('../data/deskSeedData');

// Escape LIKE wildcards so search input can't inject %/_ patterns
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

let schemaInitPromise = null;
let schemaReady = false;

const DEFAULT_OFFICES = [
  { code: 'HQ', name: 'Head Office', office_type: 'head_office', sort_order: 1 },
  { code: 'BR-1', name: 'Boyra Branch', office_type: 'branch_office', sort_order: 2 },
  { code: 'BR-2', name: 'Gollamari Branch', office_type: 'branch_office', sort_order: 3 },
  { code: 'BR-3', name: 'Sonadanga Branch', office_type: 'branch_office', sort_order: 4 }
];

const normalizeText = (value) => String(value ?? '').trim();
const normalizeSlug = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const parseNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parseOptionalNum = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

const parseDateOrNull = (value) => {
  const text = normalizeText(value);
  return text || null;
};

const normalizeDeskFloor = (value) => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  if (['ground', 'ground floor', 'gf', 'g floor'].includes(text)) return 'Ground Floor';
  if (['1', '1st', '1st floor', 'first', 'first floor', 'level 1', 'l1'].includes(text)) return '1st Floor';
  return null;
};

const resolveExistingUserId = async (db, userId) => {
  const id = parseOptionalNum(userId);
  if (!id || id <= 0) return null;
  const result = await db.query(`SELECT id FROM users WHERE id = $1`, [id]);
  return result.rows.length ? id : null;
};

const resolveAuditUserId = async (userId, db = pool) => resolveExistingUserId(db, userId);

const requireAssetAccess = (req, res, mode = 'view') => {
  const permissions = mode === 'manage' ? ['assets.manage', 'assets.view'] : ['assets.view', 'assets.manage'];
  if (permissions.some((key) => resolvePermission(req.user, key))) return true;
  res.status(403).json({ message: `Unauthorized: missing asset ${mode} permission` });
  return false;
};

const ensureAssetSchema = async () => {
  if (schemaReady) return;
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_offices (
          id BIGSERIAL PRIMARY KEY,
          code VARCHAR(40) NOT NULL UNIQUE,
          name VARCHAR(150) NOT NULL,
          office_type VARCHAR(30) NOT NULL DEFAULT 'branch_office',
          address TEXT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_desks (
          id BIGSERIAL PRIMARY KEY,
          office_id BIGINT NOT NULL REFERENCES asset_offices(id) ON DELETE CASCADE,
          desk_no VARCHAR(40) NOT NULL,
          desk_label VARCHAR(120) NULL,
          location_note TEXT NULL,
          official_email VARCHAR(160) NULL,
          assigned_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(office_id, desk_no)
        )
      `);
      await pool.query(`ALTER TABLE asset_desks ADD COLUMN IF NOT EXISTS official_email VARCHAR(160) NULL`);
      await pool.query(`ALTER TABLE asset_desks ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
      await pool.query(`ALTER TABLE asset_desks ADD COLUMN IF NOT EXISTS assignment_notes TEXT NULL`);
      await pool.query(`ALTER TABLE asset_desks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL`);
      await pool.query(`ALTER TABLE asset_desks ADD COLUMN IF NOT EXISTS floor_label VARCHAR(40) NULL`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_desk_assignments (
          id BIGSERIAL PRIMARY KEY,
          desk_id BIGINT NOT NULL REFERENCES asset_desks(id) ON DELETE CASCADE,
          assigned_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          official_email VARCHAR(160) NULL,
          assigned_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          notes TEXT NULL
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_categories (
          id BIGSERIAL PRIMARY KEY,
          name VARCHAR(120) NOT NULL UNIQUE,
          slug VARCHAR(140) NOT NULL UNIQUE,
          parent_id BIGINT NULL REFERENCES asset_categories(id) ON DELETE SET NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_vendors (
          id BIGSERIAL PRIMARY KEY,
          name VARCHAR(160) NOT NULL UNIQUE,
          contact_person VARCHAR(160) NULL,
          phone VARCHAR(40) NULL,
          email VARCHAR(160) NULL,
          warranty_contact TEXT NULL,
          notes TEXT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS assets (
          id BIGSERIAL PRIMARY KEY,
          asset_tag VARCHAR(80) NOT NULL UNIQUE,
          asset_name VARCHAR(180) NOT NULL,
          category_id BIGINT NULL REFERENCES asset_categories(id) ON DELETE SET NULL,
          vendor_id BIGINT NULL REFERENCES asset_vendors(id) ON DELETE SET NULL,
          office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          assigned_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          brand VARCHAR(120) NULL,
          model VARCHAR(160) NULL,
          serial_number VARCHAR(160) NULL,
          purchase_date DATE NULL,
          purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          warranty_start_date DATE NULL,
          warranty_end_date DATE NULL,
          warranty_type VARCHAR(60) NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'in_stock',
          condition VARCHAR(30) NOT NULL DEFAULT 'good',
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_movements (
          id BIGSERIAL PRIMARY KEY,
          asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          from_office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          from_desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          to_office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          to_desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          moved_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NULL,
          moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_warranties (
          id BIGSERIAL PRIMARY KEY,
          asset_id BIGINT NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
          vendor_id BIGINT NULL REFERENCES asset_vendors(id) ON DELETE SET NULL,
          warranty_type VARCHAR(80) NULL,
          warranty_start_date DATE NULL,
          warranty_end_date DATE NULL,
          coverage_notes TEXT NULL,
          claim_count INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(30) NOT NULL DEFAULT 'active',
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_issues (
          id BIGSERIAL PRIMARY KEY,
          asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          reported_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          issue_title VARCHAR(180) NOT NULL,
          issue_description TEXT NULL,
          severity VARCHAR(30) NOT NULL DEFAULT 'medium',
          status VARCHAR(30) NOT NULL DEFAULT 'open',
          warranty_claimed BOOLEAN NOT NULL DEFAULT FALSE,
          reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ NULL,
          resolution_notes TEXT NULL,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_repairs (
          id BIGSERIAL PRIMARY KEY,
          issue_id BIGINT NULL REFERENCES asset_issues(id) ON DELETE SET NULL,
          asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          vendor_id BIGINT NULL REFERENCES asset_vendors(id) ON DELETE SET NULL,
          technician_name VARCHAR(160) NULL,
          repair_action TEXT NOT NULL,
          parts_used TEXT NULL,
          repair_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
          started_at TIMESTAMPTZ NULL,
          completed_at TIMESTAMPTZ NULL,
          outcome VARCHAR(80) NULL,
          notes TEXT NULL,
          created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_replacements (
          id BIGSERIAL PRIMARY KEY,
          old_asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          new_asset_id BIGINT NULL REFERENCES assets(id) ON DELETE SET NULL,
          replacement_reason TEXT NOT NULL,
          disposal_method VARCHAR(80) NULL,
          approved_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          disposed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_stock_items (
          id BIGSERIAL PRIMARY KEY,
          item_code VARCHAR(80) NOT NULL UNIQUE,
          item_name VARCHAR(180) NOT NULL,
          item_type VARCHAR(60) NOT NULL DEFAULT 'spare',
          category_id BIGINT NULL REFERENCES asset_categories(id) ON DELETE SET NULL,
          vendor_id BIGINT NULL REFERENCES asset_vendors(id) ON DELETE SET NULL,
          office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          quantity_on_hand INTEGER NOT NULL DEFAULT 0,
          minimum_quantity INTEGER NOT NULL DEFAULT 0,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          serial_number VARCHAR(160) NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'available',
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_stock_movements (
          id BIGSERIAL PRIMARY KEY,
          stock_item_id BIGINT NOT NULL REFERENCES asset_stock_items(id) ON DELETE CASCADE,
          movement_type VARCHAR(30) NOT NULL,
          quantity_change INTEGER NOT NULL,
          from_office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          from_desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          to_office_id BIGINT NULL REFERENCES asset_offices(id) ON DELETE SET NULL,
          to_desk_id BIGINT NULL REFERENCES asset_desks(id) ON DELETE SET NULL,
          moved_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NULL,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_components (
          id BIGSERIAL PRIMARY KEY,
          asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          component_type VARCHAR(60) NOT NULL,
          component_name VARCHAR(160) NOT NULL,
          brand VARCHAR(120) NULL,
          model VARCHAR(160) NULL,
          serial_number VARCHAR(160) NULL,
          specification TEXT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'active',
          installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          replaced_at TIMESTAMPTZ NULL,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS asset_component_movements (
          id BIGSERIAL PRIMARY KEY,
          asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          component_id BIGINT NULL REFERENCES asset_components(id) ON DELETE SET NULL,
          movement_type VARCHAR(30) NOT NULL,
          from_component_id BIGINT NULL REFERENCES asset_components(id) ON DELETE SET NULL,
          to_component_id BIGINT NULL REFERENCES asset_components(id) ON DELETE SET NULL,
          moved_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT NULL,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_offices_active ON asset_offices(is_active, sort_order)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_desks_office ON asset_desks(office_id, is_active)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_categories_active ON asset_categories(is_active, name)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_assets_office_desk ON assets(office_id, desk_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_movements_asset ON asset_movements(asset_id, moved_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_warranties_status ON asset_warranties(status, warranty_end_date)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_issues_asset ON asset_issues(asset_id, status, reported_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_repairs_asset ON asset_repairs(asset_id, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_replacements_old_asset ON asset_replacements(old_asset_id, replaced_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_stock_items_status ON asset_stock_items(status, item_name)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_stock_items_low ON asset_stock_items(minimum_quantity, quantity_on_hand)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_stock_movements_item ON asset_stock_movements(stock_item_id, created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_components_asset ON asset_components(asset_id, status, installed_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_asset_component_movements_asset ON asset_component_movements(asset_id, created_at DESC)`);

      for (const office of DEFAULT_OFFICES) {
        await pool.query(
          `INSERT INTO asset_offices (code, name, office_type, sort_order, is_active)
           VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT (code) DO NOTHING`,
          [office.code, office.name, office.office_type, office.sort_order]
        );
      }

      for (const office of DEFAULT_OFFICES) {
        await pool.query(
          `UPDATE asset_offices
           SET name = $1, office_type = $2, sort_order = $3, updated_at = NOW()
           WHERE code = $4`,
          [office.name, office.office_type, office.sort_order, office.code]
        );
      }

      const deskCountResult = await pool.query(`SELECT COUNT(*)::int AS total FROM asset_desks`);
      if ((deskCountResult.rows[0]?.total || 0) === 0) {
        const officeRows = await pool.query(`SELECT id, code FROM asset_offices WHERE code = ANY($1::text[])`, [DEFAULT_OFFICES.map((office) => office.code)]);
        const officeMap = new Map(officeRows.rows.map((office) => [office.code, office.id]));

        for (const desk of DESK_SEED_ROWS) {
          const officeId = officeMap.get(desk.officeCode) || officeMap.get('HQ');
          if (!officeId) continue;
          const assignedAt = desk.assignedUserId ? new Date() : null;
          const inserted = await pool.query(
            `INSERT INTO asset_desks (office_id, desk_no, desk_label, location_note, official_email, assigned_user_id, assigned_at, floor_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (office_id, desk_no)
             DO UPDATE SET
               desk_label = EXCLUDED.desk_label,
               location_note = EXCLUDED.location_note,
               official_email = EXCLUDED.official_email,
               assigned_user_id = EXCLUDED.assigned_user_id,
               assigned_at = EXCLUDED.assigned_at,
               floor_label = EXCLUDED.floor_label,
               updated_at = NOW()
              RETURNING id`,
            [
              officeId,
              desk.deskNo,
              desk.deskLabel,
              null,
              desk.officialEmail,
              desk.assignedUserId || null,
              assignedAt,
              null
            ]
          );

          if (desk.assignedUserId) {
            await pool.query(
              `INSERT INTO asset_desk_assignments (desk_id, assigned_user_id, official_email, assigned_by, notes)
               VALUES ($1, $2, $3, $4, $5)`,
              [inserted.rows[0].id, desk.assignedUserId, desk.officialEmail, null, 'Seeded from desk registry import']
            );
          }
        }
      }

      await pool.query(`
        INSERT INTO asset_categories (name, slug)
        VALUES
          ('PC', 'pc'),
          ('Monitor', 'monitor'),
          ('UPS', 'ups'),
          ('Router', 'router'),
          ('Switch', 'switch'),
          ('Printer', 'printer'),
          ('Accessory', 'accessory')
        ON CONFLICT (slug) DO NOTHING
      `);

      schemaReady = true;
    })().catch((error) => {
      schemaInitPromise = null;
      throw error;
    });
  }
  await schemaInitPromise;
};

const syncAssetWarranty = async (executor, assetId, warrantyData = {}) => {
  const vendorId = warrantyData.vendor_id ? parseNum(warrantyData.vendor_id, null) : null;
  const warrantyType = normalizeText(warrantyData.warranty_type) || null;
  const warrantyStartDate = parseDateOrNull(warrantyData.warranty_start_date);
  const warrantyEndDate = parseDateOrNull(warrantyData.warranty_end_date);
  const coverageNotes = normalizeText(warrantyData.coverage_notes) || null;
  const notes = normalizeText(warrantyData.notes) || null;

  await executor.query(
    `INSERT INTO asset_warranties (
      asset_id, vendor_id, warranty_type, warranty_start_date, warranty_end_date, coverage_notes, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (asset_id) DO UPDATE SET
      vendor_id = EXCLUDED.vendor_id,
      warranty_type = EXCLUDED.warranty_type,
      warranty_start_date = EXCLUDED.warranty_start_date,
      warranty_end_date = EXCLUDED.warranty_end_date,
      coverage_notes = EXCLUDED.coverage_notes,
      notes = EXCLUDED.notes,
      updated_at = NOW()`,
    [assetId, vendorId, warrantyType, warrantyStartDate, warrantyEndDate, coverageNotes, notes]
  );
};

const makeStockCode = (name) => {
  const slug = normalizeSlug(name).replace(/-/g, '').slice(0, 20).toUpperCase();
  return slug || `STK-${Date.now()}`;
};

const getMasterData = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const [offices, desks, categories, vendors, users] = await Promise.all([
      pool.query(`SELECT * FROM asset_offices ORDER BY sort_order ASC, id ASC`),
      pool.query(`SELECT
                    d.*,
                    o.name AS office_name,
                    o.code AS office_code,
                    u.full_name AS assigned_user_name,
                    u.email AS assigned_user_email,
                    u.designation AS assigned_user_designation,
                    u.department AS assigned_user_department,
                    COALESCE(asset_stats.asset_count, 0)::int AS asset_count,
                    COALESCE(stock_stats.stock_count, 0)::int AS stock_count,
                    COALESCE(issue_stats.issue_count, 0)::int AS issue_count
                  FROM asset_desks d
                  JOIN asset_offices o ON o.id = d.office_id
                  LEFT JOIN users u ON u.id = d.assigned_user_id
                  LEFT JOIN LATERAL (
                    SELECT COUNT(*)::int AS asset_count
                    FROM assets a
                    WHERE a.desk_id = d.id
                  ) asset_stats ON TRUE
                  LEFT JOIN LATERAL (
                    SELECT COUNT(*)::int AS stock_count
                    FROM asset_stock_items s
                    WHERE s.desk_id = d.id
                  ) stock_stats ON TRUE
                  LEFT JOIN LATERAL (
                    SELECT COUNT(*)::int AS issue_count
                    FROM asset_issues i
                    WHERE i.desk_id = d.id AND i.status IN ('open', 'in_progress')
                  ) issue_stats ON TRUE
                  ORDER BY o.sort_order ASC, d.desk_no ASC`),
      pool.query(`SELECT * FROM asset_categories ORDER BY name ASC`),
      pool.query(`SELECT * FROM asset_vendors ORDER BY name ASC`),
      pool.query(`SELECT id, full_name, email, role, designation, department FROM users ORDER BY full_name ASC`)
    ]);

    res.json({
      offices: offices.rows,
      desks: desks.rows,
      categories: categories.rows,
      vendors: vendors.rows,
      users: users.rows
    });
  } catch (error) {
    console.error('getMasterData:', error);
    res.status(500).json({ message: 'Failed to load asset master data' });
  }
};

const createOffice = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const code = normalizeSlug(req.body?.code || req.body?.name || '');
    const name = normalizeText(req.body?.name);
    const officeType = normalizeText(req.body?.office_type) || 'branch_office';
    const address = normalizeText(req.body?.address) || null;
    const sortOrder = parseNum(req.body?.sort_order, 0);
    if (!code || !name) return res.status(400).json({ message: 'code and name are required' });

    const result = await pool.query(
      `INSERT INTO asset_offices (code, name, office_type, address, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [code, name, officeType, address, sortOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createOffice:', error);
    res.status(500).json({ message: 'Failed to create office' });
  }
};

const createDesk = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const officeId = parseNum(req.body?.office_id, 0);
    const deskNo = normalizeText(req.body?.desk_no);
    const deskLabel = normalizeText(req.body?.desk_label) || null;
    const locationNote = normalizeText(req.body?.location_note) || null;
    const officialEmail = normalizeText(req.body?.official_email) || null;
    const assignedUserId = req.body?.assigned_user_id ? parseNum(req.body.assigned_user_id, null) : null;
    const assignedAt = assignedUserId ? new Date() : null;
    const auditUserId = await resolveAuditUserId(req.user?.id);
    if (!officeId || !deskNo) return res.status(400).json({ message: 'office_id and desk_no are required' });
    const officeResult = await pool.query(`SELECT code FROM asset_offices WHERE id = $1`, [officeId]);
    if (!officeResult.rows.length) return res.status(400).json({ message: 'Office not found' });
    const floorLabel = officeResult.rows[0].code === 'HQ' ? normalizeDeskFloor(req.body?.floor_label) : null;

    const result = await pool.query(
      `INSERT INTO asset_desks (office_id, desk_no, desk_label, location_note, official_email, assigned_user_id, assigned_at, floor_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [officeId, deskNo, deskLabel, locationNote, officialEmail, assignedUserId, assignedAt, floorLabel]
    );

    if (assignedUserId) {
      await pool.query(
        `INSERT INTO asset_desk_assignments (desk_id, assigned_user_id, official_email, assigned_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, assignedUserId, officialEmail, auditUserId, 'Desk created with initial assignment']
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createDesk:', error);
    res.status(500).json({ message: 'Failed to create desk' });
  }
};

const updateDesk = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const deskId = parseNum(req.params.id, 0);
    const deskLabel = normalizeText(req.body?.desk_label) || null;
    const locationNote = normalizeText(req.body?.location_note) || null;
    const officialEmail = normalizeText(req.body?.official_email) || null;
    const assignedUserInput = normalizeText(req.body?.assigned_user_id);
    const officeInput = normalizeText(req.body?.office_id);
    const assignedUserId = parseOptionalNum(req.body?.assigned_user_id);
    const officeId = parseOptionalNum(req.body?.office_id);
    const auditUserId = await resolveAuditUserId(req.user?.id);

    if (!deskId) return res.status(400).json({ message: 'Valid desk id is required' });
    if (assignedUserInput && (!assignedUserId || assignedUserId <= 0)) {
      return res.status(400).json({ message: 'Invalid assigned user id' });
    }
    if (officeInput && (!officeId || officeId <= 0)) {
      return res.status(400).json({ message: 'Invalid office id' });
    }

    const existing = await pool.query(`SELECT * FROM asset_desks WHERE id = $1`, [deskId]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Desk not found' });

    if (assignedUserId) {
      const userExists = await pool.query(`SELECT id FROM users WHERE id = $1`, [assignedUserId]);
      if (!userExists.rows.length) return res.status(400).json({ message: 'Assigned user not found' });
    }

    const prev = existing.rows[0];
    const nextOfficeId = officeId || prev.office_id;
    const officeExists = await pool.query(`SELECT id, code FROM asset_offices WHERE id = $1`, [nextOfficeId]);
    if (!officeExists.rows.length) return res.status(400).json({ message: 'Office not found' });
    const floorLabel = officeExists.rows[0].code === 'HQ' ? normalizeDeskFloor(req.body?.floor_label) : null;

    await pool.query(
      `UPDATE asset_desks
       SET office_id = $1,
           desk_label = COALESCE($2, desk_label),
           location_note = COALESCE($3, location_note),
           official_email = COALESCE($4, official_email),
           assigned_user_id = $5::INTEGER,
           floor_label = $6,
           assigned_at = CASE WHEN $5::INTEGER IS NULL THEN assigned_at ELSE NOW() END,
           updated_at = NOW()
       WHERE id = $7`,
      [nextOfficeId, deskLabel, locationNote, officialEmail, assignedUserId, floorLabel, deskId]
    );

    if (assignedUserId || officialEmail) {
      await pool.query(
        `INSERT INTO asset_desk_assignments (desk_id, assigned_user_id, official_email, assigned_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [deskId, assignedUserId, officialEmail, auditUserId, 'Manual desk update']
      );
    }

    const updated = await pool.query(
      `SELECT
        d.*,
        o.name AS office_name,
        o.code AS office_code,
        u.full_name AS assigned_user_name,
        u.email AS assigned_user_email,
        u.designation AS assigned_user_designation,
        u.department AS assigned_user_department
       FROM asset_desks d
       JOIN asset_offices o ON o.id = d.office_id
       LEFT JOIN users u ON u.id = d.assigned_user_id
       WHERE d.id = $1`,
      [deskId]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.error('updateDesk:', error);
    res.status(500).json({ message: 'Failed to update desk' });
  }
};

const getDeskHistory = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const deskId = parseNum(req.params.id, 0);
    if (!deskId) return res.status(400).json({ message: 'Valid desk id is required' });

    const result = await pool.query(
      `SELECT
        h.*,
        h.assigned_at AS created_at,
        u.full_name AS assigned_user_name,
        u.email AS assigned_user_email,
        au.full_name AS assigned_by_name,
        au.email AS assigned_by_email
       FROM asset_desk_assignments h
       LEFT JOIN users u ON u.id = h.assigned_user_id
       LEFT JOIN users au ON au.id = h.assigned_by
       WHERE h.desk_id = $1
       ORDER BY h.assigned_at DESC, h.id DESC`,
      [deskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('getDeskHistory:', error);
    res.status(500).json({ message: 'Failed to load desk history' });
  }
};

const createCategory = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const name = normalizeText(req.body?.name);
    const slug = normalizeSlug(req.body?.slug || name);
    if (!name || !slug) return res.status(400).json({ message: 'name is required' });

    const result = await pool.query(
      `INSERT INTO asset_categories (name, slug, parent_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, slug, req.body?.parent_id ? parseNum(req.body.parent_id, null) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createCategory:', error);
    res.status(500).json({ message: 'Failed to create category' });
  }
};

const createVendor = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const name = normalizeText(req.body?.name);
    if (!name) return res.status(400).json({ message: 'name is required' });

    const result = await pool.query(
      `INSERT INTO asset_vendors (name, contact_person, phone, email, warranty_contact, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name,
        normalizeText(req.body?.contact_person) || null,
        normalizeText(req.body?.phone) || null,
        normalizeText(req.body?.email) || null,
        normalizeText(req.body?.warranty_contact) || null,
        normalizeText(req.body?.notes) || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createVendor:', error);
    res.status(500).json({ message: 'Failed to create vendor' });
  }
};

const ASSET_STATUSES = ['in_stock','in_use','assigned','active','repair','maintenance','warranty_claim','broken','replaced','retired','disposed','lost'];
const ASSET_CONDITIONS = ['new','good','fair','poor','damaged'];
const ISSUE_STATUSES = ['open','in_progress','resolved'];

const listAssets = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const search = normalizeText(req.query.search);
    const officeId = parseNum(req.query.office_id, 0);
    const status = normalizeText(req.query.status);
    // Bounded list: full-table read otherwise
    const listLimit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const params = [];
    const where = [];

    if (search) {
      params.push(`%${escapeLike(search)}%`);
      where.push(`(
        a.asset_tag ILIKE $${params.length} ESCAPE '\\'
        OR a.asset_name ILIKE $${params.length} ESCAPE '\\'
        OR a.brand ILIKE $${params.length} ESCAPE '\\'
        OR a.model ILIKE $${params.length} ESCAPE '\\'
        OR a.serial_number ILIKE $${params.length} ESCAPE '\\'
      )`);
    }
    if (officeId) {
      params.push(officeId);
      where.push(`a.office_id = $${params.length}`);
    }
    if (status) {
      if (!ASSET_STATUSES.includes(status)) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT
        a.*,
        o.name AS office_name,
        o.code AS office_code,
        d.desk_no,
        d.desk_label,
        c.name AS category_name,
        v.name AS vendor_name,
        COALESCE(component_stats.component_count, 0)::int AS component_count
       FROM assets a
       LEFT JOIN asset_offices o ON o.id = a.office_id
       LEFT JOIN asset_desks d ON d.id = a.desk_id
       LEFT JOIN asset_categories c ON c.id = a.category_id
       LEFT JOIN asset_vendors v ON v.id = a.vendor_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS component_count
         FROM asset_components ac
         WHERE ac.asset_id = a.id AND ac.status = 'active'
       ) component_stats ON TRUE
       ${whereSql}
       ORDER BY a.id DESC
       LIMIT $${params.length + 1}`,
      [...params, listLimit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listAssets:', error);
    res.status(500).json({ message: 'Failed to load assets' });
  }
};

const createAsset = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id);

    const assetTag = normalizeText(req.body?.asset_tag);
    const assetName = normalizeText(req.body?.asset_name);
    if (!assetTag || !assetName) return res.status(400).json({ message: 'asset_tag and asset_name are required' });

    // Enum + sign guards (junk statuses fragment dashboards/lifecycle)
    if (req.body?.status && !ASSET_STATUSES.includes(normalizeText(req.body.status))) {
      return res.status(400).json({ message: 'Invalid asset status' });
    }
    if (req.body?.condition && !ASSET_CONDITIONS.includes(normalizeText(req.body.condition))) {
      return res.status(400).json({ message: 'Invalid asset condition' });
    }
    if (req.body?.purchase_price != null && Number(String(req.body.purchase_price).replace(/[^0-9.\-]/g, '')) < 0) {
      return res.status(400).json({ message: 'purchase_price cannot be negative' });
    }

    const payload = {
      asset_tag: assetTag,
      asset_name: assetName,
      category_id: req.body?.category_id ? parseNum(req.body.category_id, null) : null,
      vendor_id: req.body?.vendor_id ? parseNum(req.body.vendor_id, null) : null,
      office_id: req.body?.office_id ? parseNum(req.body.office_id, null) : null,
      desk_id: req.body?.desk_id ? parseNum(req.body.desk_id, null) : null,
      assigned_user_id: req.body?.assigned_user_id ? parseNum(req.body.assigned_user_id, null) : null,
      brand: normalizeText(req.body?.brand) || null,
      model: normalizeText(req.body?.model) || null,
      serial_number: normalizeText(req.body?.serial_number) || null,
      purchase_date: normalizeText(req.body?.purchase_date) || null,
      purchase_price: parseNum(req.body?.purchase_price, 0),
      warranty_start_date: normalizeText(req.body?.warranty_start_date) || null,
      warranty_end_date: normalizeText(req.body?.warranty_end_date) || null,
      warranty_type: normalizeText(req.body?.warranty_type) || null,
      status: normalizeText(req.body?.status) || 'in_stock',
      condition: normalizeText(req.body?.condition) || 'good',
      notes: normalizeText(req.body?.notes) || null
    };

    const result = await pool.query(
      `INSERT INTO assets (
        asset_tag, asset_name, category_id, vendor_id, office_id, desk_id, assigned_user_id,
        brand, model, serial_number, purchase_date, purchase_price,
        warranty_start_date, warranty_end_date, warranty_type, status, condition, notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18
      ) RETURNING *`,
      [
        payload.asset_tag,
        payload.asset_name,
        payload.category_id,
        payload.vendor_id,
        payload.office_id,
        payload.desk_id,
        payload.assigned_user_id,
        payload.brand,
        payload.model,
        payload.serial_number,
        payload.purchase_date,
        payload.purchase_price,
        payload.warranty_start_date,
        payload.warranty_end_date,
        payload.warranty_type,
        payload.status,
        payload.condition,
        payload.notes
      ]
    );

    await syncAssetWarranty(pool, result.rows[0].id, payload);

    if (payload.office_id || payload.desk_id) {
      await pool.query(
        `INSERT INTO asset_movements (asset_id, to_office_id, to_desk_id, moved_by, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, payload.office_id, payload.desk_id, auditUserId, 'Initial assignment']
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createAsset:', error);
    res.status(500).json({ message: 'Failed to create asset' });
  }
};

const updateAsset = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const assetId = parseNum(req.params.id, 0);
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    const existing = await pool.query(
      `SELECT
        a.*,
        w.coverage_notes AS warranty_coverage_notes,
        w.notes AS warranty_notes
       FROM assets a
       LEFT JOIN asset_warranties w ON w.asset_id = a.id
       WHERE a.id = $1`,
      [assetId]
    );
    if (!existing.rows.length) return res.status(404).json({ message: 'Asset not found' });
    const current = existing.rows[0];

    // Same enum/sign guards as create
    if (req.body?.status && !ASSET_STATUSES.includes(normalizeText(req.body.status))) {
      return res.status(400).json({ message: 'Invalid asset status' });
    }
    if (req.body?.condition && !ASSET_CONDITIONS.includes(normalizeText(req.body.condition))) {
      return res.status(400).json({ message: 'Invalid asset condition' });
    }
    if (req.body?.purchase_price != null && Number(String(req.body.purchase_price).replace(/[^0-9.\-]/g, '')) < 0) {
      return res.status(400).json({ message: 'purchase_price cannot be negative' });
    }

    const result = await pool.query(
      `UPDATE assets SET
        asset_tag = COALESCE($1, asset_tag),
        asset_name = COALESCE($2, asset_name),
        category_id = COALESCE($3, category_id),
        vendor_id = COALESCE($4, vendor_id),
        office_id = COALESCE($5, office_id),
        desk_id = COALESCE($6, desk_id),
        assigned_user_id = COALESCE($7, assigned_user_id),
        brand = COALESCE($8, brand),
        model = COALESCE($9, model),
        serial_number = COALESCE($10, serial_number),
        purchase_date = COALESCE($11, purchase_date),
        purchase_price = COALESCE($12, purchase_price),
        warranty_start_date = COALESCE($13, warranty_start_date),
        warranty_end_date = COALESCE($14, warranty_end_date),
        warranty_type = COALESCE($15, warranty_type),
        status = COALESCE($16, status),
        condition = COALESCE($17, condition),
        notes = COALESCE($18, notes),
        updated_at = NOW()
       WHERE id = $19
       RETURNING *`,
      [
        req.body?.asset_tag ? normalizeText(req.body.asset_tag) : null,
        req.body?.asset_name ? normalizeText(req.body.asset_name) : null,
        req.body?.category_id ? parseNum(req.body.category_id, null) : null,
        req.body?.vendor_id ? parseNum(req.body.vendor_id, null) : null,
        req.body?.office_id ? parseNum(req.body.office_id, null) : null,
        req.body?.desk_id ? parseNum(req.body.desk_id, null) : null,
        req.body?.assigned_user_id ? parseNum(req.body.assigned_user_id, null) : null,
        req.body?.brand ? normalizeText(req.body.brand) : null,
        req.body?.model ? normalizeText(req.body.model) : null,
        req.body?.serial_number ? normalizeText(req.body.serial_number) : null,
        req.body?.purchase_date ? normalizeText(req.body.purchase_date) : null,
        req.body?.purchase_price !== undefined ? parseNum(req.body.purchase_price, null) : null,
        req.body?.warranty_start_date ? normalizeText(req.body.warranty_start_date) : null,
        req.body?.warranty_end_date ? normalizeText(req.body.warranty_end_date) : null,
        req.body?.warranty_type ? normalizeText(req.body.warranty_type) : null,
        req.body?.status ? normalizeText(req.body.status) : null,
        req.body?.condition ? normalizeText(req.body.condition) : null,
        req.body?.notes ? normalizeText(req.body.notes) : null,
        assetId
      ]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Asset not found' });

    await syncAssetWarranty(pool, assetId, {
      vendor_id: req.body?.vendor_id ? parseNum(req.body.vendor_id, null) : current.vendor_id,
      warranty_type: req.body?.warranty_type ? normalizeText(req.body.warranty_type) : current.warranty_type,
      warranty_start_date: req.body?.warranty_start_date ? normalizeText(req.body.warranty_start_date) : current.warranty_start_date,
      warranty_end_date: req.body?.warranty_end_date ? normalizeText(req.body.warranty_end_date) : current.warranty_end_date,
      coverage_notes: req.body?.coverage_notes ? normalizeText(req.body.coverage_notes) : current.warranty_coverage_notes,
      notes: req.body?.warranty_notes ? normalizeText(req.body.warranty_notes) : current.warranty_notes
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('updateAsset:', error);
    res.status(500).json({ message: 'Failed to update asset' });
  }
};

const deleteAsset = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const assetId = parseNum(req.params.id, 0);
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    const existing = await pool.query(
      `SELECT id, asset_tag, asset_name FROM assets WHERE id = $1`,
      [assetId]
    );
    if (!existing.rows.length) return res.status(404).json({ message: 'Asset not found' });

    await pool.query(`DELETE FROM assets WHERE id = $1`, [assetId]);

    res.json({ success: true, asset: existing.rows[0] });
  } catch (error) {
    console.error('deleteAsset:', error);
    res.status(500).json({ message: 'Failed to delete asset' });
  }
};

const moveAsset = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id, client);

    const assetId = parseNum(req.params.id, 0);
    const toOfficeId = req.body?.to_office_id ? parseNum(req.body.to_office_id, null) : null;
    const toDeskId = req.body?.to_desk_id ? parseNum(req.body.to_desk_id, null) : null;
    const reason = normalizeText(req.body?.reason) || null;
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    await client.query('BEGIN');
    const assetResult = await client.query(
      `SELECT id, office_id, desk_id
       FROM assets
       WHERE id = $1
       FOR UPDATE`,
      [assetId]
    );
    if (!assetResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Asset not found' });
    }

    const current = assetResult.rows[0];
    const updated = await client.query(
      `UPDATE assets
       SET office_id = $1, desk_id = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [toOfficeId, toDeskId, assetId]
    );

    await client.query(
      `INSERT INTO asset_movements (
        asset_id, from_office_id, from_desk_id, to_office_id, to_desk_id, moved_by, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [assetId, current.office_id, current.desk_id, toOfficeId, toDeskId, auditUserId, reason]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('moveAsset:', error);
    res.status(500).json({ message: 'Failed to move asset' });
  } finally {
    client.release();
  }
};

const getAssetHistory = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const assetId = parseNum(req.params.id, 0);
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    const result = await pool.query(
      `SELECT
        m.*,
        fo.name AS from_office_name,
        fd.desk_no AS from_desk_no,
        toff.name AS to_office_name,
        td.desk_no AS to_desk_no,
        u.full_name AS moved_by_name
       FROM asset_movements m
       LEFT JOIN asset_offices fo ON fo.id = m.from_office_id
       LEFT JOIN asset_desks fd ON fd.id = m.from_desk_id
       LEFT JOIN asset_offices toff ON toff.id = m.to_office_id
       LEFT JOIN asset_desks td ON td.id = m.to_desk_id
       LEFT JOIN users u ON u.id = m.moved_by
       WHERE m.asset_id = $1
       ORDER BY m.moved_at DESC`,
      [assetId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('getAssetHistory:', error);
    res.status(500).json({ message: 'Failed to load asset history' });
  }
};

const listAssetComponents = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const assetId = parseNum(req.params.id, 0);
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    const result = await pool.query(
      `SELECT
        ac.*
       FROM asset_components ac
       WHERE ac.asset_id = $1
       ORDER BY
        CASE
          WHEN ac.status = 'active' THEN 0
          WHEN ac.status = 'replaced' THEN 1
          ELSE 2
        END,
        ac.installed_at DESC,
        ac.id DESC`,
      [assetId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listAssetComponents:', error);
    res.status(500).json({ message: 'Failed to load asset components' });
  }
};

const createAssetComponent = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id, client);

    const assetId = parseNum(req.params.id, 0);
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    const componentType = normalizeText(req.body?.component_type);
    const componentName = normalizeText(req.body?.component_name);
    if (!componentType || !componentName) {
      return res.status(400).json({ message: 'component_type and component_name are required' });
    }

    await client.query('BEGIN');
    const assetCheck = await client.query(`SELECT id FROM assets WHERE id = $1`, [assetId]);
    if (!assetCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Asset not found' });
    }

    const inserted = await client.query(
      `INSERT INTO asset_components (
        asset_id, component_type, component_name, brand, model, serial_number, specification, status, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        assetId,
        componentType,
        componentName,
        normalizeText(req.body?.brand) || null,
        normalizeText(req.body?.model) || null,
        normalizeText(req.body?.serial_number) || null,
        normalizeText(req.body?.specification) || null,
        normalizeText(req.body?.status) || 'active',
        normalizeText(req.body?.notes) || null
      ]
    );

    await client.query(
      `INSERT INTO asset_component_movements (
        asset_id, component_id, movement_type, to_component_id, moved_by, reason, notes
      ) VALUES ($1, $2, 'installed', $2, $3, $4, $5)`,
      [
        assetId,
        inserted.rows[0].id,
        auditUserId,
        normalizeText(req.body?.reason) || 'Initial install',
        normalizeText(req.body?.notes) || null
      ]
    );

    await client.query('COMMIT');
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createAssetComponent:', error);
    res.status(500).json({ message: 'Failed to create asset component' });
  } finally {
    client.release();
  }
};

const updateAssetComponent = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const componentId = parseNum(req.params.componentId, 0);
    if (!componentId) return res.status(400).json({ message: 'Invalid component id' });

    const result = await pool.query(
      `UPDATE asset_components SET
        component_type = COALESCE($1, component_type),
        component_name = COALESCE($2, component_name),
        brand = COALESCE($3, brand),
        model = COALESCE($4, model),
        serial_number = COALESCE($5, serial_number),
        specification = COALESCE($6, specification),
        status = COALESCE($7, status),
        notes = COALESCE($8, notes),
        updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        req.body?.component_type ? normalizeText(req.body.component_type) : null,
        req.body?.component_name ? normalizeText(req.body.component_name) : null,
        req.body?.brand ? normalizeText(req.body.brand) : null,
        req.body?.model ? normalizeText(req.body.model) : null,
        req.body?.serial_number ? normalizeText(req.body.serial_number) : null,
        req.body?.specification ? normalizeText(req.body.specification) : null,
        req.body?.status ? normalizeText(req.body.status) : null,
        req.body?.notes ? normalizeText(req.body.notes) : null,
        componentId
      ]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Component not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('updateAssetComponent:', error);
    res.status(500).json({ message: 'Failed to update asset component' });
  }
};

const replaceAssetComponent = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id, client);

    const componentId = parseNum(req.params.componentId, 0);
    if (!componentId) return res.status(400).json({ message: 'Invalid component id' });

    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT * FROM asset_components WHERE id = $1 FOR UPDATE`,
      [componentId]
    );
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Component not found' });
    }

    const current = currentResult.rows[0];
    if (String(current.status || '').toLowerCase() !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Only active components can be replaced' });
    }

    const nextComponentType = normalizeText(req.body?.component_type) || current.component_type;
    const nextComponentName = normalizeText(req.body?.component_name) || current.component_name;
    if (!nextComponentType || !nextComponentName) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'component_type and component_name are required' });
    }

    const replaced = await client.query(
      `UPDATE asset_components
       SET status = 'replaced', replaced_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [componentId]
    );

    const inserted = await client.query(
      `INSERT INTO asset_components (
        asset_id, component_type, component_name, brand, model, serial_number, specification, status, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)
      RETURNING *`,
      [
        current.asset_id,
        nextComponentType,
        nextComponentName,
        normalizeText(req.body?.brand) || current.brand,
        normalizeText(req.body?.model) || current.model,
        normalizeText(req.body?.serial_number) || null,
        normalizeText(req.body?.specification) || current.specification,
        normalizeText(req.body?.notes) || null
      ]
    );

    const movement = await client.query(
      `INSERT INTO asset_component_movements (
        asset_id, component_id, movement_type, from_component_id, to_component_id, moved_by, reason, notes
      ) VALUES ($1, $2, 'replaced', $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        current.asset_id,
        componentId,
        inserted.rows[0].id,
        auditUserId,
        normalizeText(req.body?.reason) || 'Component replacement',
        normalizeText(req.body?.notes) || null
      ]
    );

    await client.query('COMMIT');
    res.json({
      old_component: replaced.rows[0],
      new_component: inserted.rows[0],
      movement: movement.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('replaceAssetComponent:', error);
    res.status(500).json({ message: 'Failed to replace component' });
  } finally {
    client.release();
  }
};

const listAssetComponentMovements = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const assetId = parseNum(req.params.id, 0);
    if (!assetId) return res.status(400).json({ message: 'Invalid asset id' });

    const result = await pool.query(
      `SELECT
        m.*,
        u.full_name AS moved_by_name,
        fc.component_name AS from_component_name,
        tc.component_name AS to_component_name
       FROM asset_component_movements m
       LEFT JOIN users u ON u.id = m.moved_by
       LEFT JOIN asset_components fc ON fc.id = m.from_component_id
       LEFT JOIN asset_components tc ON tc.id = m.to_component_id
       WHERE m.asset_id = $1
       ORDER BY m.created_at DESC, m.id DESC`,
      [assetId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listAssetComponentMovements:', error);
    res.status(500).json({ message: 'Failed to load component history' });
  }
};

const getSummary = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const [officeCount, deskCount, assetCount, warrantySoon, brokenCount, warrantyExpired, issuesOpen, stockItemsCount, lowStockCount, stockQuantity] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM asset_offices WHERE is_active = TRUE`),
      pool.query(`SELECT COUNT(*)::int AS total FROM asset_desks WHERE is_active = TRUE`),
      pool.query(`SELECT COUNT(*)::int AS total FROM assets`),
      pool.query(`SELECT COUNT(*)::int AS total FROM assets WHERE warranty_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`),
      pool.query(`SELECT COUNT(*)::int AS total FROM assets WHERE status IN ('broken', 'repair', 'maintenance')`),
      pool.query(`SELECT COUNT(*)::int AS total FROM asset_warranties WHERE warranty_end_date IS NOT NULL AND warranty_end_date < CURRENT_DATE`),
      pool.query(`SELECT COUNT(*)::int AS total FROM asset_issues WHERE status IN ('open', 'in_progress')`),
      pool.query(`SELECT COUNT(*)::int AS total FROM asset_stock_items WHERE status <> 'archived'`),
      pool.query(`SELECT COUNT(*)::int AS total FROM asset_stock_items WHERE quantity_on_hand <= minimum_quantity`),
      pool.query(`SELECT COALESCE(SUM(quantity_on_hand), 0)::int AS total FROM asset_stock_items`)
    ]);

    res.json({
      offices: officeCount.rows[0]?.total || 0,
      desks: deskCount.rows[0]?.total || 0,
      assets: assetCount.rows[0]?.total || 0,
      warranty_soon: warrantySoon.rows[0]?.total || 0,
      broken_or_under_service: brokenCount.rows[0]?.total || 0,
      warranty_expired: warrantyExpired.rows[0]?.total || 0,
      open_issues: issuesOpen.rows[0]?.total || 0,
      stock_items: stockItemsCount.rows[0]?.total || 0,
      low_stock_items: lowStockCount.rows[0]?.total || 0,
      stock_quantity: stockQuantity.rows[0]?.total || 0
    });
  } catch (error) {
    console.error('getSummary:', error);
    res.status(500).json({ message: 'Failed to load asset summary' });
  }
};

const getReports = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const [
      assetsByOffice,
      assetsByCategory,
      assetStatusCounts,
      warrantySoonAssets,
      openIssues,
      lowStockItems,
      vendorSpend,
      monthlyPurchaseSummary,
      repairCostSummary
    ] = await Promise.all([
      pool.query(
        `SELECT
          o.id,
          o.name AS office_name,
          COUNT(a.id)::int AS asset_count
         FROM asset_offices o
         LEFT JOIN assets a ON a.office_id = o.id
         WHERE o.is_active = TRUE
         GROUP BY o.id, o.name, o.sort_order
         ORDER BY o.sort_order ASC`
      ),
      pool.query(
        `SELECT
          c.id,
          c.name AS category_name,
          COUNT(a.id)::int AS asset_count
         FROM asset_categories c
         LEFT JOIN assets a ON a.category_id = c.id
         WHERE c.is_active = TRUE
         GROUP BY c.id, c.name
         ORDER BY asset_count DESC, c.name ASC`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM assets
         GROUP BY status
         ORDER BY count DESC, status ASC`
      ),
      pool.query(
        `SELECT
          a.asset_tag,
          a.asset_name,
          a.warranty_end_date,
          o.name AS office_name,
          d.desk_no,
          v.name AS vendor_name
         FROM assets a
         LEFT JOIN asset_offices o ON o.id = a.office_id
         LEFT JOIN asset_desks d ON d.id = a.desk_id
         LEFT JOIN asset_vendors v ON v.id = a.vendor_id
         WHERE a.warranty_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
         ORDER BY a.warranty_end_date ASC NULLS LAST
         LIMIT 20`
      ),
      pool.query(
        `SELECT
          i.issue_title,
          i.status,
          i.severity,
          a.asset_tag,
          a.asset_name,
          o.name AS office_name
         FROM asset_issues i
         JOIN assets a ON a.id = i.asset_id
         LEFT JOIN asset_offices o ON o.id = i.office_id
         WHERE i.status IN ('open', 'in_progress')
         ORDER BY i.reported_at DESC
         LIMIT 20`
      ),
      pool.query(
        `SELECT
          s.item_code,
          s.item_name,
          s.quantity_on_hand,
          s.minimum_quantity,
          o.name AS office_name,
          CASE
            WHEN s.quantity_on_hand <= 0 THEN 'out_of_stock'
            WHEN s.quantity_on_hand <= s.minimum_quantity THEN 'low_stock'
            ELSE 'ok'
          END AS stock_status
         FROM asset_stock_items s
         LEFT JOIN asset_offices o ON o.id = s.office_id
         WHERE s.quantity_on_hand <= s.minimum_quantity
         ORDER BY s.quantity_on_hand ASC, s.item_name ASC
         LIMIT 20`
      ),
      pool.query(
        `SELECT
          COALESCE(v.name, 'Unassigned') AS vendor_name,
          SUM(a.purchase_price)::numeric(12,2) AS total_spend,
          COUNT(a.id)::int AS asset_count
         FROM assets a
         LEFT JOIN asset_vendors v ON v.id = a.vendor_id
         GROUP BY vendor_name
         ORDER BY total_spend DESC NULLS LAST
         LIMIT 10`
      ),
      pool.query(
        `SELECT
          DATE_TRUNC('month', purchase_date)::date AS month,
          SUM(purchase_price)::numeric(12,2) AS total_spend,
          COUNT(*)::int AS asset_count
         FROM assets
         WHERE purchase_date IS NOT NULL
         GROUP BY 1
         ORDER BY month DESC
         LIMIT 12`
      ),
      pool.query(
        `SELECT
          DATE_TRUNC('month', COALESCE(completed_at, started_at, created_at))::date AS month,
          SUM(repair_cost)::numeric(12,2) AS total_cost,
          COUNT(*)::int AS repair_count
         FROM asset_repairs
         GROUP BY 1
         ORDER BY month DESC
         LIMIT 12`
      )
    ]);

    res.json({
      assets_by_office: assetsByOffice.rows,
      assets_by_category: assetsByCategory.rows,
      asset_status_counts: assetStatusCounts.rows,
      warranty_soon_assets: warrantySoonAssets.rows,
      open_issues: openIssues.rows,
      low_stock_items: lowStockItems.rows,
      vendor_spend: vendorSpend.rows,
      monthly_purchase_summary: monthlyPurchaseSummary.rows,
      repair_cost_summary: repairCostSummary.rows
    });
  } catch (error) {
    console.error('getReports:', error);
    res.status(500).json({ message: 'Failed to load asset reports' });
  }
};

const listWarranties = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const result = await pool.query(
      `SELECT
        w.*,
        a.asset_tag,
        a.asset_name,
        a.serial_number,
        o.name AS office_name,
        d.desk_no,
        v.name AS vendor_name,
        CASE
          WHEN w.warranty_end_date IS NULL THEN 'unknown'
          WHEN w.warranty_end_date < CURRENT_DATE THEN 'expired'
          WHEN w.warranty_end_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'active'
        END AS computed_status
       FROM asset_warranties w
       JOIN assets a ON a.id = w.asset_id
       LEFT JOIN asset_offices o ON o.id = a.office_id
       LEFT JOIN asset_desks d ON d.id = a.desk_id
       LEFT JOIN asset_vendors v ON v.id = w.vendor_id
       ORDER BY w.warranty_end_date NULLS LAST, w.id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listWarranties:', error);
    res.status(500).json({ message: 'Failed to load warranties' });
  }
};

const createWarranty = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const assetId = parseNum(req.body?.asset_id, 0);
    if (!assetId) return res.status(400).json({ message: 'asset_id is required' });

    await syncAssetWarranty(pool, assetId, req.body || {});
    const result = await pool.query(
      `SELECT * FROM asset_warranties WHERE asset_id = $1`,
      [assetId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createWarranty:', error);
    res.status(500).json({ message: 'Failed to save warranty' });
  }
};

const listIssues = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const result = await pool.query(
      `SELECT
        i.*,
        a.asset_tag,
        a.asset_name,
        a.serial_number,
        o.name AS office_name,
        d.desk_no,
        u.full_name AS reported_by_name
       FROM asset_issues i
       JOIN assets a ON a.id = i.asset_id
       LEFT JOIN asset_offices o ON o.id = i.office_id
       LEFT JOIN asset_desks d ON d.id = i.desk_id
       LEFT JOIN users u ON u.id = i.reported_by
       ORDER BY i.reported_at DESC, i.id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listIssues:', error);
    res.status(500).json({ message: 'Failed to load issues' });
  }
};

const createIssue = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id);

    const assetId = parseNum(req.body?.asset_id, 0);
    const issueTitle = normalizeText(req.body?.issue_title);
    if (!assetId || !issueTitle) return res.status(400).json({ message: 'asset_id and issue_title are required' });

    const result = await pool.query(
      `INSERT INTO asset_issues (
        asset_id, reported_by, office_id, desk_id, issue_title, issue_description, severity,
        status, warranty_claimed, resolution_notes, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        assetId,
        auditUserId,
        req.body?.office_id ? parseNum(req.body.office_id, null) : null,
        req.body?.desk_id ? parseNum(req.body.desk_id, null) : null,
        issueTitle,
        normalizeText(req.body?.issue_description) || null,
        normalizeText(req.body?.severity) || 'medium',
        normalizeText(req.body?.status) || 'open',
        Boolean(req.body?.warranty_claimed),
        normalizeText(req.body?.resolution_notes) || null,
        normalizeText(req.body?.notes) || null
      ]
    );

    const newStatus = Boolean(req.body?.warranty_claimed) ? 'warranty_claim' : 'maintenance';
    await pool.query(`UPDATE assets SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, assetId]);
    if (req.body?.warranty_claimed) {
      await pool.query(`UPDATE asset_warranties SET claim_count = claim_count + 1, updated_at = NOW() WHERE asset_id = $1`, [assetId]);
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createIssue:', error);
    res.status(500).json({ message: 'Failed to create issue' });
  }
};

const updateIssueStatus = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const issueId = parseNum(req.params.id, 0);
    if (!issueId) return res.status(400).json({ message: 'Invalid issue id' });

    // Issue + asset status allowlists (free text previously persisted as-is)
    if (req.body?.status && !ISSUE_STATUSES.includes(normalizeText(req.body.status))) {
      return res.status(400).json({ message: 'Invalid issue status' });
    }
    if (req.body?.asset_status && !ASSET_STATUSES.includes(normalizeText(req.body.asset_status))) {
      return res.status(400).json({ message: 'Invalid asset status' });
    }

    const result = await pool.query(
      `UPDATE asset_issues
       SET status = COALESCE($1, status),
           closed_at = CASE WHEN $2::boolean = TRUE THEN NOW() ELSE closed_at END,
           resolution_notes = COALESCE($3, resolution_notes),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        req.body?.status ? normalizeText(req.body.status) : null,
        Boolean(req.body?.close_issue),
        normalizeText(req.body?.resolution_notes) || null,
        issueId
      ]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Issue not found' });
    if (req.body?.asset_status) {
      await pool.query(`UPDATE assets SET status = $1, updated_at = NOW() WHERE id = $2`, [normalizeText(req.body.asset_status), result.rows[0].asset_id]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('updateIssueStatus:', error);
    res.status(500).json({ message: 'Failed to update issue' });
  }
};

const listRepairs = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const result = await pool.query(
      `SELECT
        r.*,
        a.asset_tag,
        a.asset_name,
        i.issue_title,
        v.name AS vendor_name,
        u.full_name AS created_by_name
       FROM asset_repairs r
       JOIN assets a ON a.id = r.asset_id
       LEFT JOIN asset_issues i ON i.id = r.issue_id
       LEFT JOIN asset_vendors v ON v.id = r.vendor_id
       LEFT JOIN users u ON u.id = r.created_by
       ORDER BY r.created_at DESC, r.id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listRepairs:', error);
    res.status(500).json({ message: 'Failed to load repairs' });
  }
};

const createRepair = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id);

    const assetId = parseNum(req.body?.asset_id, 0);
    const repairAction = normalizeText(req.body?.repair_action);
    if (!assetId || !repairAction) return res.status(400).json({ message: 'asset_id and repair_action are required' });

    const result = await pool.query(
      `INSERT INTO asset_repairs (
        issue_id, asset_id, vendor_id, technician_name, repair_action, parts_used,
        repair_cost, started_at, completed_at, outcome, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        req.body?.issue_id ? parseNum(req.body.issue_id, null) : null,
        assetId,
        req.body?.vendor_id ? parseNum(req.body.vendor_id, null) : null,
        normalizeText(req.body?.technician_name) || null,
        repairAction,
        normalizeText(req.body?.parts_used) || null,
        req.body?.repair_cost !== undefined ? parseNum(req.body.repair_cost, 0) : 0,
        parseDateOrNull(req.body?.started_at),
        parseDateOrNull(req.body?.completed_at),
        normalizeText(req.body?.outcome) || null,
        normalizeText(req.body?.notes) || null,
        auditUserId
      ]
    );

    const newStatus = parseDateOrNull(req.body?.completed_at) ? 'active' : 'repair';
    await pool.query(`UPDATE assets SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, assetId]);
    if (req.body?.issue_id && parseDateOrNull(req.body?.completed_at)) {
      await pool.query(
        `UPDATE asset_issues
         SET status = 'resolved', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [parseNum(req.body.issue_id, 0)]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createRepair:', error);
    res.status(500).json({ message: 'Failed to save repair' });
  }
};

const listReplacements = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const result = await pool.query(
      `SELECT
        r.*,
        oa.asset_tag AS old_asset_tag,
        oa.asset_name AS old_asset_name,
        na.asset_tag AS new_asset_tag,
        na.asset_name AS new_asset_name,
        ua.full_name AS approved_by_name,
        ub.full_name AS disposed_by_name
       FROM asset_replacements r
       JOIN assets oa ON oa.id = r.old_asset_id
       LEFT JOIN assets na ON na.id = r.new_asset_id
       LEFT JOIN users ua ON ua.id = r.approved_by
       LEFT JOIN users ub ON ub.id = r.disposed_by
       ORDER BY r.replaced_at DESC, r.id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listReplacements:', error);
    res.status(500).json({ message: 'Failed to load replacements' });
  }
};

const createReplacement = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id, client);

    const oldAssetId = parseNum(req.body?.old_asset_id, 0);
    const approvedByInput = normalizeText(req.body?.approved_by);
    const disposedByInput = normalizeText(req.body?.disposed_by);
    if (!oldAssetId) return res.status(400).json({ message: 'old_asset_id is required' });

    await client.query('BEGIN');
    const approvedById = approvedByInput
      ? await resolveExistingUserId(client, req.body?.approved_by)
      : auditUserId;
    const disposedById = disposedByInput
      ? await resolveExistingUserId(client, req.body?.disposed_by)
      : null;

    if (approvedByInput && !approvedById) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'approved_by user not found' });
    }
    if (disposedByInput && !disposedById) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'disposed_by user not found' });
    }

    const result = await client.query(
      `INSERT INTO asset_replacements (
        old_asset_id, new_asset_id, replacement_reason, disposal_method, approved_by, disposed_by, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        oldAssetId,
        req.body?.new_asset_id ? parseNum(req.body.new_asset_id, null) : null,
        normalizeText(req.body?.replacement_reason) || 'Replacement requested',
        normalizeText(req.body?.disposal_method) || null,
        approvedById,
        disposedById,
        normalizeText(req.body?.notes) || null
      ]
    );

    await client.query(`UPDATE assets SET status = 'replaced', updated_at = NOW() WHERE id = $1`, [oldAssetId]);
    if (req.body?.new_asset_id) {
      await client.query(`UPDATE assets SET status = 'active', updated_at = NOW() WHERE id = $1`, [parseNum(req.body.new_asset_id, 0)]);
    }

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createReplacement:', error);
    res.status(500).json({ message: 'Failed to save replacement' });
  } finally {
    client.release();
  }
};

const listMovements = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const assetId = req.query?.asset_id ? parseNum(req.query.asset_id, 0) : 0;
    const params = [];
    const where = [];
    if (assetId) {
      params.push(assetId);
      where.push(`m.asset_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
        m.*,
        a.asset_tag,
        a.asset_name,
        fo.name AS from_office_name,
        fd.desk_no AS from_desk_no,
        toff.name AS to_office_name,
        td.desk_no AS to_desk_no,
        u.full_name AS moved_by_name
       FROM asset_movements m
       JOIN assets a ON a.id = m.asset_id
       LEFT JOIN asset_offices fo ON fo.id = m.from_office_id
       LEFT JOIN asset_desks fd ON fd.id = m.from_desk_id
       LEFT JOIN asset_offices toff ON toff.id = m.to_office_id
       LEFT JOIN asset_desks td ON td.id = m.to_desk_id
       LEFT JOIN users u ON u.id = m.moved_by
       ${whereSql}
       ORDER BY m.moved_at DESC, m.id DESC
       LIMIT 200`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listMovements:', error);
    res.status(500).json({ message: 'Failed to load movements' });
  }
};

const listStockItems = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const result = await pool.query(
      `SELECT
        s.*,
        c.name AS category_name,
        v.name AS vendor_name,
        o.name AS office_name,
        d.desk_no,
        CASE
          WHEN s.quantity_on_hand <= 0 THEN 'out_of_stock'
          WHEN s.quantity_on_hand <= s.minimum_quantity THEN 'low_stock'
          ELSE 'in_stock'
        END AS stock_status
       FROM asset_stock_items s
       LEFT JOIN asset_categories c ON c.id = s.category_id
       LEFT JOIN asset_vendors v ON v.id = s.vendor_id
       LEFT JOIN asset_offices o ON o.id = s.office_id
       LEFT JOIN asset_desks d ON d.id = s.desk_id
       ORDER BY s.quantity_on_hand ASC, s.item_name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listStockItems:', error);
    res.status(500).json({ message: 'Failed to load stock items' });
  }
};

const createStockItem = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const itemName = normalizeText(req.body?.item_name);
    if (!itemName) return res.status(400).json({ message: 'item_name is required' });

    const itemCode = normalizeText(req.body?.item_code) || makeStockCode(itemName);
    const result = await pool.query(
      `INSERT INTO asset_stock_items (
        item_code, item_name, item_type, category_id, vendor_id, office_id, desk_id,
        quantity_on_hand, minimum_quantity, unit_price, serial_number, status, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        itemCode,
        itemName,
        normalizeText(req.body?.item_type) || 'spare',
        req.body?.category_id ? parseNum(req.body.category_id, null) : null,
        req.body?.vendor_id ? parseNum(req.body.vendor_id, null) : null,
        req.body?.office_id ? parseNum(req.body.office_id, null) : null,
        req.body?.desk_id ? parseNum(req.body.desk_id, null) : null,
        parseNum(req.body?.quantity_on_hand, 0),
        parseNum(req.body?.minimum_quantity, 0),
        req.body?.unit_price !== undefined ? parseNum(req.body.unit_price, 0) : 0,
        normalizeText(req.body?.serial_number) || null,
        normalizeText(req.body?.status) || 'available',
        normalizeText(req.body?.notes) || null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createStockItem:', error);
    res.status(500).json({ message: 'Failed to create stock item' });
  }
};

const updateStockItem = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;

    const stockItemId = parseNum(req.params.id, 0);
    if (!stockItemId) return res.status(400).json({ message: 'Invalid stock item id' });

    const result = await pool.query(
      `UPDATE asset_stock_items SET
        item_code = COALESCE($1, item_code),
        item_name = COALESCE($2, item_name),
        item_type = COALESCE($3, item_type),
        category_id = COALESCE($4, category_id),
        vendor_id = COALESCE($5, vendor_id),
        office_id = COALESCE($6, office_id),
        desk_id = COALESCE($7, desk_id),
        quantity_on_hand = COALESCE($8, quantity_on_hand),
        minimum_quantity = COALESCE($9, minimum_quantity),
        unit_price = COALESCE($10, unit_price),
        serial_number = COALESCE($11, serial_number),
        status = COALESCE($12, status),
        notes = COALESCE($13, notes),
        updated_at = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        req.body?.item_code ? normalizeText(req.body.item_code) : null,
        req.body?.item_name ? normalizeText(req.body.item_name) : null,
        req.body?.item_type ? normalizeText(req.body.item_type) : null,
        req.body?.category_id ? parseNum(req.body.category_id, null) : null,
        req.body?.vendor_id ? parseNum(req.body.vendor_id, null) : null,
        req.body?.office_id ? parseNum(req.body.office_id, null) : null,
        req.body?.desk_id ? parseNum(req.body.desk_id, null) : null,
        req.body?.quantity_on_hand !== undefined ? parseNum(req.body.quantity_on_hand, null) : null,
        req.body?.minimum_quantity !== undefined ? parseNum(req.body.minimum_quantity, null) : null,
        req.body?.unit_price !== undefined ? parseNum(req.body.unit_price, null) : null,
        req.body?.serial_number ? normalizeText(req.body.serial_number) : null,
        req.body?.status ? normalizeText(req.body.status) : null,
        req.body?.notes ? normalizeText(req.body.notes) : null,
        stockItemId
      ]
    );

    if (!result.rows.length) return res.status(404).json({ message: 'Stock item not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('updateStockItem:', error);
    res.status(500).json({ message: 'Failed to update stock item' });
  }
};

const listStockMovements = async (req, res) => {
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'view')) return;

    const stockItemId = req.query?.stock_item_id ? parseNum(req.query.stock_item_id, 0) : 0;
    const params = [];
    const where = [];
    if (stockItemId) {
      params.push(stockItemId);
      where.push(`m.stock_item_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
        m.*,
        s.item_code,
        s.item_name,
        s.quantity_on_hand AS current_quantity,
        fo.name AS from_office_name,
        fd.desk_no AS from_desk_no,
        toff.name AS to_office_name,
        td.desk_no AS to_desk_no,
        u.full_name AS moved_by_name
       FROM asset_stock_movements m
       JOIN asset_stock_items s ON s.id = m.stock_item_id
       LEFT JOIN asset_offices fo ON fo.id = m.from_office_id
       LEFT JOIN asset_desks fd ON fd.id = m.from_desk_id
       LEFT JOIN asset_offices toff ON toff.id = m.to_office_id
       LEFT JOIN asset_desks td ON td.id = m.to_desk_id
       LEFT JOIN users u ON u.id = m.moved_by
       ${whereSql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 200`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    console.error('listStockMovements:', error);
    res.status(500).json({ message: 'Failed to load stock movements' });
  }
};

const createStockMovement = async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureAssetSchema();
    if (!requireAssetAccess(req, res, 'manage')) return;
    const auditUserId = await resolveAuditUserId(req.user?.id, client);

    const stockItemId = parseNum(req.body?.stock_item_id, 0);
    const quantityChange = parseNum(req.body?.quantity_change, 0);
    const movementType = normalizeText(req.body?.movement_type);
    if (!stockItemId || !movementType || !quantityChange) {
      return res.status(400).json({ message: 'stock_item_id, movement_type, and quantity_change are required' });
    }

    await client.query('BEGIN');
    const stockResult = await client.query(
      `SELECT * FROM asset_stock_items WHERE id = $1 FOR UPDATE`,
      [stockItemId]
    );
    if (!stockResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Stock item not found' });
    }

    const current = stockResult.rows[0];
    const nextQuantity = current.quantity_on_hand + quantityChange;
    if (nextQuantity < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Insufficient stock quantity' });
    }

    const updated = await client.query(
      `UPDATE asset_stock_items
       SET quantity_on_hand = $1,
           office_id = COALESCE($2, office_id),
           desk_id = COALESCE($3, desk_id),
           status = CASE
             WHEN $1 <= 0 THEN 'out_of_stock'
             WHEN $1 <= minimum_quantity THEN 'low_stock'
             ELSE 'available'
           END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [
        nextQuantity,
        req.body?.to_office_id ? parseNum(req.body.to_office_id, null) : null,
        req.body?.to_desk_id ? parseNum(req.body.to_desk_id, null) : null,
        stockItemId
      ]
    );

    const movement = await client.query(
      `INSERT INTO asset_stock_movements (
        stock_item_id, movement_type, quantity_change, from_office_id, from_desk_id,
        to_office_id, to_desk_id, moved_by, reason, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        stockItemId,
        movementType,
        quantityChange,
        req.body?.from_office_id ? parseNum(req.body.from_office_id, null) : current.office_id,
        req.body?.from_desk_id ? parseNum(req.body.from_desk_id, null) : current.desk_id,
        req.body?.to_office_id ? parseNum(req.body.to_office_id, null) : current.office_id,
        req.body?.to_desk_id ? parseNum(req.body.to_desk_id, null) : current.desk_id,
        auditUserId,
        normalizeText(req.body?.reason) || null,
        normalizeText(req.body?.notes) || null
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ stock_item: updated.rows[0], movement: movement.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createStockMovement:', error);
    res.status(500).json({ message: 'Failed to save stock movement' });
  } finally {
    client.release();
  }
};

module.exports = {
  ensureAssetSchema,
  getMasterData,
  createOffice,
  createDesk,
  updateDesk,
  getDeskHistory,
  createCategory,
  createVendor,
  listAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  moveAsset,
  getAssetHistory,
  listAssetComponents,
  createAssetComponent,
  updateAssetComponent,
  replaceAssetComponent,
  listAssetComponentMovements,
  getSummary,
  getReports,
  listWarranties,
  createWarranty,
  listIssues,
  createIssue,
  updateIssueStatus,
  listRepairs,
  createRepair,
  listReplacements,
  createReplacement,
  listMovements,
  listStockItems,
  createStockItem,
  updateStockItem,
  listStockMovements,
  createStockMovement
};
