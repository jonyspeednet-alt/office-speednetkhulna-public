const pool = require("../../utilities/db");
const bcrypt = require("bcrypt");
const {
  getActor,
  getReqMeta,
  logResellerFinancialChange,
} = require("../../utilities/resellerFinancialAudit");
const { calculateResellerMonthProjectedTotal } = require("./service");
const {
  normalizePartnerType,
  canViewResellerFinancials,
  hasAnyPermission,
  isAdminRole,
  parseAmount,
  parseWholeNumber,
  getDhakaMonthYm,
  normalizedPartnerTypeSql,
  LOG_TYPE_EXPR,
} = require("./utils");
const {
  initialize,
  detectPartnerTypeColumn,
  detectOtcAppliedMonthColumn,
  joiningDateExpr,
  hasResellerJoiningDateColumn,
  hasResellerPartnerTypeColumn,
  hasResellerOtcAppliedMonthColumn,
  detectChannelPartnerColumns,
  hasChannelPartnerColumns,
} = require("./dbSetup");

// Escape LIKE wildcards so search input can't inject %/_ patterns
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

const listResellers = async (req, res) => {
  try {
    await initialize();
    const canViewFinancials = canViewResellerFinancials(req.user);
    const search = (req.query.search || "").trim();
    const partnerTypeFilter = normalizePartnerType(
      req.query.partner_type || "",
    );
    const rawStatus = String(req.query.status || "active")
      .trim()
      .toLowerCase();
    const statusFilter = ["active", "inactive", "suspended", "all"].includes(
      rawStatus,
    )
      ? rawStatus
      : "active";
    const params = [];
    const whereParts = [];

    if (search) {
      params.push(`%${escapeLike(search)}%`);
      whereParts.push(
        `(COALESCE(r.reseller_name, r.company_name) ILIKE $${params.length} ESCAPE '\\' OR r.user_id ILIKE $${params.length} ESCAPE '\\' OR r.contact_no ILIKE $${params.length} ESCAPE '\\')`,
      );
    }

    if (statusFilter !== "all") {
      params.push(statusFilter);
      whereParts.push(
        `LOWER(COALESCE(r.status, 'active')) = $${params.length}`,
      );
    }
    if (partnerTypeFilter) {
      params.push(partnerTypeFilter);
      whereParts.push(
        `${normalizedPartnerTypeSql("COALESCE(r.partner_type, '')")} = $${params.length}`,
      );
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT
        r.id,
        r.user_id AS reseller_code,
        r.company_name,
        COALESCE(r.reseller_name, r.company_name) AS name,
        r.contact_no AS phone,
        r.contact_no AS contact_number,
        r.pop_location,
        r.pop_location AS address,
        r.pop_location AS ip_address,
        r.joining_date,
        r.created_at,
        ${normalizedPartnerTypeSql("COALESCE(r.partner_type, '')")} AS partner_type,
        COALESCE(r.iig_bw,0)::numeric AS iig_bw,
        COALESCE(r.bdix_bw,0)::numeric AS bdix_bw,
        COALESCE(r.ggc_bw,0)::numeric AS ggc_bw,
        COALESCE(r.fna_bw,0)::numeric AS fna_bw,
        COALESCE(r.cdn_bw,0)::numeric AS cdn_bw,
        COALESCE(r.bcdn_bw,0)::numeric AS bcdn_bw,
        COALESCE(r.nttn_capacity,0)::numeric AS nttn_capacity,
        COALESCE(r.nttn_link, '') AS nttn_link,
        (COALESCE(r.iig_bw,0) + COALESCE(r.bdix_bw,0) + COALESCE(r.ggc_bw,0) + COALESCE(r.fna_bw,0) + COALESCE(r.cdn_bw,0) + COALESCE(r.bcdn_bw,0))::numeric AS current_bw_mbps,
        COALESCE(r.otc_charge,0)::numeric AS otc_charge,
        COALESCE(r.real_ip_count,0)::int AS real_ip_count,
        COALESCE(r.real_ip_price,0)::numeric AS real_ip_price,
        fn_reseller_previous_due(r.id, DATE_TRUNC('month', CURRENT_DATE)::date) AS due_amount,
        r.next_pay_date,
        0::numeric AS monthly_rate,
        COALESCE(r.status, 'active') AS status,
        COALESCE(br_counts.cnt, 0)::int AS pending_requests
      FROM resellers r
      LEFT JOIN (
        SELECT reseller_id, COUNT(*)::int AS cnt
        FROM bandwidth_requests
        WHERE COALESCE(admin_status, 'pending') = 'pending'
        GROUP BY reseller_id
      ) br_counts ON br_counts.reseller_id = r.id
      ${where}
       ORDER BY CASE WHEN LOWER(COALESCE(r.status,'active'))='active' THEN 0 ELSE 1 END, r.id DESC
       LIMIT $${params.length + 1}`,
      [...params, Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200))],
    );

    const rows = canViewFinancials
      ? result.rows
      : result.rows.map((r) => ({
          ...r,
          monthly_rate: null,
          due_amount: null,
          next_pay_date: null,
        }));

    res.json(rows);
  } catch (error) {
    console.error("listResellers:", error);
    res.status(500).json({ message: "Failed to load resellers" });
  }
};

const createReseller = async (req, res) => {
  const client = await pool.connect();
  try {
    await initialize();
    const {
      reseller_name,
      name,
      company_name,
      reseller_code,
      user_id,
      phone,
      contact_no,
      partners,
      pop_location,
      ip_address,
      latitude,
      longitude,
      joining_date,
      iig_bw,
      bdix_bw,
      ggc_bw,
      fna_bw,
      cdn_bw,
      bcdn_bw,
      nttn_bw,
      nttn_capacity,
      rate_iig,
      rate_bdix,
      rate_ggc,
      rate_fna,
      rate_cdn,
      rate_bcdn,
      rate_nttn,
      nttn_type,
      nttn_link,
      connection_type,
      security_deposit,
      otc_charge,
      real_ip_count,
      real_ip_price,
      initial_payment,
      status,
      due_amount,
      next_pay_date,
      partner_type,
      channel_user_count,
      profit_share_percentage,
    } = req.body || {};

    const resellerName = String(reseller_name || name || "").trim();
    if (!resellerName)
      return res.status(400).json({ message: "Reseller name is required" });

    const manualUserId = String(user_id || reseller_code || "").trim();
    const baseUserId = resellerName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const generatedUserId = `${baseUserId || "reseller"}_${Math.floor(1000 + Math.random() * 9000)}`;
    const finalUserId = manualUserId || generatedUserId;
    const companyName = String(company_name || resellerName).trim();
    // Guessable-identifier passwords are the cheapest takeover: never accept
    // phone/contact/user_id as password; generate a random one when omitted.
    const crypto = require("crypto");
    const suppliedPw = String(req.body?.password || "").trim();
    const guessableIds = [
      String(contact_no || "").trim(),
      String(phone || "").trim(),
      String(finalUserId || "").trim(),
    ].filter(Boolean);
    let rawResellerPassword = null;
    let generatedTempPassword = null;
    let mustChangePassword = false;
    if (suppliedPw) {
      if (suppliedPw.length < 8 || guessableIds.includes(suppliedPw)) {
        return res.status(400).json({ message: "Password must be at least 8 characters and not the phone number or user ID" });
      }
      rawResellerPassword = suppliedPw;
    } else {
      rawResellerPassword = crypto.randomBytes(9).toString("base64url"); // 12 chars
      generatedTempPassword = rawResellerPassword;
      mustChangePassword = true;
    }
    const resellerPassword = await bcrypt.hash(rawResellerPassword, 10);
    const normalizedPartnerType =
      normalizePartnerType(partner_type) || "distribution_partner";

    const joinDate = String(
      joining_date || new Date().toISOString().slice(0, 10),
    ).slice(0, 10);
    const otcAppliedMonth = `${getDhakaMonthYm()}-01`;
    const bw = {
      iig_bw: parseAmount(iig_bw, 0),
      bdix_bw: parseAmount(bdix_bw, 0),
      ggc_bw: parseAmount(ggc_bw, 0),
      fna_bw: parseAmount(fna_bw, 0),
      cdn_bw: parseAmount(cdn_bw, 0),
      bcdn_bw: parseAmount(bcdn_bw, 0),
      nttn_capacity: parseAmount(nttn_capacity ?? nttn_bw, 0),
    };

    const rate = {
      rate_iig: parseAmount(rate_iig, 0),
      rate_bdix: parseAmount(rate_bdix, 0),
      rate_ggc: parseAmount(rate_ggc, 0),
      rate_fna: parseAmount(rate_fna, 0),
      rate_cdn: parseAmount(rate_cdn, 0),
      rate_bcdn: parseAmount(rate_bcdn, 0),
      rate_nttn: parseAmount(rate_nttn, 0),
    };
    const otcCharge = parseAmount(otc_charge, 0);
    const realIpCount = Math.max(0, parseWholeNumber(real_ip_count, 0));
    const realIpPrice = parseAmount(real_ip_price, 0);
    const projectedBill = calculateResellerMonthProjectedTotal({
      ...bw,
      ...rate,
      joining_date: joinDate,
      otc_charge: otcCharge,
      otc_charge_applied_month: otcAppliedMonth,
      real_ip_count: realIpCount,
      real_ip_price: realIpPrice,
    });

    const nttnTypeText = Array.isArray(nttn_type)
      ? nttn_type.join(", ")
      : String(nttn_type || "").trim();
    const connectionTypeText = Array.isArray(connection_type)
      ? connection_type.join(", ")
      : String(connection_type || "").trim();

    // Mirror update.js guards: negatives mint partner credit, junk status
    // fragments active-filtered billing.
    const CREATE_STATUSES = ['active', 'inactive', 'suspended'];
    if (status !== undefined && status !== null && String(status).trim() !== '' && !CREATE_STATUSES.includes(String(status).trim().toLowerCase())) {
      return res.status(400).json({ message: "status must be active, inactive, or suspended" });
    }
    for (const [k, v] of Object.entries({ ...bw, ...rate, otc_charge: otcCharge, security_deposit: parseAmount(security_deposit, 0), real_ip_price: realIpPrice })) {
      if (Number(v) < 0) {
        return res.status(400).json({ message: `${k} cannot be negative` });
      }
    }

    await client.query("BEGIN");

    const insertValuesBase = [
      finalUserId,
      resellerName,
      companyName,
      pop_location || ip_address || null,
      contact_no || phone || null,
      bw.iig_bw,
      bw.bdix_bw,
      bw.ggc_bw,
      bw.fna_bw,
      bw.cdn_bw,
      bw.bcdn_bw,
      bw.nttn_capacity,
      nttnTypeText || null,
      nttn_link || null,
      connectionTypeText || null,
      latitude || null,
      longitude || null,
      rate.rate_iig,
      rate.rate_bdix,
      rate.rate_ggc,
      rate.rate_fna,
      rate.rate_cdn,
      rate.rate_bcdn,
      rate.rate_nttn,
      next_pay_date || null,
      String(status || "active").toLowerCase(),
      parseAmount(security_deposit, 0),
      otcCharge,
      realIpCount,
      realIpPrice,
    ];

    // [columns current_projected_bill, previous_month_due removed — stale caches dropped from schema]
    const ins = await client.query(
      hasResellerJoiningDateColumn()
        ? hasResellerPartnerTypeColumn() && hasResellerOtcAppliedMonthColumn()
          ? `INSERT INTO resellers (
              user_id, reseller_name, company_name, pop_location, contact_no,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
              nttn_type, nttn_link, connection_type, latitude, longitude,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              next_pay_date, status, security_deposit, otc_charge, real_ip_count, real_ip_price, otc_charge_applied_month, partner_type, password, joining_date, created_at, last_activity_date
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,$11,$12,
              $13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,$24,
              $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,NOW(),NOW()
            ) RETURNING id`
          : hasResellerPartnerTypeColumn()
            ? `INSERT INTO resellers (
                user_id, reseller_name, company_name, pop_location, contact_no,
                iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
                nttn_type, nttn_link, connection_type, latitude, longitude,
                rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
                next_pay_date, status, security_deposit, otc_charge, real_ip_count, real_ip_price, partner_type, password, joining_date, created_at, last_activity_date
              ) VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,$8,$9,$10,$11,$12,
                $13,$14,$15,$16,$17,
                $18,$19,$20,$21,$22,$23,$24,
                $25,$26,$27,$28,$29,$30,$31,$32,$33,NOW(),NOW()
              ) RETURNING id`
            : `INSERT INTO resellers (
              user_id, reseller_name, company_name, pop_location, contact_no,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
              nttn_type, nttn_link, connection_type, latitude, longitude,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              next_pay_date, status, security_deposit, otc_charge, real_ip_count, real_ip_price, password, joining_date, created_at, last_activity_date
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,$11,$12,
              $13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,$24,
              $25,$26,$27,$28,$29,$30,$31,$32,NOW(),NOW()
            ) RETURNING id`
        : hasResellerPartnerTypeColumn() && hasResellerOtcAppliedMonthColumn()
          ? `INSERT INTO resellers (
              user_id, reseller_name, company_name, pop_location, contact_no,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
              nttn_type, nttn_link, connection_type, latitude, longitude,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              next_pay_date, status, security_deposit, otc_charge, real_ip_count, real_ip_price, otc_charge_applied_month, partner_type, password, created_at, last_activity_date
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,$11,$12,
              $13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,$24,
              $25,$26,$27,$28,$29,$30,$31,$32,$33,NOW(),NOW()
            ) RETURNING id`
          : hasResellerPartnerTypeColumn()
            ? `INSERT INTO resellers (
              user_id, reseller_name, company_name, pop_location, contact_no,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
              nttn_type, nttn_link, connection_type, latitude, longitude,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              next_pay_date, status, security_deposit, otc_charge, real_ip_count, real_ip_price, partner_type, password, created_at, last_activity_date
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,$11,$12,
              $13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,$24,
              $25,$26,$27,$28,$29,$30,$31,$32,NOW(),NOW()
            ) RETURNING id`
            : `INSERT INTO resellers (
              user_id, reseller_name, company_name, pop_location, contact_no,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
              nttn_type, nttn_link, connection_type, latitude, longitude,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              next_pay_date, status, security_deposit, otc_charge, real_ip_count, real_ip_price, password, created_at, last_activity_date
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,$11,$12,
              $13,$14,$15,$16,$17,
              $18,$19,$20,$21,$22,$23,$24,
              $25,$26,$27,$28,$29,$30,$31,NOW(),NOW()
            ) RETURNING id`,
      hasResellerJoiningDateColumn()
        ? hasResellerPartnerTypeColumn() && hasResellerOtcAppliedMonthColumn()
          ? [...insertValuesBase, otcAppliedMonth, normalizedPartnerType, resellerPassword, joinDate]
          : hasResellerPartnerTypeColumn()
            ? [...insertValuesBase, normalizedPartnerType, resellerPassword, joinDate]
            : [...insertValuesBase, resellerPassword, joinDate]
        : hasResellerPartnerTypeColumn() && hasResellerOtcAppliedMonthColumn()
          ? [...insertValuesBase, otcAppliedMonth, normalizedPartnerType, resellerPassword]
          : hasResellerPartnerTypeColumn()
            ? [...insertValuesBase, normalizedPartnerType, resellerPassword]
            : [...insertValuesBase, resellerPassword],
    );

    const newResellerId = ins.rows[0].id;

    // Random-generated password → reseller must change it on first login.
    if (mustChangePassword) {
      try {
        await client.query(
          "UPDATE resellers SET must_change_password = TRUE WHERE id = $1",
          [newResellerId],
        );
      } catch (err) {
        console.warn("createReseller: must_change_password flag failed:", err.message);
      }
    }

    const channelUserCount = Math.max(
      0,
      parseInt(channel_user_count || 0, 10) || 0,
    );
    const isCP = normalizedPartnerType === "channel_partner";
    const isMAC = normalizedPartnerType === "mac_partner";
    if (channelUserCount > 0 || isCP || isMAC) {
      if (channelUserCount > 0) {
        try {
          await client.query(
            "UPDATE resellers SET channel_user_count = $1 WHERE id = $2",
            [channelUserCount, newResellerId],
          );
        } catch (err) {
          console.warn("createReseller: channel_user_count update failed:", err.message);
        }
      }

      // Save initial profit share percentage
      const psp = parseAmount(profit_share_percentage, isCP ? 50 : 0);
      if (psp > 0) {
        try {
          await client.query(
            `
            INSERT INTO channel_partner_profile_settings (reseller_id, profit_share_percentage, updated_at)
            VALUES ($1, $2, NOW())
          `,
            [newResellerId, Math.max(0, Math.min(100, psp))],
          );
        } catch (err) {
          console.warn("createReseller: profit_share_percentage insert failed:", err.message);
        }
      }
    }

    // Save multiple partners (if provided)
    if (Array.isArray(partners) && partners.length > 0) {
      for (let i = 0; i < partners.length; i++) {
        const pName = String(partners[i]?.partner_name || '').trim();
        const pPhone = String(partners[i]?.contact_no || '').trim();
        if (pName || pPhone) {
          try {
            await client.query(
              `INSERT INTO reseller_partners (reseller_id, partner_name, contact_no, sort_order) VALUES ($1, $2, $3, $4)`,
              [newResellerId, pName, pPhone, i]
            );
          } catch (err) {
            console.warn('createReseller: reseller_partners insert failed:', err.message);
          }
        }
      }
    } else {
      // If no partners array, auto-create one from the single reseller_name + contact_no
      try {
        await client.query(
          `INSERT INTO reseller_partners (reseller_id, partner_name, contact_no, sort_order) VALUES ($1, $2, $3, 0)`,
          [newResellerId, resellerName, String(contact_no || phone || '').trim()]
        );
      } catch (err) {
        console.warn('createReseller: default reseller_partner insert failed:', err.message);
      }
    }

    const initPayment = parseAmount(initial_payment, 0);
    const createdAt = `${joinDate}T00:00:00`;
    const actor = getActor(req);
    const reqMeta = getReqMeta(req);

    try {
      await logResellerFinancialChange(client, {
        reseller_id: newResellerId,
        ...actor,
        ...reqMeta,
        action_type: "CREATE_RESELLER_FINANCIAL_BASELINE",
        reference_table: "resellers",
        reference_id: newResellerId,
        amount_before: 0,
        amount_after: Math.round(projectedBill * 100) / 100,
        amount_delta: Math.round(projectedBill * 100) / 100,
        due_before: 0,
        due_after: parseAmount(due_amount, 0),
        due_delta: parseAmount(due_amount, 0),
        field_changes: {
          current_projected_bill: {
            old: 0,
            new: Math.round(projectedBill * 100) / 100,
          },
          previous_month_due: { old: 0, new: parseAmount(due_amount, 0) },
          security_deposit: { old: 0, new: parseAmount(security_deposit, 0) },
          otc_charge: { old: 0, new: otcCharge },
          real_ip_count: { old: 0, new: realIpCount },
          real_ip_price: { old: 0, new: realIpPrice },
        },
        note: "Reseller created with financial baseline",
        request_payload: {
          due_amount,
          security_deposit,
          initial_payment,
          otc_charge: otcCharge,
          real_ip_count: realIpCount,
          real_ip_price: realIpPrice,
        },
      });
    } catch (auditErr) {
      console.warn("createReseller: financial baseline audit log failed:", auditErr.message);
    }

    if (initPayment > 0) {
      const paymentInsert = await client.query(
        `INSERT INTO billing_logs (reseller_id, change_desc, effective_date, transaction_amount, created_at, log_type)
         VALUES ($1,$2,$3::timestamp,$4,NOW(),'payment')
         RETURNING id`,
        [
          newResellerId,
          `Initial Payment: ${initPayment.toFixed(2)} Tk.`,
          createdAt,
          initPayment,
        ],
      );

      try {
        await logResellerFinancialChange(client, {
          reseller_id: newResellerId,
          ...actor,
          ...reqMeta,
          action_type: "ADD_INITIAL_PAYMENT",
          reference_table: "billing_logs",
          reference_id: paymentInsert.rows?.[0]?.id || null,
          amount_before: 0,
          amount_after: initPayment,
          amount_delta: initPayment,
          due_before: parseAmount(due_amount, 0),
          due_after: parseAmount(due_amount, 0),
          due_delta: 0,
          field_changes: { payment_amount: initPayment },
          note: `Initial payment logged for reseller ${newResellerId}`,
          request_payload: {
            initial_payment: initPayment,
            effective_date: createdAt,
          },
        });
      } catch (auditErr) {
        console.warn("createReseller: initial payment audit log failed:", auditErr.message);
      }
    }

    // B6: persist the opening balance as a billing_logs row (same transaction).
    // Previously due_amount was only audit-logged, so the first bill computed
    // previous_due = 0 and migrated receivables were silently lost.
    // Positive due → 'charge' (amount owed); negative (credit) → 'payment'.
    const openingDue = parseAmount(due_amount, 0);
    if (openingDue !== 0) {
      const openingType = openingDue > 0 ? 'charge' : 'payment';
      const openingAmt = Math.abs(Math.round(openingDue * 100) / 100);
      await client.query(
        `INSERT INTO billing_logs (reseller_id, change_desc, effective_date, transaction_amount, created_at, log_type)
         VALUES ($1,$2,$3::timestamp,$4,NOW(),$5)`,
        [
          newResellerId,
          `Opening balance on reseller creation: ${openingAmt.toFixed(2)} Tk.`,
          createdAt,
          openingAmt,
          openingType,
        ],
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      id: newResellerId,
      // Shown ONCE to the creating admin (sealed-slip handoff). Never stored/logged.
      ...(generatedTempPassword ? { tempPassword: generatedTempPassword } : {}),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("createReseller:", error);
    res
      .status(500)
      .json({ message: "Failed to create reseller" });
  } finally {
    client.release();
  }
};

const getResellerProfile = async (req, res) => {
  try {
    await initialize();
    const { id } = req.params;

    const resellerResult = await pool.query(
      `SELECT
        r.id,
        r.user_id AS reseller_code,
        r.company_name,
        COALESCE(r.reseller_name, r.company_name) AS name,
        r.contact_no AS phone,
        r.pop_location,
        r.pop_location AS ip_address,
        ${normalizedPartnerTypeSql("COALESCE(r.partner_type, '')")} AS partner_type,
        COALESCE(r.iig_bw,0)::numeric AS iig_bw,
        COALESCE(r.bdix_bw,0)::numeric AS bdix_bw,
        COALESCE(r.ggc_bw,0)::numeric AS ggc_bw,
        COALESCE(r.fna_bw,0)::numeric AS fna_bw,
        COALESCE(r.cdn_bw,0)::numeric AS cdn_bw,
        COALESCE(r.bcdn_bw,0)::numeric AS bcdn_bw,
        COALESCE(r.nttn_capacity,0)::numeric AS nttn_capacity,
        (COALESCE(r.iig_bw,0) + COALESCE(r.bdix_bw,0) + COALESCE(r.ggc_bw,0) + COALESCE(r.fna_bw,0) + COALESCE(r.cdn_bw,0) + COALESCE(r.bcdn_bw,0))::numeric AS current_bw_mbps,
        0::numeric AS monthly_rate,
        fn_reseller_previous_due(r.id, DATE_TRUNC('month', CURRENT_DATE)::date) AS due_amount,
        r.next_pay_date,
        COALESCE(r.status, 'active') AS status,
        r.created_at,
        ${joiningDateExpr("r")} AS joining_date,
        COALESCE(cpps.profit_share_percentage, 0)::numeric AS profit_share_percentage
      FROM resellers r
      LEFT JOIN channel_partner_profile_settings cpps ON cpps.reseller_id = r.id
      WHERE r.id = $1`,
      [id],
    );

    if (!resellerResult.rows.length) {
      return res.status(404).json({ message: "Reseller not found" });
    }

    const logTypeExpr = LOG_TYPE_EXPR();
    const logs = await pool.query(
      `SELECT id, reseller_id, request_id, change_desc AS note, transaction_amount AS amount, effective_date, created_at,
              ${logTypeExpr} AS log_type
       FROM billing_logs WHERE reseller_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [id],
    );

    const requests = await pool.query(
      `SELECT id, reseller_id, bw_type, change_type, amount AS requested_bw_mbps, requested_effective_date,
              reseller_note AS reason,
              COALESCE(engineer_status, admin_status, 'pending') AS status,
              created_at, implementation_date AS applied_at
       FROM bandwidth_requests WHERE reseller_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [id],
    );

    const bills = await pool.query(
      `SELECT id, reseller_id, bill_month, amount AS final_amount, adjustment, previous_due, created_at
       FROM monthly_bills WHERE reseller_id = $1 ORDER BY bill_month DESC LIMIT 24`,
      [id],
    );

    const partnersResult = await pool.query(
      `SELECT id, partner_name, contact_no, sort_order
       FROM reseller_partners WHERE reseller_id = $1 ORDER BY sort_order ASC, id ASC`,
      [id],
    );

    res.json({
      reseller: resellerResult.rows[0],
      partners: partnersResult.rows,
      billingLogs: logs.rows,
      bandwidthRequests: requests.rows,
      monthlyBills: bills.rows,
    });
  } catch (error) {
    console.error("getResellerProfile:", error);
    res.status(500).json({ message: "Failed to load reseller profile" });
  }
};

module.exports = {
  listResellers,
  createReseller,
  getResellerProfile,
};
