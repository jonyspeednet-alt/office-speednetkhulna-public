const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');

const normalizePhone = (value) => String(value || '').trim();
const normalizeText = (value) => String(value || '').trim() || null;
const normalizeDate = (value) => {
  const text = String(value || '').trim();
  return text || null;
};
const normalizeAmount = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const getBranchByCode = async (code) => {
  const result = await pool.query(
    `
    SELECT code, name
    FROM internet_branches
    WHERE is_active = TRUE AND code = $1
    LIMIT 1
    `,
    [code]
  );
  return result.rows[0] || null;
};

const getPackages = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, speed_mbps, price_bdt, is_active
      FROM internet_packages
      WHERE is_active = TRUE
      ORDER BY speed_mbps ASC, price_bdt ASC, name ASC
      `
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Get packages error:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
};

const createRegistration = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      applicant_name,
      phone,
      alternate_phone,
      email,
      area,
      address,
      preferred_package_mbps,
      connection_type,
      preferred_contact_time,
      notes,
      user_id_ip,
      internet_user_id,
      internet_password,
      application_date,
      connection_date,
      guardian_name,
      district,
      nid_number,
      date_of_birth,
      occupation,
      reference_name,
      billing_contact_person,
      billing_address,
      billing_contact_number,
      installation_charge,
      billing_cycle_day,
      connection_expire_day,
      package_id,
      package_rate,
      monthly_bill,
      billing_id,
      billing_date,
      account_type,
      package_type,
      connectivity_type,
      connection_media_type,
      real_ip_required,
      extra_hub,
      free_id_pool_id
    } = req.body;

    if (!String(applicant_name || '').trim()) {
      return res.status(400).json({ message: 'Applicant name is required' });
    }
    if (!normalizePhone(phone)) {
      return res.status(400).json({ message: 'Phone is required' });
    }
    if (!String(area || '').trim()) {
      return res.status(400).json({ message: 'Area is required' });
    }
    if (!String(address || '').trim()) {
      return res.status(400).json({ message: 'Address is required' });
    }

    const pkg = Number(preferred_package_mbps || 0);
    const safePackage = Number.isFinite(pkg) && pkg > 0 ? Math.floor(pkg) : null;
    const parsedPackageId = Number(package_id || 0);
    const safePackageId = Number.isFinite(parsedPackageId) && parsedPackageId > 0 ? parsedPackageId : null;
    const parsedBillingCycleDay = Number(billing_cycle_day || 0);
    const safeBillingCycleDay = Number.isFinite(parsedBillingCycleDay) && parsedBillingCycleDay > 0 ? parsedBillingCycleDay : null;
    const parsedExpireDay = Number(connection_expire_day || 0);
    const safeExpireDay = Number.isFinite(parsedExpireDay) && parsedExpireDay > 0 ? parsedExpireDay : null;

    await client.query('BEGIN');

    if (safePackageId) {
      const packageResult = await client.query(
        `
        SELECT id
        FROM internet_packages
        WHERE id = $1 AND is_active = TRUE
        `,
        [safePackageId]
      );
      if (!packageResult.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Selected package is invalid' });
      }
    }

    let selectedFreeId = null;
    const parsedFreeIdPoolId = Number(free_id_pool_id || 0);
    if (parsedFreeIdPoolId > 0) {
      const freeIdResult = await client.query(
        `
        SELECT id, branch_code, branch_name, user_id_ip, is_available
        FROM internet_branch_free_ids
        WHERE id = $1
        FOR UPDATE
        `,
        [parsedFreeIdPoolId]
      );
      selectedFreeId = freeIdResult.rows[0] || null;
      if (!selectedFreeId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Selected free ID does not exist' });
      }
      if (!selectedFreeId.is_available) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Selected free ID is already used' });
      }
    }

    const result = await client.query(
      `
      INSERT INTO internet_connection_registrations
      (
        applicant_name, phone, alternate_phone, email, area, address,
        preferred_package_mbps, connection_type, preferred_contact_time, notes,
        user_id_ip, internet_user_id, internet_password, application_date, connection_date, guardian_name, district,
        nid_number, date_of_birth, occupation, reference_name,
        billing_contact_person, billing_address, billing_contact_number,
        installation_charge, billing_cycle_day, connection_expire_day, package_id, package_rate, monthly_bill, billing_id, billing_date,
        account_type, package_type, connectivity_type, connection_media_type,
        real_ip_required, extra_hub, free_id_pool_id, branch_code, branch_name,
        status, source, created_by
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
       'new','office_form',$42)
      RETURNING *
      `,
      [
        String(applicant_name).trim(),
        normalizePhone(phone),
        normalizeText(alternate_phone),
        normalizeText(email),
        String(area).trim(),
        String(address).trim(),
        safePackage,
        String(connection_type || 'home').trim(),
        normalizeText(preferred_contact_time),
        normalizeText(notes),
        selectedFreeId ? selectedFreeId.user_id_ip : normalizeText(user_id_ip),
        normalizeText(internet_user_id),
        normalizeText(internet_password),
        normalizeDate(application_date),
        normalizeDate(connection_date),
        normalizeText(guardian_name),
        normalizeText(district),
        normalizeText(nid_number),
        normalizeDate(date_of_birth),
        normalizeText(occupation),
        normalizeText(reference_name),
        normalizeText(billing_contact_person),
        normalizeText(billing_address),
        normalizePhone(billing_contact_number) || null,
        normalizeAmount(installation_charge),
        safeBillingCycleDay,
        safeExpireDay,
        safePackageId,
        normalizeAmount(package_rate),
        normalizeAmount(monthly_bill),
        normalizeText(billing_id),
        normalizeDate(billing_date),
        normalizeText(account_type),
        normalizeText(package_type),
        normalizeText(connectivity_type),
        normalizeText(connection_media_type),
        real_ip_required === true || real_ip_required === 'yes' || real_ip_required === 'true',
        extra_hub === true || extra_hub === 'true' || extra_hub === 1,
        selectedFreeId ? selectedFreeId.id : null,
        selectedFreeId ? selectedFreeId.branch_code : null,
        selectedFreeId ? selectedFreeId.branch_name : null,
        req.user?.id || null
      ]
    );

    if (selectedFreeId) {
      await client.query(
        `
        UPDATE internet_branch_free_ids
        SET is_available = FALSE,
            allocated_registration_id = $1,
            allocated_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
        `,
        [result.rows[0].id, selectedFreeId.id]
      );
    }

    await client.query('COMMIT');
    // Provisioning credentials remain server-side; never include them in API responses.
    const { internet_password: _internetPassword, ...registration } = result.rows[0];
    return res.status(201).json(registration);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Create registration rollback error:', rollbackError);
    }
    console.error('Create registration error:', error);
    return res.status(500).json({ message: 'Server Error' });
  } finally {
    client.release();
  }
};

const getRegistrations = async (req, res) => {
  try {
    const canManage = resolvePermission(req.user, 'support.router.manage');
    const result = await pool.query(
      `
      SELECT id, applicant_name, phone, alternate_phone, email, area, address,
        preferred_package_mbps, connection_type, preferred_contact_time, notes,
        status, source, created_by, created_at, updated_at, user_id_ip,
        application_date, connection_date, guardian_name, district, nid_number,
        date_of_birth, occupation, reference_name, billing_contact_person,
        billing_address, billing_contact_number, installation_charge, package_rate,
        monthly_bill, billing_id, billing_date, account_type, package_type,
        connectivity_type, connection_media_type, real_ip_required, extra_hub,
        free_id_pool_id, branch_code, branch_name, internet_user_id, package_id,
        billing_cycle_day, connection_expire_day
      FROM internet_connection_registrations
      ${canManage ? '' : 'WHERE created_by = $1'}
      ORDER BY created_at DESC
      LIMIT 200
      `,
      canManage ? [] : [req.user.id]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Get registrations error:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
};

const createFreeIds = async (req, res) => {
  try {
    const branchCode = String(req.body?.branch_code || '').trim();
    const branchName = String(req.body?.branch_name || '').trim();
    const remarks = String(req.body?.remarks || '').trim() || null;
    const oneId = String(req.body?.user_id_ip || '').trim();

    if (!branchCode) return res.status(400).json({ message: 'branch_code is required' });
    if (!oneId) return res.status(400).json({ message: 'user_id_ip is required' });
    if (!/^\d{4,5}$/.test(oneId)) {
      return res.status(400).json({ message: 'user_id_ip must be a 4 or 5 digit number' });
    }

    const branch = await getBranchByCode(branchCode);
    if (!branch) return res.status(400).json({ message: 'Invalid branch_code' });
    if (branchName && branchName !== branch.name) {
      return res.status(400).json({ message: 'branch_name does not match branch_code' });
    }

    const result = await pool.query(
      `
      INSERT INTO internet_branch_free_ids (branch_code, branch_name, user_id_ip, remarks)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (branch_code, user_id_ip) DO NOTHING
      RETURNING id, branch_code, branch_name, user_id_ip, remarks, is_available
      `,
      [branch.code, branch.name, oneId, remarks]
    );

    const insertedCount = result.rowCount || 0;
    const skippedCount = insertedCount ? 0 : 1;
    return res.status(201).json({
      message: 'Free ID input processed',
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      items: result.rows
    });
  } catch (error) {
    console.error('Create free IDs error:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
};

const createFreeIdsBulk = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: 'rows is required' });
    if (rows.length > 10000) {
      return res.status(400).json({ message: 'Maximum 10000 rows allowed per upload' });
    }

    const activeBranches = await pool.query(
      `
      SELECT code, name
      FROM internet_branches
      WHERE is_active = TRUE
      `
    );
    const branchByCode = new Map(activeBranches.rows.map((b) => [String(b.code).trim(), b]));
    const branchCodeByName = new Map(
      activeBranches.rows.map((b) => [String(b.name).trim().toLowerCase(), String(b.code).trim()])
    );

    const seen = new Set();
    const validItems = [];
    const errors = [];

    rows.forEach((raw, index) => {
      const rowNo = index + 2;
      const branchCodeRaw = String(raw?.branch_code || '').trim();
      const branchNameRaw = String(raw?.branch_name || '').trim();
      const idRaw = String(raw?.user_id_ip || '').trim();

      if (!branchCodeRaw && !branchNameRaw) {
        errors.push({ row: rowNo, reason: 'branch_code or branch_name is required' });
        return;
      }
      if (!idRaw) {
        errors.push({ row: rowNo, reason: 'user_id_ip is required' });
        return;
      }
      if (!/^\d{4,5}$/.test(idRaw)) {
        errors.push({ row: rowNo, reason: 'user_id_ip must be 4 or 5 digit number' });
        return;
      }

      let resolvedBranch = null;
      if (branchCodeRaw) {
        resolvedBranch = branchByCode.get(branchCodeRaw) || null;
      } else if (branchNameRaw) {
        const code = branchCodeByName.get(branchNameRaw.toLowerCase()) || '';
        resolvedBranch = branchByCode.get(code) || null;
      }

      if (!resolvedBranch) {
        errors.push({ row: rowNo, reason: `Invalid branch (${branchCodeRaw || branchNameRaw})` });
        return;
      }

      if (branchNameRaw && branchNameRaw.toLowerCase() !== String(resolvedBranch.name).toLowerCase()) {
        errors.push({ row: rowNo, reason: 'branch_name does not match branch_code' });
        return;
      }

      const uniqueKey = `${resolvedBranch.code}::${idRaw}`;
      if (seen.has(uniqueKey)) return;
      seen.add(uniqueKey);
      validItems.push({
        branch_code: resolvedBranch.code,
        branch_name: resolvedBranch.name,
        user_id_ip: idRaw
      });
    });

    if (!validItems.length) {
      return res.status(400).json({
        message: 'No valid rows to insert',
        inserted_count: 0,
        skipped_count: 0,
        error_count: errors.length,
        errors
      });
    }

    const values = [];
    const params = [];
    let i = 1;
    validItems.forEach((item) => {
      values.push(`($${i++}, $${i++}, $${i++}, NULL)`);
      params.push(item.branch_code, item.branch_name, item.user_id_ip);
    });

    const result = await pool.query(
      `
      INSERT INTO internet_branch_free_ids (branch_code, branch_name, user_id_ip, remarks)
      VALUES ${values.join(', ')}
      ON CONFLICT (branch_code, user_id_ip) DO NOTHING
      RETURNING id, branch_code, branch_name, user_id_ip, is_available
      `,
      params
    );

    const insertedCount = result.rowCount || 0;
    const skippedCount = validItems.length - insertedCount;

    return res.status(201).json({
      message: 'Bulk free ID upload processed',
      inserted_count: insertedCount,
      skipped_count: skippedCount,
      error_count: errors.length,
      errors
    });
  } catch (error) {
    console.error('Bulk create free IDs error:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  createRegistration,
  getRegistrations,
  getPackages,
  createFreeIds,
  createFreeIdsBulk,
  getBranches: async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT code, name
        FROM internet_branches
        WHERE is_active = TRUE
        ORDER BY name ASC
        `
      );
      return res.json(result.rows);
    } catch (error) {
      console.error('Get internet branches error:', error);
      return res.status(500).json({ message: 'Server Error' });
    }
  },
  getAvailableFreeIds: async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT id, branch_code, branch_name, user_id_ip, remarks
        FROM internet_branch_free_ids
        WHERE is_available = TRUE
        ORDER BY branch_name ASC, user_id_ip ASC
        `
      );

      const grouped = result.rows.reduce((acc, row) => {
        const key = row.branch_code || 'UNKNOWN';
        if (!acc[key]) {
          acc[key] = {
            branch_code: row.branch_code,
            branch_name: row.branch_name,
            available_count: 0,
            ids: []
          };
        }
        acc[key].available_count += 1;
        acc[key].ids.push({
          id: row.id,
          user_id_ip: row.user_id_ip,
          remarks: row.remarks || null
        });
        return acc;
      }, {});

      return res.json(Object.values(grouped));
    } catch (error) {
      console.error('Get free IDs error:', error);
      return res.status(500).json({ message: 'Server Error' });
    }
  }
};
