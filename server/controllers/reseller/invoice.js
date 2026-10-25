const pool = require("../../utilities/db");
const nodemailer = require("nodemailer");
const { normalizeMailbox } = require("../../utilities/mailAddress");
const { getDhakaMonthYm, parseBillDetailsSnapshot, parseYMD, LOG_TYPE_EXPR } = require("./utils");
const { initialize, joiningDateExpr, hasResellerOtcAppliedMonthColumn } = require("./dbSetup");
const { calculateMonthlyBillBreakdown } = require("./service");

// Escape for HTML email bodies — reseller names are user-controlled (stored-XSS guard)
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const getInvoice = async (req, res) => {
    try {
        await initialize();
        const { resellerId } = req.params;
        const monthParam = String(req.query.month || "").slice(0, 7) || getDhakaMonthYm();
        const fromDay = parseInt(req.query.from_day, 10) || undefined;
        const toDay = parseInt(req.query.to_day, 10) || undefined;

        const resellerResult = await pool.query(
            `SELECT
        id,
        user_id AS reseller_code,
        COALESCE(reseller_name, company_name) AS name,
        reseller_name,
        company_name,
        contact_no AS phone,
        pop_location,
        fn_reseller_previous_due(id, $2::date) AS due_amount,
        0::numeric AS projected_bill,
        COALESCE(iig_bw,0)::numeric AS iig_bw,
        COALESCE(bdix_bw,0)::numeric AS bdix_bw,
        COALESCE(ggc_bw,0)::numeric AS ggc_bw,
        COALESCE(fna_bw,0)::numeric AS fna_bw,
        COALESCE(cdn_bw,0)::numeric AS cdn_bw,
        COALESCE(bcdn_bw,0)::numeric AS bcdn_bw,
        COALESCE(nttn_capacity,0)::numeric AS nttn_capacity,
        COALESCE(rate_iig,0)::numeric AS rate_iig,
        COALESCE(rate_bdix,0)::numeric AS rate_bdix,
        COALESCE(rate_ggc,0)::numeric AS rate_ggc,
        COALESCE(rate_fna,0)::numeric AS rate_fna,
        COALESCE(rate_cdn,0)::numeric AS rate_cdn,
        COALESCE(rate_bcdn,0)::numeric AS rate_bcdn,
        COALESCE(rate_nttn,0)::numeric AS rate_nttn,
        COALESCE(otc_charge,0)::numeric AS otc_charge,
        ${hasResellerOtcAppliedMonthColumn() ? `otc_charge_applied_month,` : `NULL::date AS otc_charge_applied_month,`}
        COALESCE(real_ip_count,0)::int AS real_ip_count,
        COALESCE(real_ip_price,0)::numeric AS real_ip_price,
        COALESCE(status, 'active') AS status,
        created_at,
        ${joiningDateExpr()} AS joining_date
       FROM resellers WHERE id = $1`,
            [resellerId, `${monthParam}-01`],
        );

        if (!resellerResult.rows.length) {
            return res.status(404).json({ message: "Reseller not found" });
        }

        const reseller = resellerResult.rows[0];
        const created = parseYMD(reseller.joining_date || reseller.created_at);
        const createdYM = created ? `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}` : monthParam;
        const effectiveYM = monthParam < createdYM ? createdYM : monthParam;
        const monthStart = `${effectiveYM}-01`;

        const billResult = await pool.query(
            `SELECT id, reseller_id, bill_month,
              amount AS final_amount, adjustment, adjustment_note,
              bill_details, previous_due, created_at
       FROM monthly_bills
       WHERE reseller_id = $1 AND bill_month = $2::date`,
            [resellerId, monthStart],
        );

        const logTypeExpr = LOG_TYPE_EXPR();
        const paidResult = await pool.query(
            `SELECT
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'payment'),0)::numeric AS total_paid,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'discount'),0)::numeric AS total_discount,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product','product_charge','charge')),0)::numeric AS total_product_charges
        FROM billing_logs
        WHERE reseller_id = $1
          AND TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') = $2
          AND ${logTypeExpr} IN ('payment','discount','product','product_charge','charge')`,
            [resellerId, effectiveYM],
        );

        const logResult = await pool.query(
            `SELECT id, reseller_id, log_type, change_desc AS note,
              transaction_amount AS amount, effective_date, created_at
       FROM billing_logs
       WHERE reseller_id = $1
         AND DATE_TRUNC('month', COALESCE(effective_date, created_at)) = DATE_TRUNC('month', $2::date)
       ORDER BY effective_date ASC`,
            [resellerId, monthStart],
        );

        const bill = billResult.rows[0] || null;

        // When the bill is not finalized, calculate previous_due dynamically
        // instead of using the stale resellers.previous_month_due value
        // (which is only updated on manual reseller edit, not on finalization)
        if (!bill) {
            // Use carry-forward approach matching finalizeResellerBill logic:
            // start with the last finalized bill's closing balance, then add/subtract
            // product charges and payments recorded since then.
            const logTypeExpr = LOG_TYPE_EXPR();

            const priorBill = await pool.query(
                `SELECT previous_due, amount, adjustment, bill_month
                 FROM monthly_bills
                 WHERE reseller_id = $1 AND bill_month < $2::date
                 ORDER BY bill_month DESC LIMIT 1`,
                [resellerId, monthStart]
            );

            if (priorBill.rows.length > 0) {
                const pb = priorBill.rows[0];
                const priorClosing = Number(pb.previous_due) + Number(pb.amount) + Number(pb.adjustment);

                const afterResult = await pool.query(
                    `SELECT
                        COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment', 'discount')), 0) AS total_paid,
                        COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0) AS total_product
                     FROM billing_logs
                     WHERE reseller_id = $1
                       AND COALESCE(effective_date, created_at) >= $2::date
                       AND COALESCE(effective_date, created_at) < $3::date`,
                    [resellerId, pb.bill_month, monthStart]
                );

                const extraPayments  = Number(afterResult.rows[0]?.total_paid    || 0);
                const extraProduct   = Number(afterResult.rows[0]?.total_product || 0);
                reseller.due_amount = Math.round((priorClosing + extraProduct - extraPayments) * 100) / 100;
            } else {
                // First unfinalized month — use cached opening balance plus ledger
                const openingResult = await pool.query(
                    `SELECT
                        COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment', 'discount')), 0) AS total_paid,
                        COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0) AS total_product
                     FROM billing_logs
                     WHERE reseller_id = $1
                       AND COALESCE(effective_date, created_at) < $2::date`,
                    [resellerId, monthStart]
                );
                const openingPaid    = Number(openingResult.rows[0]?.total_paid    || 0);
                const openingProduct = Number(openingResult.rows[0]?.total_product || 0);
                const openingBalance = Number(reseller.due_amount || 0);
                reseller.due_amount = Math.round((openingBalance + openingProduct - openingPaid) * 100) / 100;
            }
        }

        let items = [];
        let itemSource = "calculated_fallback";
        // NOTE: recurring billing-rule discounts/adjustments live ONLY in the
        // items[] snapshot below (written by calculateMonthlyBillBreakdown).
        // Rules must never create billing_logs rows — the aggregates above
        // would double-count them (plan §3, risk #1).
        if (bill) {
            const snapshot = parseBillDetailsSnapshot(bill.bill_details, `bill_id=${bill.id}`);
            if (snapshot.valid) {
                items = snapshot.items;
                itemSource = "snapshot";
            } else {
                const recalculated = await calculateMonthlyBillBreakdown(resellerId, effectiveYM, reseller, { fromDay, toDay });
                items = recalculated.items || [];
            }
        } else {
            const recalculated = await calculateMonthlyBillBreakdown(resellerId, effectiveYM, reseller, { fromDay, toDay });
            items = recalculated.items || [];
        }

        const payments = (logResult.rows || []).filter(r => {
            const t = String(r.log_type || '').toLowerCase();
            if (t === 'payment') return true;
            // Legacy records: log_type not set, positive amount, not a charge type
            if (!t && Number(r.amount) > 0) return true;
            return false;
        });

        const discounts = (logResult.rows || []).filter(r => {
            const t = String(r.log_type || '').toLowerCase();
            return t === 'discount' || (String(r.note || '').toLowerCase().startsWith('discount:'));
        });

        // Retroactive correction audit log entries for this billing month
        let retroactiveCorrections = [];
        try {
            const retroResult = await pool.query(
                `SELECT id, action_type, created_at, actor_user_name, actor_role,
                        note, field_changes, amount_before, amount_after, amount_delta
                 FROM reseller_financial_audit_logs
                 WHERE reseller_id = $1
                   AND action_type IN ('RETROACTIVE_CORRECTION', 'RETROACTIVE_CORRECTION_SUMMARY')
                   AND (
                     -- Per-bill entries: filter by the bill month recorded in field_changes
                     (action_type = 'RETROACTIVE_CORRECTION'
                       AND field_changes->>'affected_month' = $2)
                     OR
                     -- Summary entries: filter by the calendar month the correction was applied
                     (action_type = 'RETROACTIVE_CORRECTION_SUMMARY'
                       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $3::date))
                   )
                 ORDER BY created_at ASC`,
                [resellerId, effectiveYM, monthStart]
            );
            retroactiveCorrections = retroResult.rows || [];
        } catch (_) { /* optional table may not exist */ }


        res.json({
            reseller,
            month: monthStart,
            bill,
            items,
            total_paid: parseFloat(paidResult.rows[0]?.total_paid || 0),
            total_discount: parseFloat(paidResult.rows[0]?.total_discount || 0),
            total_product_charges: parseFloat(paidResult.rows[0]?.total_product_charges || 0),
            payments,
            discounts,
            logs: logResult.rows,
            retroactive_corrections: retroactiveCorrections,
            meta: { item_source: itemSource },
            billing_period: fromDay || toDay ? {
                from_day: fromDay || null,
                to_day: toDay || null,
            } : undefined,
        });
    } catch (error) {
        console.error("getInvoice:", error);
        res.status(500).json({ message: "Failed to load invoice" });
    }
};

const getInvoiceByBillId = async (req, res) => {
    try {
        await initialize();
        const { billId } = req.params;

        const billResult = await pool.query(
            `SELECT id, reseller_id, bill_month,
              amount AS final_amount, adjustment, adjustment_note,
              bill_details, previous_due, created_at
       FROM monthly_bills
       WHERE id = $1`,
            [billId],
        );

        if (!billResult.rows.length) {
            return res.status(404).json({ message: "Bill not found" });
        }

        const bill = billResult.rows[0];
        const resellerId = bill.reseller_id;
        const billMonthDate = parseYMD(bill.bill_month);
        const monthStart = billMonthDate ? `${billMonthDate.getFullYear()}-${String(billMonthDate.getMonth() + 1).padStart(2, "0")}-${String(billMonthDate.getDate()).padStart(2, "0")}` : String(bill.bill_month).slice(0, 10);
        const monthYM = monthStart.slice(0, 7);

        const resellerResult = await pool.query(
            `SELECT
        id,
        user_id AS reseller_code,
        COALESCE(reseller_name, company_name) AS name,
        reseller_name,
        company_name,
        contact_no AS phone,
        pop_location,
        fn_reseller_previous_due(id, $2::date) AS due_amount,
        0::numeric AS projected_bill,
        COALESCE(iig_bw,0)::numeric AS iig_bw,
        COALESCE(bdix_bw,0)::numeric AS bdix_bw,
        COALESCE(ggc_bw,0)::numeric AS ggc_bw,
        COALESCE(fna_bw,0)::numeric AS fna_bw,
        COALESCE(cdn_bw,0)::numeric AS cdn_bw,
        COALESCE(bcdn_bw,0)::numeric AS bcdn_bw,
        COALESCE(nttn_capacity,0)::numeric AS nttn_capacity,
        COALESCE(rate_iig,0)::numeric AS rate_iig,
        COALESCE(rate_bdix,0)::numeric AS rate_bdix,
        COALESCE(rate_ggc,0)::numeric AS rate_ggc,
        COALESCE(rate_fna,0)::numeric AS rate_fna,
        COALESCE(rate_cdn,0)::numeric AS rate_cdn,
        COALESCE(rate_bcdn,0)::numeric AS rate_bcdn,
        COALESCE(rate_nttn,0)::numeric AS rate_nttn,
        COALESCE(otc_charge,0)::numeric AS otc_charge,
        ${hasResellerOtcAppliedMonthColumn() ? `otc_charge_applied_month,` : `NULL::date AS otc_charge_applied_month,`}
        COALESCE(real_ip_count,0)::int AS real_ip_count,
        COALESCE(real_ip_price,0)::numeric AS real_ip_price,
        COALESCE(status, 'active') AS status,
        created_at,
        ${joiningDateExpr()} AS joining_date
       FROM resellers WHERE id = $1`,
            [resellerId, monthStart],
        );

        if (!resellerResult.rows.length) {
            return res.status(404).json({ message: "Reseller not found" });
        }

        const logTypeExpr = LOG_TYPE_EXPR();
        const paidResult = await pool.query(
            `SELECT
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'payment'),0)::numeric AS total_paid,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'discount'),0)::numeric AS total_discount,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product','product_charge','charge')),0)::numeric AS total_product_charges
        FROM billing_logs
        WHERE reseller_id = $1
          AND TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') = $2
          AND ${logTypeExpr} IN ('payment','discount','product','product_charge','charge')`,
            [resellerId, monthYM],
        );

        const logResult = await pool.query(
            `SELECT id, reseller_id, log_type, change_desc AS note,
              transaction_amount AS amount, effective_date, created_at
       FROM billing_logs
       WHERE reseller_id = $1
         AND DATE_TRUNC('month', COALESCE(effective_date, created_at)) = DATE_TRUNC('month', $2::date)
       ORDER BY effective_date ASC`,
            [resellerId, monthStart],
        );

        const snapshot = parseBillDetailsSnapshot(bill.bill_details, `bill_id=${bill.id}`);
        let items = snapshot.items;
        let itemSource = "snapshot";
        // NOTE: rule lines (rule_id/rule_type) ride the snapshot as-is; rules
        // never create billing_logs rows, so the aggregates above stay clean.
        if (!snapshot.valid) {
            const recalculated = await calculateMonthlyBillBreakdown(resellerId, monthYM, resellerResult.rows[0]);
            items = recalculated.items || [];
            itemSource = "calculated_fallback";
        }

        const payments = (logResult.rows || []).filter(r => {
            const t = String(r.log_type || '').toLowerCase();
            if (t === 'payment') return true;
            // Legacy records: log_type not set, positive amount, not a charge type
            if (!t && Number(r.amount) > 0) return true;
            return false;
        });

        const discounts = (logResult.rows || []).filter(r => {
            const t = String(r.log_type || '').toLowerCase();
            return t === 'discount' || (String(r.note || '').toLowerCase().startsWith('discount:'));
        });

        // Retroactive correction audit log entries for this billing month
        let retroactiveCorrections = [];
        try {
            const retroResult = await pool.query(
                `SELECT id, action_type, created_at, actor_user_name, actor_role,
                        note, field_changes, amount_before, amount_after, amount_delta
                 FROM reseller_financial_audit_logs
                 WHERE reseller_id = $1
                   AND action_type IN ('RETROACTIVE_CORRECTION', 'RETROACTIVE_CORRECTION_SUMMARY')
                   AND (
                     (action_type = 'RETROACTIVE_CORRECTION'
                       AND field_changes->>'affected_month' = $2)
                     OR
                     (action_type = 'RETROACTIVE_CORRECTION_SUMMARY'
                       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $3::date))
                   )
                 ORDER BY created_at ASC`,
                [resellerId, monthYM, monthStart]
            );
            retroactiveCorrections = retroResult.rows || [];
        } catch (_) { /* optional table may not exist */ }


        res.json({
            reseller: resellerResult.rows[0],
            month: monthStart,
            bill,
            items,
            total_paid: parseFloat(paidResult.rows[0]?.total_paid || 0),
            total_discount: parseFloat(paidResult.rows[0]?.total_discount || 0),
            total_product_charges: parseFloat(paidResult.rows[0]?.total_product_charges || 0),
            payments,
            discounts,
            logs: logResult.rows,
            retroactive_corrections: retroactiveCorrections,
            meta: { item_source: itemSource },
        });
    } catch (error) {
        console.error("getInvoiceByBillId:", error);
        res.status(500).json({ message: "Failed to load static invoice" });
    }
};

const getMailTransport = () => {
    const host = String(process.env.SMTP_HOST || "").trim();
    const port = Number.parseInt(process.env.SMTP_PORT || "587", 10);
    const user = String(process.env.SMTP_USER || "").trim();
    const pass = String(process.env.SMTP_PASS || "").trim();
    const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

    if (!host || !port || !user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        disableFileAccess: true,
        disableUrlAccess: true,
    });
};

const getFrontendBaseUrl = () => {
    const candidate = String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
    if (!candidate) return "https://office.speednetkhulna.com";
    return candidate;
};

const parseSnapshotDataUrl = (raw) => {
    const dataUrl = String(raw || "").trim();
    if (!dataUrl) return null;
    const match = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=\n\r]+)$/);
    if (!match) return null;
    const mime = match[1];
    const base64Data = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(base64Data, "base64");
    if (!buffer.length) return null;
    if (buffer.length > 12 * 1024 * 1024) return null;
    const ext = mime === "image/jpeg" ? "jpg" : "png";
    return { mime, ext, buffer };
};

const sendInvoiceEmailByReseller = async (req, res) => {
    try {
        await initialize();
        const { resellerId } = req.params;
        const toEmail = normalizeMailbox(req.body?.to_email);
        const monthParam = String(req.body?.month || "").slice(0, 7) || getDhakaMonthYm();

        if (!toEmail) {
            return res.status(400).json({ message: "Valid to_email is required" });
        }

        const resellerResult = await pool.query(`SELECT id, COALESCE(reseller_name, company_name) AS name FROM resellers WHERE id = $1 LIMIT 1`, [resellerId]);
        if (!resellerResult.rows.length) {
            return res.status(404).json({ message: "Reseller not found" });
        }

        const monthStart = `${monthParam}-01`;
        const billResult = await pool.query(`SELECT id FROM monthly_bills WHERE reseller_id = $1 AND bill_month = $2::date LIMIT 1`, [resellerId, monthStart]);
        const billId = billResult.rows[0]?.id || null;

        const transport = getMailTransport();
        if (!transport) {
            return res.status(503).json({
                message: "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and optional SMTP_SECURE.",
            });
        }

        const frontend = getFrontendBaseUrl();
        const dynamicLink = `${frontend}/invoice?resellerId=${encodeURIComponent(resellerId)}&month=${encodeURIComponent(monthParam)}`;
        const staticLink = billId ? `${frontend}/view-static-invoice?id=${encodeURIComponent(billId)}` : null;
        const resellerName = resellerResult.rows[0].name || `Reseller #${resellerId}`;
        const fromAddress = String(process.env.SMTP_FROM || process.env.SMTP_USER || "billing@speednetkhulna.com").trim();
        const snapshot = parseSnapshotDataUrl(req.body?.snapshot_data_url);
        if (req.body?.snapshot_data_url && !snapshot) {
            return res.status(400).json({
                message: "Invalid snapshot_data_url (expected data:image/png;base64,...)",
            });
        }
        const attachmentName = `invoice_${resellerId}_${monthParam}.${snapshot?.ext || "png"}`;

        const html = `
      <div style="font-family:'Hind Siliguri','Noto Sans Bengali',Arial,sans-serif;line-height:1.5;color:#1f2937">
        <h2 style="margin:0 0 12px">Invoice Link - ${escapeHtml(resellerName)}</h2>
        <p style="margin:0 0 8px">Billing Month: <strong>${monthParam}</strong></p>
        <p style="margin:0 0 8px"><a href="${dynamicLink}">Open Invoice</a></p>
        ${staticLink ? `<p style="margin:0 0 8px"><a href="${staticLink}">Open Final Static Invoice</a></p>` : ""}
        ${snapshot ? `<p style="margin:0 0 8px">Attached: full invoice snapshot (${attachmentName})</p>` : ""}
        <p style="margin-top:16px;color:#6b7280">Generated from Speed Net Khulna billing system.</p>
      </div>
    `;

        await transport.sendMail({
            from: fromAddress,
            to: toEmail,
            subject: `Invoice ${monthParam} - ${String(resellerName).replace(/[\r\n]+/g, ' ').slice(0, 80)}`,
            html,
            attachments: snapshot ? [{ filename: attachmentName, content: snapshot.buffer, contentType: snapshot.mime }] : [],
        });

        res.json({
            message: "Invoice email sent successfully",
            to_email: toEmail,
            month: monthParam,
            links: { dynamic: dynamicLink, static: staticLink },
            attached_snapshot: Boolean(snapshot),
        });
    } catch (error) {
        console.error("sendInvoiceEmailByReseller:", error);
        res.status(500).json({ message: "Failed to send invoice email" });
    }
};

const sendInvoiceEmailByBillId = async (req, res) => {
    try {
        await initialize();
        const { billId } = req.params;
        const toEmail = normalizeMailbox(req.body?.to_email);
        if (!toEmail) {
            return res.status(400).json({ message: "Valid to_email is required" });
        }

        const billResult = await pool.query(
            `SELECT mb.id, mb.bill_month, mb.reseller_id, COALESCE(r.reseller_name, r.company_name) AS reseller_name
       FROM monthly_bills mb
       JOIN resellers r ON r.id = mb.reseller_id
       WHERE mb.id = $1
       LIMIT 1`,
            [billId],
        );
        if (!billResult.rows.length) {
            return res.status(404).json({ message: "Bill not found" });
        }

        const bill = billResult.rows[0];
        const monthYm = String(bill.bill_month).slice(0, 7);
        const frontend = getFrontendBaseUrl();
        const staticLink = `${frontend}/view-static-invoice?id=${encodeURIComponent(billId)}`;
        const dynamicLink = `${frontend}/invoice?resellerId=${encodeURIComponent(bill.reseller_id)}&month=${encodeURIComponent(monthYm)}`;

        const transport = getMailTransport();
        if (!transport) {
            return res.status(503).json({
                message: "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and optional SMTP_SECURE.",
            });
        }

        const resellerName = bill.reseller_name || `Reseller #${bill.reseller_id}`;
        const fromAddress = String(process.env.SMTP_FROM || process.env.SMTP_USER || "billing@speednetkhulna.com").trim();
        const snapshot = parseSnapshotDataUrl(req.body?.snapshot_data_url);
        if (req.body?.snapshot_data_url && !snapshot) {
            return res.status(400).json({
                message: "Invalid snapshot_data_url (expected data:image/png;base64,...)",
            });
        }
        const attachmentName = `invoice_bill_${billId}_${monthYm}.${snapshot?.ext || "png"}`;
        const html = `
      <div style="font-family:'Hind Siliguri','Noto Sans Bengali',Arial,sans-serif;line-height:1.5;color:#1f2937">
        <h2 style="margin:0 0 12px">Final Static Invoice - ${escapeHtml(resellerName)}</h2>
        <p style="margin:0 0 8px">Billing Month: <strong>${monthYm}</strong></p>
        <p style="margin:0 0 8px"><a href="${staticLink}">Open Final Static Invoice</a></p>
        <p style="margin:0 0 8px"><a href="${dynamicLink}">Open Invoice Page</a></p>
        ${snapshot ? `<p style="margin:0 0 8px">Attached: full invoice snapshot (${attachmentName})</p>` : ""}
        <p style="margin-top:16px;color:#6b7280">Generated from Speed Net Khulna billing system.</p>
      </div>
    `;

        await transport.sendMail({
            from: fromAddress,
            to: toEmail,
            subject: `Final Invoice ${monthYm} - ${String(resellerName).replace(/[\r\n]+/g, ' ').slice(0, 80)}`,
            html,
            attachments: snapshot ? [{ filename: attachmentName, content: snapshot.buffer, contentType: snapshot.mime }] : [],
        });

        res.json({
            message: "Static invoice email sent successfully",
            to_email: toEmail,
            bill_id: Number(billId),
            links: { static: staticLink, dynamic: dynamicLink },
            attached_snapshot: Boolean(snapshot),
        });
    } catch (error) {
        console.error("sendInvoiceEmailByBillId:", error);
        res.status(500).json({ message: "Failed to send static invoice email" });
    }
};

module.exports = {
    getInvoice,
    getInvoiceByBillId,
    sendInvoiceEmailByReseller,
    sendInvoiceEmailByBillId,
};
