// controllers/partner/settingsController.js — reseller profile settings
// Replaces settings.php: profile image upload (resized like the old GD code)
// and password change (bcrypt, min 6 chars).
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { IMAGE_DECODE_OPTIONS, IMAGE_DECODE_TIMEOUT_SECONDS } = require("../../middleware/uploadMiddleware");
const bcrypt = require("bcrypt");
const pool = require("../../utilities/db");

const BCRYPT_RE = /^\$2[aby]\$/;
const UPLOAD_DIR = path.join(__dirname, "../../uploads/partner");
// Served via the API (Apache only proxies /api/* to Node), scoped to the
// logged-in reseller by requirePartner + filename ownership check.
const WEB_PREFIX = "/api/partner/avatar";

/** POST /api/partner/settings/password */
const changePassword = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const current = String(req.body?.current_password ?? "");
    const next = String(req.body?.new_password ?? "");
    const confirm = String(req.body?.confirm_password ?? "");

    if (!current || !next) {
      return res
        .status(400)
        .json({ message: "বর্তমান ও নতুন পাসওয়ার্ড প্রয়োজন।" });
    }
    if (next !== confirm) {
      return res.status(400).json({
        message: "নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।",
      });
    }
    if (next.length < 8) {
      return res
        .status(400)
        .json({ message: "পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।" });
    }
    if (next === current) {
      return res
        .status(400)
        .json({ message: "নতুন পাসওয়ার্ড বর্তমান পাসওয়ার্ড থেকে আলাদা হতে হবে।" });
    }
    // Never allow phone/user_id as password (cheapest takeover).
    const ownIds = [req.reseller?.contact_no, req.reseller?.user_id]
      .map((v) => String(v || "").trim()).filter(Boolean);
    if (ownIds.includes(next.trim())) {
      return res
        .status(400)
        .json({ message: "ফোন নম্বর বা ইউজার আইডি পাসওয়ার্ড হিসেবে ব্যবহার করা যাবে না।" });
    }

    const stored = String(req.reseller.password ?? "").trim();
    let ok = false;
    if (stored !== "" && BCRYPT_RE.test(stored)) {
      try {
        ok = await bcrypt.compare(current, stored);
      } catch (_) {
        ok = false;
      }
    }
    // Password verification requires bcrypt in every authentication workflow.
    if (!ok) {
      return res
        .status(401)
        .json({ message: "বর্তমান পাসওয়ার্ড সঠিক নয়।" });
    }

    const hash = await bcrypt.hash(next, 10);
    await pool.query(`UPDATE resellers SET password = $1, must_change_password = FALSE, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2`, [
      hash,
      resellerId,
    ]);
    res.json({ message: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।" });
  } catch (error) {
    console.error("partner changePassword error:", error);
    res.status(500).json({ message: "পাসওয়ার্ড পরিবর্তনে সমস্যা হয়েছে।" });
  }
};

/** POST /api/partner/settings/profile-image (multipart: profile_image) */
const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "কোনো ফাইল পাওয়া যায়নি।" });
    }
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const resellerId = req.reseller.id;
    const filename = `reseller_${resellerId}_${Date.now()}.webp`;
    const outPath = path.join(UPLOAD_DIR, filename);

    await sharp(req.file.buffer, IMAGE_DECODE_OPTIONS)
      .timeout({ seconds: IMAGE_DECODE_TIMEOUT_SECONDS })
      .resize(300, 300, { fit: "inside", withoutEnlargement: true })
      .toFormat("webp", { quality: 80 })
      .toFile(outPath);

    const webPath = `${WEB_PREFIX}/${filename}`;
    await pool.query(`UPDATE resellers SET profile_image = $1 WHERE id = $2`, [
      webPath,
      resellerId,
    ]);

    res.json({
      message: "প্রোফাইল ছবি সফলভাবে আপডেট করা হয়েছে।",
      profile_image: webPath,
    });
  } catch (error) {
    console.error("partner uploadProfileImage error:", error);
    res.status(500).json({ message: "ছবি আপলোডে সমস্যা হয়েছে।" });
  }
};

/** GET /api/partner/avatar/:file — stream the reseller's own avatar */
const serveAvatar = (req, res) => {
  try {
    const file = path.basename(String(req.params.file || ""));
    // Only allow this reseller's own files: reseller_<id>_*.webp
    if (!/^reseller_\d+_\d+\.webp$/.test(file) || !file.startsWith(`reseller_${req.reseller.id}_`)) {
      return res.status(404).end();
    }
    const full = path.join(UPLOAD_DIR, file);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.type("image/webp");
    fs.createReadStream(full).pipe(res);
  } catch (error) {
    console.error("partner serveAvatar error:", error);
    res.status(500).end();
  }
};

module.exports = { changePassword, uploadProfileImage, serveAvatar };
