const pool = require("../../utilities/db");
const {
  getActor,
  getReqMeta,
  logResellerFinancialChange,
} = require("../../utilities/resellerFinancialAudit");
const { parseAmount } = require("./utils");
const { initialize, initRateChangeLogTable } = require("./dbSetup");
const { refreshProjectedBillForCurrentMonth } = require("./service");

const changeResellerRate = async (req, res) => {
  try {
    await initialize();
    await initRateChangeLogTable();
    const { id } = req.params;

    const {
      effective_date,
      note,
      rate_iig,
      rate_bdix,
      rate_ggc,
      rate_fna,
      rate_cdn,
      rate_bcdn,
      rate_nttn,
    } = req.body;

    if (
      !effective_date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(effective_date))
    ) {
      return res
        .status(400)
        .json({ message: "effective_date (YYYY-MM-DD) is required" });
    }

    const hasAnyRate = [
      rate_iig,
      rate_bdix,
      rate_ggc,
      rate_fna,
      rate_cdn,
      rate_bcdn,
      rate_nttn,
    ].some((v) => v !== undefined && v !== null && v !== "");
    if (!hasAnyRate) {
      return res
        .status(400)
        .json({ message: "At least one rate field is required" });
    }

    const beforeResult = await pool.query(
      `SELECT rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn FROM resellers WHERE id = $1`,
      [id],
    );
    if (!beforeResult.rows.length) {
      return res.status(404).json({ message: "Reseller not found" });
    }
    const before = beforeResult.rows[0];

    const parseR = (v, fallback) =>
      v !== undefined && v !== null && v !== "" ? parseAmount(v, 0) : fallback;

    const newRates = {
      rate_iig: parseR(rate_iig, Number(before.rate_iig || 0)),
      rate_bdix: parseR(rate_bdix, Number(before.rate_bdix || 0)),
      rate_ggc: parseR(rate_ggc, Number(before.rate_ggc || 0)),
      rate_fna: parseR(rate_fna, Number(before.rate_fna || 0)),
      rate_cdn: parseR(rate_cdn, Number(before.rate_cdn || 0)),
      rate_bcdn: parseR(rate_bcdn, Number(before.rate_bcdn || 0)),
      rate_nttn: parseR(rate_nttn, Number(before.rate_nttn || 0)),
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE resellers SET
          rate_iig  = $1,
          rate_bdix = $2,
          rate_ggc  = $3,
          rate_fna  = $4,
          rate_cdn  = $5,
          rate_bcdn = $6,
          rate_nttn = $7,
          last_activity_date = NOW()
         WHERE id = $8`,
        [
          newRates.rate_iig,
          newRates.rate_bdix,
          newRates.rate_ggc,
          newRates.rate_fna,
          newRates.rate_cdn,
          newRates.rate_bcdn,
          newRates.rate_nttn,
          id,
        ],
      );

      const logResult = await client.query(
        `INSERT INTO reseller_rate_change_logs
          (reseller_id, changed_by_id, changed_by, changed_by_role, effective_date, note,
           rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
           prev_rate_iig, prev_rate_bdix, prev_rate_ggc, prev_rate_fna, prev_rate_cdn, prev_rate_bcdn, prev_rate_nttn)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING id`,
        [
          id,
          req.user?.id || null,
          req.user?.full_name || null,
          req.user?.role_name || req.user?.role || null,
          effective_date,
          note || null,
          newRates.rate_iig,
          newRates.rate_bdix,
          newRates.rate_ggc,
          newRates.rate_fna,
          newRates.rate_cdn,
          newRates.rate_bcdn,
          newRates.rate_nttn,
          Number(before.rate_iig || 0),
          Number(before.rate_bdix || 0),
          Number(before.rate_ggc || 0),
          Number(before.rate_fna || 0),
          Number(before.rate_cdn || 0),
          Number(before.rate_bcdn || 0),
          Number(before.rate_nttn || 0),
        ],
      );

      const bwTypeMap = {
        IIG: newRates.rate_iig,
        BDIX: newRates.rate_bdix,
        GGC: newRates.rate_ggc,
        FNA: newRates.rate_fna,
        CDN: newRates.rate_cdn,
        BCDN: newRates.rate_bcdn,
        NTTN: newRates.rate_nttn,
      };
      for (const [bwType, newRate] of Object.entries(bwTypeMap)) {
        const prevRate = Number(before[`rate_${bwType.toLowerCase()}`] || 0);
        if (newRate !== prevRate) {
          await client.query(
            `DELETE FROM reseller_rate_history WHERE reseller_id=$1 AND bw_type=$2 AND effective_date=$3::date`,
            [id, bwType, effective_date],
          );
          await client.query(
            `INSERT INTO reseller_rate_history (reseller_id, bw_type, rate, effective_date) VALUES ($1, $2, $3, $4::date)`,
            [id, bwType, newRate, effective_date],
          );
        }
      }

      const actor = getActor(req);
      const meta = getReqMeta(req);
      const fieldChanges = {};
      [
        "rate_iig",
        "rate_bdix",
        "rate_ggc",
        "rate_fna",
        "rate_cdn",
        "rate_bcdn",
        "rate_nttn",
      ].forEach((k) => {
        const prev = Number(before[k] || 0);
        const next = newRates[k];
        if (prev !== next) fieldChanges[k] = { before: prev, after: next };
      });

      await logResellerFinancialChange(client, {
        reseller_id: id,
        ...actor,
        action_type: "RATE_CHANGE",
        reference_table: "reseller_rate_change_logs",
        reference_id: logResult.rows[0].id,
        field_changes: fieldChanges,
        note: `Rate change effective ${effective_date}${note ? `: ${note}` : ""}`,
        request_payload: req.body,
        ...meta,
      });

      await client.query("COMMIT");

      let newProjectedBill = null;
      try {
        newProjectedBill = await refreshProjectedBillForCurrentMonth(id);
      } catch (_) {
        /* best-effort */
      }

      res.json({
        success: true,
        log_id: logResult.rows[0].id,
        new_projected_bill: newProjectedBill,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("changeResellerRate:", error);
    res.status(500).json({ message: "Failed to save rate change" });
  }
};

const getResellerRateChangeLogs = async (req, res) => {
  try {
    await initRateChangeLogTable();
    const { id } = req.params;
    const limit = Math.min(Number(req.query.limit || 20), 100);

    const result = await pool.query(
      `SELECT id, reseller_id, changed_by, changed_by_role, effective_date, note,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              prev_rate_iig, prev_rate_bdix, prev_rate_ggc, prev_rate_fna, prev_rate_cdn, prev_rate_bcdn, prev_rate_nttn,
              created_at
       FROM reseller_rate_change_logs
       WHERE reseller_id = $1
       ORDER BY effective_date DESC, created_at DESC
       LIMIT $2`,
      [id, limit],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("getResellerRateChangeLogs:", error);
    res.status(500).json({ message: "Failed to load rate change logs" });
  }
};

module.exports = {
  changeResellerRate,
  getResellerRateChangeLogs,
};
