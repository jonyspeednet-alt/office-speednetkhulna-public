const pool = require("../../utilities/db");
const {
  getActor,
  getReqMeta,
  logResellerFinancialChange,
} = require("../../utilities/resellerFinancialAudit");
const {
  normalizeChangeType,
  normalizeBwType,
  normalizeBillBwType,
  parseAmount,
  getDhakaMonthYm,
} = require("./utils");
const { initialize } = require("./dbSetup");
const { refreshProjectedBillForCurrentMonth, calculateResellerMonthProjectedTotal } = require("./service");

const createBandwidthRequest = async (req, res) => {
  try {
    await initialize();

    const resellerId = Number(req.body?.reseller_id || 0);
    if (!resellerId) {
      return res.status(400).json({ message: "reseller_id is required" });
    }

    const effectiveDate = req.body?.effective_date || null;
    if (effectiveDate) {
      const eff = new Date(effectiveDate);
      if (isNaN(eff.getTime()) || eff < new Date('2000-01-01') || eff > new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)) {
        return res.status(400).json({ message: "Invalid effective_date" });
      }
    }
    const adminNote =
      String(req.body?.admin_note || req.body?.reason || "").trim() || null;
    const requestedBy = req.user?.id || null;

    const rawBwData = req.body?.bw_data;
    const requests = [];
    // Bulk cap: each object key becomes one INSERT (write amplification)
    const MAX_BW_KEYS = 20;

    if (rawBwData && typeof rawBwData === "object") {
      const keys = Object.keys(rawBwData).slice(0, MAX_BW_KEYS);
      for (const bwType of keys) {
        // Strict type: unknown keys previously stored verbatim (typo credits
        // the wrong column downstream) — normalize-or-skip instead.
        const canonType = normalizeBillBwType(bwType);
        if (!canonType) continue;
        const data = rawBwData[bwType];
        const row = data && typeof data === "object" ? data : {};
        const action = normalizeChangeType(
          row.action || row.change_type || row.type || row.mode,
        );
        const amountRaw =
          row.amount ??
          row.requested_bw_mbps ??
          row.requested_bw ??
          row.qty ??
          row.value;
        // Upper bound: Math.max blocks negatives but 1e12 Mbps stored verbatim
        const amount = Math.min(100000, Math.max(0, Math.round(parseAmount(amountRaw, 0))));
        if ((action === "increase" || action === "decrease") && amount > 0) {
          requests.push({ bw_type: canonType, change_type: action, amount });
        }
      }
    }

    if (!requests.length) {
      const singleAmount = Math.min(
        100000,
        Math.max(
          0,
          Math.round(parseAmount(req.body?.requested_bw_mbps, 0)),
        ),
      );
      const singleAction = normalizeChangeType(
        req.body?.change_type || req.body?.action || "increase",
      );
      const singleType = normalizeBillBwType(String(req.body?.bw_type || "IIG").trim()) || "IIG";
      if (
        singleAmount > 0 &&
        (singleAction === "increase" || singleAction === "decrease")
      ) {
        requests.push({
          bw_type: singleType,
          change_type: singleAction,
          amount: singleAmount,
        });
      }
    }

    if (!requests.length) {
      return res.status(400).json({ message: "No valid request found" });
    }

    const inserted = [];
    for (const reqRow of requests) {
      const insEffectiveDate = effectiveDate || new Date().toISOString().slice(0, 10);
      const result = await pool.query(
        `INSERT INTO bandwidth_requests (
          reseller_id, bw_type, change_type, amount, requested_effective_date, requested_by, reseller_note,
          admin_note, admin_status, engineer_status, created_at
        ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,'pending','pending',NOW())
         RETURNING *`,
        [
          resellerId,
          reqRow.bw_type,
          reqRow.change_type,
          reqRow.amount,
          insEffectiveDate,
          requestedBy,
          adminNote,
          adminNote,
        ],
      );
      inserted.push(result.rows[0]);
    }

    res.status(201).json({
      message: "Requests submitted",
      count: inserted.length,
      requests: inserted,
    });
  } catch (error) {
    console.error("createBandwidthRequest:", error);
    res.status(500).json({ message: "Failed to submit bandwidth request" });
  }
};

const listBandwidthRequests = async (req, res) => {
  try {
    await initialize();
    const status = (req.query.status || "").toLowerCase();
    const params = [];
    let where = "";

    if (status === "pending") {
      where = "WHERE COALESCE(br.admin_status,'pending') = 'pending'";
    } else if (status === "approved") {
      where = "WHERE COALESCE(br.admin_status,'pending') = 'approved'";
    } else if (status === "rejected") {
      where = "WHERE COALESCE(br.admin_status,'pending') = 'rejected'";
    }

    const result = await pool.query(
      `SELECT
        br.id,
        br.reseller_id,
        r.user_id AS reseller_code,
        COALESCE(r.reseller_name, r.company_name) AS reseller_name,
        COALESCE(r.company_name, '') AS company_name,
        COALESCE(r.pop_location, '') AS pop_location,
        COALESCE(r.rate_iig,0)::numeric AS rate_iig,
        COALESCE(r.rate_bdix,0)::numeric AS rate_bdix,
        COALESCE(r.rate_ggc,0)::numeric AS rate_ggc,
        COALESCE(r.rate_fna,0)::numeric AS rate_fna,
        COALESCE(r.rate_cdn,0)::numeric AS rate_cdn,
        COALESCE(r.rate_bcdn,0)::numeric AS rate_bcdn,
        COALESCE(r.rate_nttn,0)::numeric AS rate_nttn,
        br.bw_type,
        br.change_type,
        br.amount AS requested_bw_mbps,
        br.requested_effective_date,
        NULL::numeric AS requested_rate,
        br.reseller_note AS reason,
        COALESCE(br.engineer_status, br.admin_status, 'pending') AS status,
        br.admin_status,
        br.engineer_status,
        br.created_at,
        br.implementation_date AS applied_at
       FROM bandwidth_requests br
       JOIN resellers r ON r.id = br.reseller_id
       ${where}
       ORDER BY br.created_at DESC, br.id DESC
       LIMIT $${params.length + 1}`,
      [...params, Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200))],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("listBandwidthRequests:", error);
    res.status(500).json({ message: "Failed to load requests" });
  }
};

const reviewBandwidthRequest = async (req, res) => {
  try {
    await initialize();
    const { id } = req.params;
    const status = (req.body.status || "").toLowerCase();
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be approved, rejected, or pending" });
    }

    const existingResult = await pool.query(
      `SELECT * FROM bandwidth_requests WHERE id = $1`,
      [id],
    );

    if (!existingResult.rows.length) {
      return res.status(404).json({ message: "Request not found" });
    }

    const existing = existingResult.rows[0];
    const currentAdminStatus = String(
      existing.admin_status || "pending",
    ).toLowerCase();
    const currentEngineerStatus = String(
      existing.engineer_status || "pending",
    ).toLowerCase();

    if (status === "pending") {
      if (currentAdminStatus !== "rejected") {
        return res
          .status(400)
          .json({
            message: "Only rejected requests can be restored to pending",
          });
      }
      if (currentEngineerStatus === "implemented") {
        return res
          .status(400)
          .json({
            message: "Implemented requests cannot be restored to pending",
          });
      }
    }

    const nextEngineerStatus =
      status === "pending" ? "pending" : currentEngineerStatus;
    const nextAdminNote = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "note",
    )
      ? req.body.note || null
      : existing.admin_note;

    const result = await pool.query(
      `UPDATE bandwidth_requests
       SET admin_status = $1,
           engineer_status = $2,
           admin_note = $3
       WHERE id = $4
       RETURNING *`,
      [status, nextEngineerStatus, nextAdminNote, id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("reviewBandwidthRequest:", error);
    res.status(500).json({ message: "Failed to review request" });
  }
};

const applyApprovedRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    await initialize();
    const { id } = req.params;
    await client.query("BEGIN");

    const reqResult = await client.query(
      "SELECT * FROM bandwidth_requests WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!reqResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Request not found" });
    }

    const bwReq = reqResult.rows[0];
    if ((bwReq.admin_status || "pending") !== "approved") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Only approved request can be applied" });
    }

    if ((bwReq.engineer_status || "pending") === "implemented") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Request has already been implemented" });
    }

    const bwCol = normalizeBwType(bwReq.bw_type);
    const factor =
      String(bwReq.change_type || "").toLowerCase() === "decrease" ? -1 : 1;
    const delta = factor * Math.abs(parseAmount(bwReq.amount, 0));

    // Lock row and capture pre-change state
    const resRow = await client.query(
      `SELECT * FROM resellers WHERE id = $1 FOR UPDATE`,
      [bwReq.reseller_id],
    );
    const resellerData = resRow.rows[0];
    const curYm = getDhakaMonthYm();
    const dueBeforeQ = await client.query(
      `SELECT fn_reseller_previous_due($1, $2::date) AS due_before`,
      [bwReq.reseller_id, `${curYm}-01`],
    );
    const dueBefore = parseAmount(dueBeforeQ.rows[0]?.due_before, 0);
    const projectedBefore = calculateResellerMonthProjectedTotal(resellerData || {}, curYm);

    const updateSql = `UPDATE resellers SET ${bwCol} = GREATEST(0, COALESCE(${bwCol},0) + $1), last_activity_date = NOW() WHERE id = $2 RETURNING *`;
    const updatedReseller = await client.query(updateSql, [
      delta,
      bwReq.reseller_id,
    ]);

    const implDate = bwReq.requested_effective_date
      ? new Date(bwReq.requested_effective_date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    await client.query(
      `UPDATE bandwidth_requests
       SET engineer_status = 'implemented', implementation_date = $1::date, tech_note = COALESCE($2, tech_note)
       WHERE id = $3`,
      [implDate, req.body?.note || null, id],
    );

    await client.query(
      `INSERT INTO billing_logs (reseller_id, request_id, change_desc, transaction_amount, effective_date, created_at, log_type)
       VALUES ($1, $2, $3, 0, $4::date, NOW(), 'bandwidth_change')`,
      [
        bwReq.reseller_id,
        bwReq.id,
        `Applied ${bwReq.change_type || "increase"} ${bwReq.amount} on ${bwReq.bw_type || "iig_bw"}`,
        implDate,
      ],
    );

    await client.query("COMMIT");

    let projectedBill = null;
    try {
      projectedBill = await refreshProjectedBillForCurrentMonth(
        bwReq.reseller_id,
      );
    } catch (e) {
      console.warn("refreshProjectedBillForCurrentMonth warning:", e.message);
    }

    try {
      const actor = getActor(req);
      const reqMeta = getReqMeta(req);
      await logResellerFinancialChange(pool, {
        reseller_id: Number(bwReq.reseller_id),
        ...actor,
        ...reqMeta,
        action_type: "APPLY_BW_REQUEST_FINANCIAL_IMPACT",
        reference_table: "bandwidth_requests",
        reference_id: Number(bwReq.id),
        amount_before: projectedBefore,
        amount_after: parseAmount(projectedBill, projectedBefore),
        amount_delta:
          parseAmount(projectedBill, projectedBefore) - projectedBefore,
        due_before: dueBefore,
        due_after: dueBefore,
        due_delta: 0,
        field_changes: {
          bw_type: bwReq.bw_type,
          change_type: bwReq.change_type,
          amount: parseAmount(bwReq.amount, 0),
          bw_delta: delta,
        },
        note: `Applied ${bwReq.change_type} ${bwReq.amount} ${bwReq.bw_type}`,
        request_payload: req.body || {},
      });
    } catch (auditErr) {
      console.warn("applyApprovedRequest audit warning:", auditErr.message);
    }

    res.json({
      message: "Request applied successfully",
      reseller: updatedReseller.rows[0],
      projected_bill: projectedBill,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("applyApprovedRequest:", error);
    res.status(500).json({ message: "Failed to apply request" });
  } finally {
    client.release();
  }
};

module.exports = {
  createBandwidthRequest,
  listBandwidthRequests,
  reviewBandwidthRequest,
  applyApprovedRequest,
};
