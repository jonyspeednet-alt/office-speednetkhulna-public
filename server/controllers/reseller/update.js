const pool = require("../../utilities/db");
const bcrypt = require("bcrypt");
const {
  getActor,
  getReqMeta,
  logResellerFinancialChange,
} = require("../../utilities/resellerFinancialAudit");
const {
  normalizePartnerType,
  parseAmount,
  parseWholeNumber,
  getDhakaMonthYm,
} = require("./utils");
const {
  initialize,
  detectPartnerTypeColumn,
  detectOtcAppliedMonthColumn,
  detectChannelPartnerColumns,
  hasResellerJoiningDateColumn,
  hasResellerPartnerTypeColumn,
  hasResellerOtcAppliedMonthColumn,
  hasChannelPartnerColumns,
} = require("./dbSetup");
const { refreshProjectedBillForCurrentMonth } = require("./service");
const { invalidateMonthlySummaryCache } = require("./billing");
const {
  initChannelPartnerTables,
} = require("../../utilities/channelPartnerInit");

const updateReseller = async (req, res) => {
  try {
    await initialize();
    await initChannelPartnerTables();
    await detectChannelPartnerColumns(true);
    const { id } = req.params;
    const {
      name,
      company_name,
      phone,
      ip_address,
      pop_location,
      latitude,
      longitude,
      reseller_code,
      status,
      iig_bw,
      bdix_bw,
      ggc_bw,
      fna_bw,
      cdn_bw,
      bcdn_bw,
      nttn_capacity,
      nttn_type,
      nttn_link,
      connection_type,
      rate_iig,
      rate_bdix,
      rate_ggc,
      rate_fna,
      rate_cdn,
      rate_bcdn,
      rate_nttn,
      monthly_rate,
      due_amount,
      next_pay_date,
      security_deposit,
      otc_charge,
      real_ip_count,
      real_ip_price,
      password,
      joining_date,
      partner_type,
    } = req.body || {};

    const normalizedStatus = (status || "").toLowerCase();
    const hasExplicitStatus = status !== undefined;
    const shouldZeroProjectedBill =
      hasExplicitStatus && normalizedStatus !== "active";
    const hasExplicitPartnerType = req.body.partner_type !== undefined;
    const hasExplicitOtcCharge = req.body.otc_charge !== undefined;
    const hasPartnersUpdate = Array.isArray(req.body.partners);
    const hasBillingImpactingChange = [
      "iig_bw",
      "bdix_bw",
      "ggc_bw",
      "fna_bw",
      "cdn_bw",
      "bcdn_bw",
      "nttn_capacity",
      "rate_iig",
      "rate_bdix",
      "rate_ggc",
      "rate_fna",
      "rate_cdn",
      "rate_bcdn",
      "rate_nttn",
      "joining_date",
      "real_ip_count",
      "real_ip_price",
      "otc_charge",
      "status",
    ].some((key) => req.body[key] !== undefined);
    const shouldRefreshProjectedBill =
      hasBillingImpactingChange &&
      normalizedStatus !== "inactive" &&
      normalizedStatus !== "suspended";
    const normalizedPartnerType = normalizePartnerType(partner_type);

    const beforeResult = await pool.query(
      `SELECT r.id,
              COALESCE(r.security_deposit,0)::numeric AS security_deposit,
              COALESCE(r.otc_charge,0)::numeric AS otc_charge,
              COALESCE(r.real_ip_count,0)::int AS real_ip_count,
              COALESCE(r.real_ip_price,0)::numeric AS real_ip_price,
              COALESCE(r.rate_iig,0)::numeric AS rate_iig,
              COALESCE(r.rate_bdix,0)::numeric AS rate_bdix,
              COALESCE(r.rate_ggc,0)::numeric AS rate_ggc,
              COALESCE(r.rate_fna,0)::numeric AS rate_fna,
              COALESCE(r.rate_cdn,0)::numeric AS rate_cdn,
              COALESCE(r.rate_bcdn,0)::numeric AS rate_bcdn,
              COALESCE(r.rate_nttn,0)::numeric AS rate_nttn,
              COALESCE(cpps.profit_share_percentage, 0)::numeric AS profit_share_percentage
       FROM resellers r
       LEFT JOIN channel_partner_profile_settings cpps ON cpps.reseller_id = r.id
       WHERE r.id = $1`,
      [id],
    );
    if (!beforeResult.rows.length) {
      return res.status(404).json({ message: "Reseller not found" });
    }
    const before = beforeResult.rows[0];
    // Compute before values from dynamic functions (stale columns dropped)
    const curYm = getDhakaMonthYm();
    try {
      const beforeVals = await pool.query(
        `SELECT fn_reseller_previous_due($1, $2::date) AS due_before,
                COALESCE((SELECT amount FROM monthly_bills WHERE reseller_id = $1 AND bill_month = $2::date), 0) AS projected_before`,
        [id, `${curYm}-01`],
      );
      before.previous_month_due = Number(beforeVals.rows[0]?.due_before || 0);
      before.current_projected_bill = Number(beforeVals.rows[0]?.projected_before || 0);
    } catch (e) {
      before.previous_month_due = 0;
      before.current_projected_bill = 0;
    }

    const newPasswordRaw = String(password || "").trim();
    let newHashedPassword = null;    if (newPasswordRaw) {
      // S18: never accept a pre-computed hash as the new password — always hash.
      // A hash-looking input is rejected so a leaked DB hash can't be replayed.
      if (/^\$2[aby]\$/.test(newPasswordRaw)) {
        return res.status(400).json({ message: "Invalid password value" });
      }
      // Admin resets must meet the same bar as self-service: 8+ chars and
      // never the phone number or reseller code (cheapest takeover).
      if (newPasswordRaw.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const resetIds = [String(phone || "").trim(), String(reseller_code || "").trim()].filter(Boolean);
      if (resetIds.includes(newPasswordRaw)) {
        return res.status(400).json({ message: "Phone number or reseller code cannot be used as password" });
      }
      newHashedPassword = await bcrypt.hash(newPasswordRaw, 10);
    }

    // Enum + sign guards: free-text status breaks active-filtered billing,
    // negative bw/rates/deposits mint partner credit out of thin air.
    const RESELLER_STATUSES = ['active', 'inactive', 'suspended'];
    if (status !== undefined && status !== null && String(status).trim() !== '' && !RESELLER_STATUSES.includes(String(status).trim().toLowerCase())) {
      return res.status(400).json({ message: "status must be active, inactive, or suspended" });
    }
    const NON_NEG_FIELDS = ['iig_bw','bdix_bw','ggc_bw','fna_bw','cdn_bw','bcdn_bw','nttn_capacity','rate_iig','rate_bdix','rate_ggc','rate_fna','rate_cdn','rate_bcdn','rate_nttn','security_deposit','otc_charge','real_ip_price'];
    for (const f of NON_NEG_FIELDS) {
      const raw = req.body[f];
      if (raw !== undefined && raw !== null && String(raw).trim() !== '' && Number(String(raw).replace(/[^0-9.\-]/g, '')) < 0) {
        return res.status(400).json({ message: `${f} cannot be negative` });
      }
    }

    const updateValuesBase = [
      name || null,      company_name || null,
      phone || null,
      pop_location || ip_address || null,
      latitude || null,
      longitude || null,
      reseller_code || null,
      status || null,
      req.body.iig_bw !== undefined ? parseAmount(iig_bw, 0) : null,
      req.body.bdix_bw !== undefined ? parseAmount(bdix_bw, 0) : null,
      req.body.ggc_bw !== undefined ? parseAmount(ggc_bw, 0) : null,
      req.body.fna_bw !== undefined ? parseAmount(fna_bw, 0) : null,
      req.body.cdn_bw !== undefined ? parseAmount(cdn_bw, 0) : null,
      req.body.bcdn_bw !== undefined ? parseAmount(bcdn_bw, 0) : null,
      req.body.nttn_capacity !== undefined
        ? parseAmount(nttn_capacity, 0)
        : null,
      nttn_type || null,
      nttn_link || null,
      connection_type || null,
      req.body.rate_iig !== undefined ? parseAmount(rate_iig, 0) : null,
      req.body.rate_bdix !== undefined ? parseAmount(rate_bdix, 0) : null,
      req.body.rate_ggc !== undefined ? parseAmount(rate_ggc, 0) : null,
      req.body.rate_fna !== undefined ? parseAmount(rate_fna, 0) : null,
      req.body.rate_cdn !== undefined ? parseAmount(rate_cdn, 0) : null,
      req.body.rate_bcdn !== undefined ? parseAmount(rate_bcdn, 0) : null,
      req.body.rate_nttn !== undefined ? parseAmount(rate_nttn, 0) : null,
      next_pay_date || null,
      req.body.security_deposit !== undefined
        ? parseAmount(security_deposit, 0)
        : null,
      req.body.otc_charge !== undefined ? parseAmount(otc_charge, 0) : null,
      req.body.real_ip_count !== undefined
        ? Math.max(0, parseWholeNumber(real_ip_count, 0))
        : null,
      req.body.real_ip_price !== undefined
        ? parseAmount(real_ip_price, 0)
        : null,
      newHashedPassword,
    ];

    const updateQuery = hasResellerJoiningDateColumn()
      ? `UPDATE resellers SET
          reseller_name = COALESCE($1, reseller_name),
          company_name = COALESCE($2, company_name),
          contact_no = COALESCE($3, contact_no),
          pop_location = COALESCE($4, pop_location),
          latitude = COALESCE($5, latitude),
          longitude = COALESCE($6, longitude),
          user_id = COALESCE($7, user_id),
          status = COALESCE($8, status),
          iig_bw = COALESCE($9, iig_bw),
          bdix_bw = COALESCE($10, bdix_bw),
          ggc_bw = COALESCE($11, ggc_bw),
          fna_bw = COALESCE($12, fna_bw),
          cdn_bw = COALESCE($13, cdn_bw),
          bcdn_bw = COALESCE($14, bcdn_bw),
          nttn_capacity = COALESCE($15, nttn_capacity),
          nttn_type = COALESCE($16, nttn_type),
          nttn_link = COALESCE($17, nttn_link),
          connection_type = COALESCE($18, connection_type),
          rate_iig = COALESCE($19, rate_iig),
          rate_bdix = COALESCE($20, rate_bdix),
          rate_ggc = COALESCE($21, rate_ggc),
          rate_fna = COALESCE($22, rate_fna),
          rate_cdn = COALESCE($23, rate_cdn),
          rate_bcdn = COALESCE($24, rate_bcdn),
          rate_nttn = COALESCE($25, rate_nttn),
          next_pay_date = COALESCE($26, next_pay_date),
          security_deposit = COALESCE($27, security_deposit),
          otc_charge = COALESCE($28, otc_charge),
          real_ip_count = COALESCE($29, real_ip_count),
          real_ip_price = COALESCE($30, real_ip_price),
          password = COALESCE($31, password),
          must_change_password = CASE WHEN $31 IS NOT NULL THEN TRUE ELSE must_change_password END,
          token_version = CASE WHEN $31 IS NOT NULL THEN COALESCE(token_version, 0) + 1 ELSE token_version END,
          joining_date = COALESCE($32::date, joining_date),
          last_activity_date = NOW()
        WHERE id = $33
        RETURNING id,
                  COALESCE(security_deposit,0)::numeric AS security_deposit,
                  COALESCE(otc_charge,0)::numeric AS otc_charge,
                  COALESCE(real_ip_count,0)::int AS real_ip_count,
                  COALESCE(real_ip_price,0)::numeric AS real_ip_price,
                  COALESCE(rate_iig,0)::numeric AS rate_iig,
                  COALESCE(rate_bdix,0)::numeric AS rate_bdix,
                  COALESCE(rate_ggc,0)::numeric AS rate_ggc,
                  COALESCE(rate_fna,0)::numeric AS rate_fna,
                  COALESCE(rate_cdn,0)::numeric AS rate_cdn,
                  COALESCE(rate_bcdn,0)::numeric AS rate_bcdn,
                  COALESCE(rate_nttn,0)::numeric AS rate_nttn`
      : `UPDATE resellers SET
          reseller_name = COALESCE($1, reseller_name),
          company_name = COALESCE($2, company_name),
          contact_no = COALESCE($3, contact_no),
          pop_location = COALESCE($4, pop_location),
          latitude = COALESCE($5, latitude),
          longitude = COALESCE($6, longitude),
          user_id = COALESCE($7, user_id),
          status = COALESCE($8, status),
          iig_bw = COALESCE($9, iig_bw),
          bdix_bw = COALESCE($10, bdix_bw),
          ggc_bw = COALESCE($11, ggc_bw),
          fna_bw = COALESCE($12, fna_bw),
          cdn_bw = COALESCE($13, cdn_bw),
          bcdn_bw = COALESCE($14, bcdn_bw),
          nttn_capacity = COALESCE($15, nttn_capacity),
          nttn_type = COALESCE($16, nttn_type),
          nttn_link = COALESCE($17, nttn_link),
          connection_type = COALESCE($18, connection_type),
          rate_iig = COALESCE($19, rate_iig),
          rate_bdix = COALESCE($20, rate_bdix),
          rate_ggc = COALESCE($21, rate_ggc),
          rate_fna = COALESCE($22, rate_fna),
          rate_cdn = COALESCE($23, rate_cdn),
          rate_bcdn = COALESCE($24, rate_bcdn),
          rate_nttn = COALESCE($25, rate_nttn),
          next_pay_date = COALESCE($26, next_pay_date),
          security_deposit = COALESCE($27, security_deposit),
          otc_charge = COALESCE($28, otc_charge),
          real_ip_count = COALESCE($29, real_ip_count),
          real_ip_price = COALESCE($30, real_ip_price),
          password = COALESCE($31, password),
          must_change_password = CASE WHEN $31 IS NOT NULL THEN TRUE ELSE must_change_password END,
          token_version = CASE WHEN $31 IS NOT NULL THEN COALESCE(token_version, 0) + 1 ELSE token_version END,
          last_activity_date = NOW()
        WHERE id = $32
        RETURNING id,
                  COALESCE(security_deposit,0)::numeric AS security_deposit,
                  COALESCE(otc_charge,0)::numeric AS otc_charge,
                  COALESCE(real_ip_count,0)::int AS real_ip_count,
                  COALESCE(real_ip_price,0)::numeric AS real_ip_price,
                  COALESCE(rate_iig,0)::numeric AS rate_iig,
                  COALESCE(rate_bdix,0)::numeric AS rate_bdix,
                  COALESCE(rate_ggc,0)::numeric AS rate_ggc,
                  COALESCE(rate_fna,0)::numeric AS rate_fna,
                  COALESCE(rate_cdn,0)::numeric AS rate_cdn,
                  COALESCE(rate_bcdn,0)::numeric AS rate_bcdn,
                  COALESCE(rate_nttn,0)::numeric AS rate_nttn`;

    const updateValues = hasResellerJoiningDateColumn()
      ? [...updateValuesBase, joining_date || null, id]
      : [...updateValuesBase, id];

    const result = await pool.query(updateQuery, updateValues);
    let after = result.rows[0];

    if (hasResellerOtcAppliedMonthColumn() && hasExplicitOtcCharge) {
      await pool.query(
        `UPDATE resellers
         SET otc_charge_applied_month = $1
         WHERE id = $2`,
        [parseAmount(otc_charge, 0) > 0 ? `${getDhakaMonthYm()}-01` : null, id],
      );
    }

    if (shouldRefreshProjectedBill) {
      const refreshedProjected = await refreshProjectedBillForCurrentMonth(
        Number(id),
      );
      after = {
        ...after,
        current_projected_bill: refreshedProjected,
      };
    }
    if (
      hasResellerPartnerTypeColumn() &&
      hasExplicitPartnerType &&
      normalizedPartnerType
    ) {
      await pool.query(`UPDATE resellers SET partner_type = $1 WHERE id = $2`, [
        normalizedPartnerType,
        id,
      ]);
    }

    const watchedFields = [
      "current_projected_bill",
      "previous_month_due",
      "security_deposit",
      "otc_charge",
      "real_ip_count",
      "real_ip_price",
      "rate_iig",
      "rate_bdix",
      "rate_ggc",
      "rate_fna",
      "rate_cdn",
      "rate_bcdn",
      "rate_nttn",
      "profit_share_percentage",
    ];
    const fieldChanges = {};

    if (req.body.profit_share_percentage !== undefined) {
      const psp = parseAmount(req.body.profit_share_percentage, 0);
      const resellerIdInt = parseInt(id, 10);
      const clampedPsp = Math.max(0, Math.min(100, psp));

      // Validate that this is a channel partner
      const partnerCheck = await pool.query(
        "SELECT partner_type FROM resellers WHERE id = $1",
        [resellerIdInt],
      );

      if (partnerCheck.rows.length === 0) {
        return res.status(404).json({ message: "Reseller not found" });
      }

      if (
        normalizePartnerType(partnerCheck.rows[0].partner_type) !==
        "channel_partner" &&
        normalizePartnerType(partnerCheck.rows[0].partner_type) !==
        "mac_partner"
      ) {
        return res.status(400).json({
          message: "Profit share can only be set for channel/MAC partners",
        });
      }

      // Re-detect columns after initialization
      await detectChannelPartnerColumns(true);

      // Update channel_partner_profile_settings table
      await pool.query(
        `
                INSERT INTO channel_partner_profile_settings (reseller_id, profit_share_percentage, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (reseller_id) DO UPDATE SET
                    profit_share_percentage = EXCLUDED.profit_share_percentage,
                    updated_at = NOW()
            `,
        [resellerIdInt, clampedPsp],
      );

      // Sync with resellers table if column exists
      if (hasChannelPartnerColumns()) {
        await pool.query(
          `UPDATE resellers SET profit_share_percentage = $1 WHERE id = $2`,
          [clampedPsp, resellerIdInt],
        );
      }
    }

    if (req.body.channel_user_count !== undefined) {
      const cuc = Math.max(
        0,
        parseInt(req.body.channel_user_count || 0, 10) || 0,
      );
      await pool
        .query(`UPDATE resellers SET channel_user_count = $1 WHERE id = $2`, [
          cuc,
          id,
        ])
        .catch(() => {});
    }

    const finalAfterResult = await pool.query(
      `SELECT r.id,
              COALESCE(r.security_deposit,0)::numeric AS security_deposit,
              COALESCE(r.otc_charge,0)::numeric AS otc_charge,
              COALESCE(r.real_ip_count,0)::int AS real_ip_count,
              COALESCE(r.real_ip_price,0)::numeric AS real_ip_price,
              COALESCE(r.rate_iig,0)::numeric AS rate_iig,
              COALESCE(r.rate_bdix,0)::numeric AS rate_bdix,
              COALESCE(r.rate_ggc,0)::numeric AS rate_ggc,
              COALESCE(r.rate_fna,0)::numeric AS rate_fna,
              COALESCE(r.rate_cdn,0)::numeric AS rate_cdn,
              COALESCE(r.rate_bcdn,0)::numeric AS rate_bcdn,
              COALESCE(r.rate_nttn,0)::numeric AS rate_nttn,
              COALESCE(cpps.profit_share_percentage, 0)::numeric AS profit_share_percentage
       FROM resellers r
       LEFT JOIN channel_partner_profile_settings cpps ON cpps.reseller_id = r.id
       WHERE r.id = $1`,
      [id],
    );
    const finalAfter = finalAfterResult.rows[0] || after;
    // Compute dynamic financial values (stale columns dropped)
    try {
      const afterVals = await pool.query(
        `SELECT fn_reseller_previous_due($1, $2::date) AS due_before,
                COALESCE((SELECT amount FROM monthly_bills WHERE reseller_id = $1 AND bill_month = $2::date), 0) AS projected_before`,
        [id, `${curYm}-01`],
      );
      finalAfter.current_projected_bill = Number(afterVals.rows[0]?.projected_before || 0);
      finalAfter.previous_month_due = Number(afterVals.rows[0]?.due_before || 0);
    } catch (e) {
      finalAfter.current_projected_bill = 0;
      finalAfter.previous_month_due = 0;
    }

    for (const field of watchedFields) {
      const oldVal = parseAmount(before[field], 0);
      const newVal = parseAmount(finalAfter[field], 0);
      if (oldVal !== newVal) {
        fieldChanges[field] = {
          old: oldVal,
          new: newVal,
          delta: Math.round((newVal - oldVal) * 100) / 100,
        };
      }
    }

    // Sync multiple partners
    if (hasPartnersUpdate) {
      await pool.query(`DELETE FROM reseller_partners WHERE reseller_id = $1`, [id]);
      for (let i = 0; i < req.body.partners.length; i++) {
        const pName = String(req.body.partners[i]?.partner_name || '').trim();
        const pPhone = String(req.body.partners[i]?.contact_no || '').trim();
        if (pName || pPhone) {
          try {
            await pool.query(
              `INSERT INTO reseller_partners (reseller_id, partner_name, contact_no, sort_order) VALUES ($1, $2, $3, $4)`,
              [id, pName, pPhone, i]
            );
          } catch (err) {
            console.warn('updateReseller: reseller_partners insert failed:', err.message);
          }
        }
      }
    }

    if (Object.keys(fieldChanges).length > 0) {
      const actor = getActor(req);
      const reqMeta = getReqMeta(req);
      await logResellerFinancialChange(pool, {
        reseller_id: Number(id),
        ...actor,
        ...reqMeta,
        action_type: "UPDATE_RESELLER_FINANCIAL_FIELDS",
        reference_table: "resellers",
        reference_id: Number(id),
        amount_before: parseAmount(before.current_projected_bill, 0),
        amount_after: parseAmount(finalAfter.current_projected_bill, 0),
        amount_delta:
          parseAmount(finalAfter.current_projected_bill, 0) -
          parseAmount(before.current_projected_bill, 0),
        due_before: parseAmount(before.previous_month_due, 0),
        due_after: parseAmount(finalAfter.previous_month_due, 0),
        due_delta:
          parseAmount(finalAfter.previous_month_due, 0) -
          parseAmount(before.previous_month_due, 0),
        field_changes: fieldChanges,
        note: "Reseller financial fields updated",
        request_payload: req.body || {},
      });
    }

    // Align: sync key fields to onboarding form_data (reseller -> onboarding)
    if (String(req.query.sync_to_onboarding || 'true').toLowerCase() !== 'false') {
      try {
        const syncFields = {};
        if (req.body.name) syncFields.partnerName = String(req.body.name).trim();
        else if (req.body.company_name) syncFields.partnerName = String(req.body.company_name).trim();
        if (req.body.phone) syncFields.contactNumber = String(req.body.phone).trim();
        if (req.body.pop_location || req.body.ip_address) syncFields.address = String(req.body.pop_location || req.body.ip_address).trim();
        if (req.body.partner_type) {
          const nt = normalizePartnerType(req.body.partner_type);
          syncFields.partnerType = nt === 'mac_partner' ? 'mac' : nt === 'channel_partner' ? 'channel' : 'distribution';
        }
        if (Object.keys(syncFields).length) {
          const rows = await pool.query("SELECT id, form_data FROM partner_onboardings WHERE reseller_id=$1", [id]);
          for (const ro of rows.rows) {
            const merged = { ...(ro.form_data || {}), ...syncFields };
            await pool.query(
              "UPDATE partner_onboardings SET partner_name=COALESCE($1, partner_name), contact_number=COALESCE($2, contact_number), address=COALESCE($3, address), partner_type=COALESCE($4, partner_type), form_data=$5::jsonb, updated_at=NOW() WHERE id=$6",
              [syncFields.partnerName || null, syncFields.contactNumber || null, syncFields.address || null, syncFields.partnerType || null, JSON.stringify(merged), ro.id]
            );
          }
        }
      } catch (e) { console.warn('[sync onboarding] warn:', e.message); }
    }

    if (typeof invalidateMonthlySummaryCache === "function") {
      invalidateMonthlySummaryCache();
    }
    res.json({ message: "Updated" });
  } catch (error) {
    console.error("updateReseller:", error);
    res.status(500).json({ message: "Failed to update reseller" });
  }
};

module.exports = {
  updateReseller,
};
