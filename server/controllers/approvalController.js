const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const pool = require('../utilities/db');
const { getCleanDays, getDayName } = require('../utilities/leaveUtils');
const { getAuthSecret } = require('../utilities/authSecret');
const { resolvePermission } = require('../utilities/permissionRegistry');

const buildApprovalPayload = async (requestId) => {
  const query = `
    SELECT lr.*,
           u.full_name, u.employee_id, u.designation, u.department, u.weekly_off,
           lt.name AS type_name,
           adm.full_name AS admin_name, adm.digital_seal
    FROM leave_requests lr
    JOIN users u ON lr.user_id = u.id
    JOIN leave_types lt ON lr.leave_type_id = lt.id
    LEFT JOIN users adm ON lr.approved_by = adm.id
    WHERE lr.id = $1 AND lr.status = 'Approved'
  `;

  const result = await pool.query(query, [requestId]);
  if (result.rows.length === 0) return null;

  const data = result.rows[0];
  const groupQuery = `
    SELECT lr.*, lt.name AS type_name
    FROM leave_requests lr
    JOIN leave_types lt ON lr.leave_type_id = lt.id
    WHERE lr.user_id = $1 AND lr.applied_at = $2 AND lr.status = 'Approved'
    ORDER BY lr.start_date ASC, lr.id ASC
  `;

  const groupResult = await pool.query(groupQuery, [data.user_id, data.applied_at]);
  const leaves = groupResult.rows.length > 0 ? groupResult.rows : [data];
  const userOffDay = data.weekly_off || 'Friday';
  let maxEndForJoining = null;
  let forceNextDayJoin = false;

  const processedLeaves = leaves.map((lv) => {
    const isHalf = parseInt(lv.leave_type_id, 10) === 3;
    const dayCount = isHalf ? 0.5 : getCleanDays(lv.start_date, lv.end_date, userOffDay);
    const endRef = new Date(lv.end_date);
    let requiresNextDay = true;

    if (isHalf && lv.half_day_period === 'Morning') {
      requiresNextDay = false;
    }

    if (!maxEndForJoining || endRef > maxEndForJoining) {
      maxEndForJoining = endRef;
      forceNextDayJoin = requiresNextDay;
    } else if (maxEndForJoining && endRef.getTime() === maxEndForJoining.getTime()) {
      if (requiresNextDay) forceNextDayJoin = true;
    }

    return {
      ...lv,
      day_count: dayCount,
      is_half: isHalf
    };
  });

  let joiningDate = null;
  let joiningTimeDesc = '';

  if (maxEndForJoining) {
    const joiningDayObj = new Date(maxEndForJoining);
    if (!forceNextDayJoin) {
      joiningDate = joiningDayObj;
      joiningTimeDesc = 'Second Half';
    } else {
      joiningDayObj.setDate(joiningDayObj.getDate() + 1);
      let safety = 0;
      while (getDayName(joiningDayObj) === userOffDay && safety < 7) {
        joiningDayObj.setDate(joiningDayObj.getDate() + 1);
        safety += 1;
      }
      joiningDate = joiningDayObj;
      joiningTimeDesc = 'Regular';
    }
  }

  return {
    info: data,
    leaves: processedLeaves,
    joining_info: {
      date: joiningDate,
      desc: joiningTimeDesc
    }
  };
};

const buildPublicApprovalToken = (requestId) => {
  const authSecret = getAuthSecret();
  if (!authSecret) return null;
  return jwt.sign(
    { approval_letter_id: Number(requestId), purpose: 'approval-letter-public' },
    authSecret,
    { expiresIn: '7d' }
  );
};

const fileToDataUri = (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.svg'
      ? 'image/svg+xml'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : 'image/png';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
};

const renderApprovalHtml = (payload) => {
  const { info, leaves, joining_info } = payload;

  // Stored-XSS guard: DB fields (names/designations/departments/leave types)
  // are interpolated into HTML — escape everything user-controlled.
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const formatDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatNumericDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    return d.toLocaleDateString('en-GB');
  };

  const weekdayBn = {
    Saturday: 'শনিবার',
    Sunday: 'রবিবার',
    Monday: 'সোমবার',
    Tuesday: 'মঙ্গলবার',
    Wednesday: 'বুধবার',
    Thursday: 'বৃহস্পতিবার',
    Friday: 'শুক্রবার'
  };

  const logoDataUri = fileToDataUri(path.resolve(__dirname, '../../client/public/logo-b.png'));
  // Seal filename comes from DB — basename + whitelist so ../../ can't escape seals/
  const sealRaw = String(info?.digital_seal || '');
  const sealName = path.basename(sealRaw);
  const sealDataUri = sealRaw && /^[\w-]+\.(png|jpe?g|webp)$/i.test(sealName)
    ? fileToDataUri(path.resolve(__dirname, '../../uploads/seals', sealName))
    : '';

  const rows = leaves.map((lv, idx) => `
    <tr>
      <td style="padding:12px;border:1px solid #ddd;">${idx + 1}</td>
      <td style="padding:12px;border:1px solid #ddd;">${escapeHtml(lv.type_name)}${lv.is_half ? ` (${lv.half_day_period === 'Morning' ? 'প্রথম ভাগ' : 'দ্বিতীয় ভাগ'})` : ''}</td>
      <td style="padding:12px;border:1px solid #ddd;">${lv.is_half ? formatDate(lv.start_date) : `${formatDate(lv.start_date)} - ${formatDate(lv.end_date)}`}</td>
      <td style="padding:12px;border:1px solid #ddd;">${escapeHtml(lv.day_count)} দিন</td>
    </tr>
  `).join('');

  const joiningDateObj = joining_info?.date ? new Date(joining_info.date) : null;
  const joiningWeekDay = joiningDateObj ? weekdayBn[joiningDateObj.toLocaleDateString('en-US', { weekday: 'long' })] || '' : '';
  const joiningSuffix = joining_info?.desc === 'Second Half' ? ' - দিনের দ্বিতীয় ভাগে' : '';
  const isMulti = leaves.length > 1;
  const refCode = `SNKHL/HR/${new Date().getFullYear()}/${String(info.id).padStart(4, '0')}`;

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Approval Letter</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&family=Noto+Sans+Bengali:wght@400;700&display=swap');
      html, body { margin: 0; padding: 0; }
      body { padding: 20px 0; background: #f0f0f0; font-family: 'Hind Siliguri', 'Noto Sans Bengali', Arial, sans-serif; color: #333; }
      .page { width: 210mm; min-height: 297mm; padding: 15mm 20mm; margin: 0 auto; background: #fff; box-shadow: 0 0 10px rgba(0,0,0,0.1); position: relative; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
      .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 350px; opacity: 0.05; z-index: 0; pointer-events: none; }
      .header, .content, .footer, .letter-footer-info { position: relative; z-index: 1; }
      .header { text-align: center; border-bottom: 2px solid #4318ff; padding-bottom: 10px; margin-bottom: 20px; }
      .header-logo { height: 60px; width: auto; object-fit: contain; margin-bottom: 5px; }
      .header h3 { margin: 0; color: #333; font-size: 24px; }
      .header p { margin: 2px 0; color: #666; font-size: 14px; }
      .content { flex: 1; line-height: 1.8; color: #333; font-size: 16px; text-align: justify; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px; }
      .meta strong { font-weight: 700; }
      table { width: 100%; margin: 20px 0; border-collapse: collapse; }
      th, td { text-align: left; vertical-align: top; }
      th { padding: 12px; border: 1px solid #ddd; background: #f9f9f9; }
      .footer { margin-top: auto; padding-top: 30px; padding-bottom: 20px; }
      .signature { float: right; text-align: center; width: 250px; position: relative; }
      .seal { width: 150px; height: auto; position: absolute; bottom: 45px; left: 50%; transform: translateX(-50%); opacity: 0.9; z-index: 1; }
      .sig-content { margin-top: 60px; position: relative; z-index: 2; }
      .sig-content hr { border: 0; border-top: 1px solid #000; margin-bottom: 5px; }
      .letter-footer-info { border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px; text-align: center; font-size: 11px; color: #888; }
      p { margin: 0 0 14px; }
      @page { size: A4; margin: 10mm; }
    </style>
  </head>
  <body>
    <div class="page">
      ${logoDataUri ? `<img class="watermark" src="${logoDataUri}" alt="watermark" />` : ''}
      <div class="header">
        ${logoDataUri ? `<img class="header-logo" src="${logoDataUri}" alt="Logo" />` : ''}
        <h3>স্পিড নেট খুলনা</h3>
        <p>অফিসিয়াল ছুটির অনুমতি পত্র</p>
      </div>
      <div class="content">
        <div class="meta">
          <div>সূত্র: ${escapeHtml(refCode)}</div>
          <div>তারিখ: <strong>${escapeHtml(formatDate(info.action_at))}</strong></div>
        </div>
        <p>বরাবর,<br><strong>${escapeHtml(info.full_name) || '-'}</strong><br>পদবী: ${escapeHtml(info.designation) || '-'}<br>বিভাগ: ${escapeHtml(info.department) || '-'}</p>
        <p style="margin-top:5px;">আপনার আবেদনের প্রেক্ষিতে জানানো যাচ্ছে যে, কর্তৃপক্ষের সিদ্ধান্ত অনুযায়ী আপনার ${isMulti ? 'নিম্নোক্ত একাধিক ছুটির আবেদনসমূহ' : 'নিম্নোক্ত ছুটির আবেদনটি'} অনুমোদিত হয়েছে:</p>
        <table>
          <thead>
            <tr>
              <th style="padding:12px;border:1px solid #ddd;">ক্রমিক</th>
              <th style="padding:12px;border:1px solid #ddd;">ছুটির ধরন</th>
              <th style="padding:12px;border:1px solid #ddd;">তারিখ</th>
              <th style="padding:12px;border:1px solid #ddd;">অনুমোদিত দিন</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p>${isMulti ? 'উপরোক্ত সব ছুটি শেষে আপনাকে' : 'ছুটি শেষে আপনাকে'} আগামী <strong>${escapeHtml(formatNumericDate(joining_info?.date))}</strong> তারিখ <strong>(${escapeHtml(joiningWeekDay)}${escapeHtml(joiningSuffix)})</strong> যথাসময়ে কর্মস্থলে উপস্থিত হওয়ার জন্য অনুরোধ করা হলো।</p>
        <p>ভবিষ্যতে যেকোনো প্রয়োজনে কর্তৃপক্ষের সাথে যোগাযোগ করার পরামর্শ দেওয়া হলো। আপনার সুস্থতা কামনা করছি।</p>
      </div>
      <div class="footer">
        <div class="signature">
          ${sealDataUri ? `<img class="seal" src="${sealDataUri}" alt="Seal" />` : ''}
          <div class="sig-content">
            <hr />
            <strong>${escapeHtml(info.admin_name) || '-'}</strong><br />
            <small>ব্যবস্থাপনা কর্তৃপক্ষ</small><br />
            <small>স্পিড নেট খুলনা</small>
          </div>
        </div>
      </div>
      <div class="letter-footer-info">Speed Net Khulna | Head Office: Notun Bazar, Khulna | Email: info@speednetkhulna.com | Web: www.speednetkhulna.com</div>
    </div>
  </body>
  </html>`;
};

const getApprovalData = async (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const { id: currentUserId, role, role_id } = req.user;
    const roleLower = String(role || '').toLowerCase();
    const payload = await buildApprovalPayload(requestId);
    if (!payload) {
      return res.status(404).json({ message: 'Approval letter not found or not approved.' });
    }

    const data = payload.info;
    // Name-based bypass only applies to legacy users without a role_id — a
    // role_id-linked role needs the actual permission (or all_access) ticked
    // to view someone else's letter.
    const isLegacyAdmin = !role_id && (roleLower === 'admin' || roleLower === 'super admin' || roleLower === 'superadmin');
    const canViewOthers = isLegacyAdmin || resolvePermission(req.user, 'leave.approvals.view');
    if (!canViewOthers && data.user_id !== currentUserId) {
      return res.status(403).json({ message: 'Unauthorized access.' });
    }

    return res.json(payload);
  } catch (error) {
    console.error('Approval Data Error:', error);
    return res.status(500).json({ message: 'Server Error' });
  }
};

const renderPublicApprovalLetter = async (req, res) => {
  try {
    const requestId = parseInt(req.params.id, 10);
    const token = String(req.query.token || '');
    const authSecret = getAuthSecret();
    if (!token || !authSecret) {
      return res.status(403).send('Approval letter link is invalid.');
    }

    const decoded = jwt.verify(token, authSecret, { algorithms: ['HS256'] });
    if (decoded?.purpose !== 'approval-letter-public' || Number(decoded?.approval_letter_id) !== requestId) {
      return res.status(403).send('Approval letter link is invalid.');
    }

    const payload = await buildApprovalPayload(requestId);
    if (!payload) {
      return res.status(404).send('Approval letter not found.');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(renderApprovalHtml(payload));
  } catch (error) {
    console.error('Public approval letter error:', error);
    return res.status(403).send('Approval letter link expired or invalid.');
  }
};

module.exports = {
  getApprovalData,
  renderPublicApprovalLetter,
  buildApprovalPayload,
  buildPublicApprovalToken,
  renderApprovalHtml
};
