// controllers/partner/requestController.js — reseller bandwidth requests
// Replaces request_new.php / request_edit.php / history.php. A reseller can
// only create requests (admin_status/engineer_status = 'pending') and edit
// them while both are still 'pending'. Office admins approve/implement.
const pool = require("../../utilities/db");
const { normalizeChangeType, parseAmount } = require("../reseller/utils");

// Bandwidth labels the portal exposes (stored verbatim in bandwidth_requests.bw_type)
const BW_LABELS = ["IIG", "BDIX", "GGC", "FNA", "CDN", "Other", "NTTN"];

const todayPlusDaysStr = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// Accepts either an array [{bw_type, action|change_type, amount}] or a
// map { IIG: {action, amount}, ... } (legacy PHP form shape).
const collectRequests = (body) => {
  const out = [];
  const raw = body?.requests;
  const push = (bwType, action, amountRaw) => {
    const change_type = normalizeChangeType(action);
    const amount = Math.max(0, Math.round(parseAmount(amountRaw, 0)));
    if ((change_type === "increase" || change_type === "decrease") && amount > 0) {
      out.push({ bw_type: String(bwType).trim(), change_type, amount });
    }
  };
  if (Array.isArray(raw)) {
    for (const r of raw) push(r.bw_type, r.action || r.change_type, r.amount);
  } else if (raw && typeof raw === "object") {
    for (const [bwType, data] of Object.entries(raw)) {
      const d = data && typeof data === "object" ? data : {};
      push(bwType, d.action || d.change_type, d.amount);
    }
  }
  return out;
};

/** GET /api/partner/requests */
const listRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, bw_type, change_type, amount, requested_effective_date,
              reseller_note, admin_status, engineer_status, implementation_date, created_at
       FROM bandwidth_requests
       WHERE reseller_id = $1
       ORDER BY created_at DESC, id DESC`,
      [req.reseller.id],
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error("partner listRequests error:", error);
    res.status(500).json({ message: "Failed to load requests" });
  }
};

/** POST /api/partner/requests */
const createRequest = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const effectiveDate = String(req.body?.effective_date || "").trim();
    const note = String(req.body?.reseller_note || "").trim() || null;
    const requests = collectRequests(req.body);

    if (!requests.length) {
      return res
        .status(400)
        .json({ message: "কোনো ভ্যালিড রিকোয়েস্ট পাওয়া যায়নি।" });
    }
    if (!effectiveDate) {
      return res
        .status(400)
        .json({ message: "কার্যকর হওয়ার তারিখ প্রয়োজন।" });
    }

    // 30-day notice for downgrades
    const hasDowngrade = requests.some((r) => r.change_type === "decrease");
    if (hasDowngrade && effectiveDate < todayPlusDaysStr(30)) {
      return res.status(400).json({
        message:
          "দুঃখিত, ডাউনগ্রেড রিকোয়েস্টের জন্য কমপক্ষে ৩০ দিন নোটিশ পিরিয়ড প্রয়োজন।",
      });
    }

    const inserted = [];
    for (const r of requests) {
      const result = await pool.query(
        `INSERT INTO bandwidth_requests
           (reseller_id, bw_type, change_type, amount, requested_effective_date,
            reseller_note, admin_status, engineer_status, created_at)
         VALUES ($1,$2,$3,$4,$5::date,$6,'pending','pending',NOW())
         RETURNING id`,
        [resellerId, r.bw_type, r.change_type, r.amount, effectiveDate, note],
      );
      inserted.push(result.rows[0].id);
    }

    res.status(201).json({
      message: `মোট ${inserted.length} টি রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে।`,
      count: inserted.length,
    });
  } catch (error) {
    console.error("partner createRequest error:", error);
    res.status(500).json({ message: "রিকোয়েস্ট পাঠাতে সমস্যা হয়েছে।" });
  }
};

/** PUT /api/partner/requests/:id — editable only while fully pending */
const updateRequest = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid request id" });

    const existingRes = await pool.query(
      `SELECT * FROM bandwidth_requests WHERE id = $1 AND reseller_id = $2`,
      [id, resellerId],
    );
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ message: "Request not found" });

    const adminPending =
      String(existing.admin_status || "pending").toLowerCase() === "pending";
    const engPending =
      String(existing.engineer_status || "pending").toLowerCase() === "pending";
    if (!adminPending || !engPending) {
      return res.status(400).json({
        message: "এই রিকোয়েস্টটি আর সম্পাদনা করা যাবে না (প্রসেসিং শুরু হয়েছে)।",
      });
    }

    const bwType = String(req.body?.bw_type || existing.bw_type).trim();
    const changeType =
      normalizeChangeType(req.body?.change_type || req.body?.action) ||
      existing.change_type;
    const amount = Math.max(0, Math.round(parseAmount(req.body?.amount, existing.amount)));
    const effectiveDate =
      String(req.body?.effective_date || "").trim() ||
      (existing.requested_effective_date
        ? new Date(existing.requested_effective_date).toISOString().slice(0, 10)
        : null);
    const note = Object.prototype.hasOwnProperty.call(req.body || {}, "reseller_note")
      ? String(req.body.reseller_note || "").trim() || null
      : existing.reseller_note;

    if (changeType === "decrease" && effectiveDate && effectiveDate < todayPlusDaysStr(30)) {
      return res.status(400).json({
        message:
          "দুঃখিত, ডাউনগ্রেড রিকোয়েস্টের জন্য কমপক্ষে ৩০ দিন নোটিশ পিরিয়ড প্রয়োজন।",
      });
    }

    await pool.query(
      `UPDATE bandwidth_requests
       SET bw_type = $1, change_type = $2, amount = $3,
           requested_effective_date = $4::date, reseller_note = $5, created_at = NOW()
       WHERE id = $6 AND reseller_id = $7`,
      [bwType, changeType, amount, effectiveDate, note, id, resellerId],
    );

    res.json({ message: "রিকোয়েস্ট সফলভাবে আপডেট করা হয়েছে।" });
  } catch (error) {
    console.error("partner updateRequest error:", error);
    res.status(500).json({ message: "রিকোয়েস্ট আপডেট করতে সমস্যা হয়েছে।" });
  }
};

module.exports = { listRequests, createRequest, updateRequest, BW_LABELS };
