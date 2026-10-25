const pool = require("../../utilities/db");
const {
  parseAmount,
  getDhakaMonthYm,
  monthInfo,
  toDateOnlyString,
  parseYMD,
  LOG_TYPE_EXPR,
  LOG_TYPE_EXPR_SIMPLE
} = require("./utils");
const { getActor, getReqMeta } = require("../../utilities/resellerFinancialAudit");

/**
 * Add a payment or billing log entry
 */
const addBillingLog = async (req, res) => {
    try {
        const { 
            reseller_id, 
            amount, 
            note, 
            description, // fallback
            log_type, 
            type, // fallback
            effective_date,
            idempotency_key 
        } = req.body;

        const finalResellerId = parseInt(reseller_id || req.params.resellerId || req.params.id, 10);
        const finalAmount = parseAmount(amount || req.body.transaction_amount, 0);
        const finalNote = String(note || description || req.body.change_desc || "").trim();
        const finalLogType = String(log_type || type || "payment").toLowerCase();

        // Bucket hygiene: unknown types vanish from every summary bucket
        const BILLING_LOG_TYPES = ['payment', 'discount', 'adjustment', 'product', 'charge'];
        if (!BILLING_LOG_TYPES.includes(finalLogType)) {
          return res.status(400).json({ message: "log_type must be payment, discount, adjustment, product, or charge" });
        }

        const finalEffectiveDate = effective_date || new Date();

        if (!finalResellerId || finalAmount <= 0) {
            return res.status(400).json({ message: "Invalid reseller_id or amount" });
        }

        // Date hygiene: no unparseable or absurd dates into the ledger
        const effDate = new Date(finalEffectiveDate);
        if (isNaN(effDate.getTime()) || effDate < new Date('2000-01-01') || effDate > new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)) {
            return res.status(400).json({ message: "Invalid effective_date" });
        }

        // Idempotency check: scoped to this reseller (a global key would
        // disclose another reseller's row or squat their future write).
        // Keys are client-generated: cap length, require sane charset.
        if (idempotency_key) {
            const keyStr = String(idempotency_key).trim();
            if (keyStr.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(keyStr)) {
                return res.status(400).json({ message: "Invalid idempotency_key" });
            }
            const existing = await pool.query(
                `SELECT * FROM billing_logs WHERE idempotency_key = $1 AND reseller_id = $2`,
                [keyStr, finalResellerId]
            );
            if (existing.rows.length > 0) {
                return res.status(200).json(existing.rows[0]);
            }
        }

        const actor = getActor(req);
        const reqMeta = getReqMeta(req);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // 1. Insert into billing_logs (the primary table for transactions)
            const logResult = await client.query(
                `INSERT INTO billing_logs (reseller_id, transaction_amount, change_desc, effective_date, created_at, log_type, idempotency_key)
                 VALUES ($1, $2, $3, $4, NOW(), $5, $6)
                 RETURNING *`,
                [finalResellerId, finalAmount, finalNote, effDate, finalLogType, idempotency_key ? String(idempotency_key).trim() : null]
            );

            // 2. Insert into reseller_financial_audit_logs
            await client.query(
                `INSERT INTO reseller_financial_audit_logs 
                 (reseller_id, actor_user_id, actor_user_name, actor_role, action_type, reference_table, reference_id, amount_delta, note, request_payload, route_path, http_method, ip_address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    finalResellerId,
                    actor.actor_user_id,
                    actor.actor_user_name,
                    actor.actor_role,
                    finalLogType === 'discount'
                        ? 'add_discount'
                        : (finalLogType === 'product' || finalLogType === 'product_charge')
                            ? 'add_product_charge'
                            : 'add_payment',
                    'billing_logs',
                    logResult.rows[0].id,
                    finalAmount,
                    finalNote,
                    JSON.stringify(req.body),
                    req.originalUrl,
                    req.method,
                    reqMeta.ip_address
                ]
            );

            await client.query("COMMIT");
            res.status(201).json(logResult.rows[0]);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Error in addBillingLog:", error);
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

/**
 * Add a discount (alias for addBillingLog with log_type=discount)
 */
const addDiscount = async (req, res) => {
    // Create a copy to avoid mutating the original req.body
    const discountBody = {
      ...req.body,
      log_type: 'discount',
    };
    if (!discountBody.note && discountBody.description) discountBody.note = discountBody.description;
    // Temporarily replace req.body for addBillingLog
    const originalBody = req.body;
    req.body = discountBody;
    try {
      return await addBillingLog(req, res);
    } finally {
      req.body = originalBody;
    }
};

/**
 * Get billing logs for a reseller
 */
const getBillingLogs = async (req, res) => {
    try {
        const resellerId = req.params.resellerId || req.query.reseller_id;
        const { start, end } = req.query;
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const params = [];
        let where = "";
        if (resellerId) {
            params.push(resellerId);
            where = `WHERE bl.reseller_id = $1`;
        }

        if (start && end) {
            const s = new Date(start);
            const e = new Date(end);
            if (isNaN(s.getTime()) || isNaN(e.getTime())) {
                return res.status(400).json({ message: "Invalid date range" });
            }
            params.push(start, end);
            where += `${where ? " AND" : "WHERE"} bl.effective_date BETWEEN $${params.length - 1} AND $${params.length}`;
        }

        const query = `SELECT bl.*,
          bl.transaction_amount AS amount,
          bl.change_desc AS note,
          COALESCE(r.reseller_name, r.company_name, '') AS reseller_name
          FROM billing_logs bl
          LEFT JOIN resellers r ON r.id = bl.reseller_id
          ${where}
          ORDER BY bl.effective_date DESC, bl.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching billing logs:', error);
        res.status(500).json({ message: 'Failed to fetch billing logs' });
    }
};

/**
 * Finalize a reseller's bill for a specific month
 * (Used by resellerController handlers)
 */
const finalizeResellerBill = async (client, { resellerId, monthYm, adjustment, adjustmentNote, actor, reqMeta, source, requestPayload = {}, fromDay, toDay }) => {
    const info = monthInfo(monthYm);

    // B7: serialize concurrent finalizes for the same reseller. Both the batch
    // loop and two admins clicking "Generate" run one transaction per reseller;
    // without this lock both pass the check below and insert duplicate
    // monthly_bills rows (no unique constraint exists yet — see migration
    // server/migrations/20260912_monthly_bills_unique.sql).
    await client.query(`SELECT id FROM resellers WHERE id = $1 FOR UPDATE`, [resellerId]);

    // 1. Check if already finalized in monthly_bills
    const checkResult = await client.query(
        `SELECT id FROM monthly_bills WHERE reseller_id = $1 AND bill_month = $2::date`,
        [resellerId, info.monthStartStr]
    );
    if (checkResult.rows.length > 0) {
        throw Object.assign(new Error(`Bill for ${monthYm} is already finalized (Bill ID: ${checkResult.rows[0].id}).`), { status: 409 });
    }

    // 2. Get Reseller Details for calculation
    const resellerResult = await client.query(`SELECT * FROM resellers WHERE id = $1`, [resellerId]);
    const reseller = resellerResult.rows[0];
    if (!reseller) throw Object.assign(new Error("Reseller not found"), { status: 404 });

    // 3. Calculate Bill Breakdown
    const { calculateMonthlyBillBreakdown } = require("./service");
    let breakdown;

    if (reseller.partner_type === 'channel_partner') {
        const commLogResult = await client.query(
            `SELECT total_collection, net_commission, month FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2`,
            [resellerId, monthYm]
        );
        if (commLogResult.rows.length > 0) {
            const cLog = commLogResult.rows[0];
            const netPayable = Number(cLog.total_collection || 0) - Number(cLog.net_commission || 0);
            breakdown = {
                total: netPayable,
                items: [
                    {
                        desc: `Channel Collection Share (${cLog.month})`,
                        total: netPayable,
                        collection: Number(cLog.total_collection),
                        commission: Number(cLog.net_commission)
                    }
                ]
            };
        } else {
            // Default to bandwidth breakdown or 0
            breakdown = await calculateMonthlyBillBreakdown(resellerId, monthYm, reseller, { fromDay, toDay });
        }
    } else {
        breakdown = await calculateMonthlyBillBreakdown(resellerId, monthYm, reseller, { fromDay, toDay });
    }

    // 4. Calculate Previous Due using carry-forward approach:
    //    Get the last finalized bill's closing balance, then add/subtract
    //    any transactions (product charges, payments, discounts) recorded
    //    between that bill's month and the current month.
    //    This preserves the opening balance from the very first bill.
    const logTypeExpr = LOG_TYPE_EXPR();
    const priorBillResult = await client.query(
        `SELECT previous_due, amount, adjustment, bill_month
         FROM monthly_bills
         WHERE reseller_id = $1 AND bill_month < $2::date
         ORDER BY bill_month DESC LIMIT 1`,
        [resellerId, info.monthStartStr]
    );

    let previousDue;
    if (priorBillResult.rows.length > 0) {
        const pb = priorBillResult.rows[0];
        const priorClosing = Number(pb.previous_due) + Number(pb.amount) + Number(pb.adjustment);

        const afterResult = await client.query(
            `SELECT
                COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment', 'discount')), 0) AS total_paid,
                COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0) AS total_product
             FROM billing_logs
             WHERE reseller_id = $1
               AND COALESCE(effective_date, created_at) >= $2::date
               AND COALESCE(effective_date, created_at) < $3::date`,
            [resellerId, pb.bill_month, info.monthStartStr]
        );

        const extraPayments  = Number(afterResult.rows[0]?.total_paid    || 0);
        const extraProduct   = Number(afterResult.rows[0]?.total_product || 0);
        previousDue = priorClosing + extraProduct - extraPayments;
    } else {
        // First-ever bill — use the reseller's cached previous_month_due as opening balance,
        // plus any unbilled product charges or payments not yet accounted for.
        const openingResult = await client.query(
            `SELECT
                COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0) AS total_product,
                COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment', 'discount')), 0) AS total_paid
             FROM billing_logs
             WHERE reseller_id = $1
               AND COALESCE(effective_date, created_at) < $2::date`,
            [resellerId, info.monthStartStr]
        );
        const openingProduct = Number(openingResult.rows[0]?.total_product || 0);
        const openingPaid    = Number(openingResult.rows[0]?.total_paid    || 0);
        const openingPd = await client.query(
            `SELECT fn_reseller_previous_due($1, $2::date) AS opening_balance`,
            [resellerId, info.monthStartStr]
        );
        const openingBalance = Number(openingPd.rows[0]?.opening_balance || 0);
        previousDue = openingBalance + openingProduct - openingPaid;
    }
    previousDue = Math.round(previousDue * 100) / 100;

    // 5. Insert into monthly_bills
    const billResult = await client.query(
        `INSERT INTO monthly_bills (reseller_id, bill_month, amount, adjustment, adjustment_note, bill_details, previous_due, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [
            resellerId,
            info.monthStartStr,
            breakdown.total,
            adjustment,
            adjustmentNote,
            JSON.stringify(breakdown.items),
            previousDue
        ]
    );

    // 6. [removed] previous_month_due/stale column dropped — use fn_reseller_previous_due() instead
    // 7. Audit Log
    await client.query(
        `INSERT INTO reseller_financial_audit_logs 
         (reseller_id, actor_user_id, actor_user_name, actor_role, action_type, reference_table, reference_id, amount_after, due_before, due_after, note, request_payload, ip_address)
         VALUES ($1, $2, $3, $4, 'finalize_bill', 'monthly_bills', $5, $6, $7, $8, $9, $10, $11)`,
        [
            resellerId,
            actor.actor_user_id,
            actor.actor_user_name,
            actor.actor_role,
            billResult.rows[0].id,
            breakdown.total,
            previousDue,
            Math.round((previousDue + Number(breakdown.total) + adjustment) * 100) / 100,
            `Finalized bill for ${monthYm}. Source: ${source}`,
            JSON.stringify(requestPayload),
            reqMeta.ip_address
        ]
    );

    return { 
        success: true, 
        message: `Bill for ${monthYm} finalized successfully.`, 
        bill_id: billResult.rows[0].id,
        amount: breakdown.total 
    };
};

/**
 * Get financial audit logs
 */
const getFinancialAuditLogs = async (req, res) => {
    try {
        const { reseller_id, action_type, start, end } = req.query;
        const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const params = [];
        const conditions = [];

        if (reseller_id) {
            params.push(parseInt(reseller_id, 10));
            conditions.push(`reseller_id = $${params.length}`);
        }
        if (action_type) {
            params.push(action_type);
            conditions.push(`action_type = $${params.length}`);
        }
        if (start) {
            params.push(start);
            conditions.push(`created_at >= $${params.length}`);
        }
        if (end) {
            params.push(end);
            conditions.push(`created_at <= $${params.length}`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const safePage = Number.isFinite(page) ? page : 1;
        const safeLimit = Number.isFinite(limit) ? limit : 50;
        const offset = (safePage - 1) * safeLimit;

        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM reseller_financial_audit_logs ${where}`,
            params
        );

        params.push(safeLimit);
        params.push(offset);
        const dataResult = await pool.query(
            `SELECT * FROM reseller_financial_audit_logs ${where}
             ORDER BY created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            total: countResult.rows[0].total,
            page: safePage,
            limit: safeLimit,
            rows: dataResult.rows,
        });
    } catch (error) {
        console.error('Error fetching financial audit logs:', error);
        res.status(500).json({ message: 'Failed to fetch audit logs' });
    }
};

/**
 * Get monthly summary for all resellers
 */
const getMonthlySummary = async (req, res) => {
    try {
        const { month, partner_type } = req.query;
        const targetMonthYm = month ? String(month).slice(0, 7) : getDhakaMonthYm();
        const targetMonthDate = `${targetMonthYm}-01`;
        const info = monthInfo(targetMonthYm);

        // 1. Fetch active resellers with all billing-related columns
        let resellerQuery = `
            SELECT *, 
                   COALESCE(reseller_name, company_name) AS name,
                   0::numeric AS previous_month_due,
                   0::numeric AS current_projected_bill
            FROM resellers
            WHERE status = 'active'
        `;

        const queryParams = [];
        if (partner_type && partner_type !== 'all') {
            resellerQuery += ` AND partner_type = $1`;
            queryParams.push(partner_type);
        }

        const resellersResult = await pool.query(resellerQuery, queryParams);
        const resellers = resellersResult.rows;

        if (resellers.length === 0) {
            return res.json({ month: targetMonthYm, rows: [], totals: { projected: 0, paid: 0, discount: 0, due: 0 } });
        }

        // 1.1 Batch compute previous_month_due for all resellers
        const dueMap = {};
        try {
            const dueResult = await pool.query(
                `SELECT id, fn_reseller_previous_due(id, $1::date) AS prev_due FROM resellers WHERE id = ANY($2::int[])`,
                [targetMonthDate, resellers.map(r => r.id)]
            );
            dueResult.rows.forEach(r => { dueMap[r.id] = Number(r.prev_due); });
        } catch (e) {
            console.warn("Could not compute previous_due:", e.message);
        }

        // 2. Fetch finalized bills for the target month
        const billsResult = await pool.query(
            `SELECT reseller_id, amount, adjustment, previous_due 
             FROM monthly_bills 
             WHERE bill_month = $1`,
            [targetMonthDate]
        );
        const billsMap = billsResult.rows.reduce((acc, b) => {
            acc[b.reseller_id] = b;
            return acc;
        }, {});

        // 3. Fetch payments and discounts from billing_logs for the target month
        // P3: sargable month RANGE (TO_CHAR on the column defeated every index
        // and forced a full billing_logs scan per summary load). SIMPLE expr
        // avoids per-row to_jsonb(row) serialization; legacy NULL-log_type
        // fallback is preserved by the COALESCE inside it.
        const msLogTypeExpr = LOG_TYPE_EXPR_SIMPLE();
        const logsResult = await pool.query(
            `SELECT reseller_id,
                    SUM(CASE WHEN ${msLogTypeExpr} IN ('payment') THEN transaction_amount ELSE 0 END) AS paid,
                    SUM(CASE WHEN ${msLogTypeExpr} = 'discount' THEN transaction_amount ELSE 0 END) AS discount,
                    SUM(CASE WHEN ${msLogTypeExpr} IN ('product', 'product_charge', 'charge') THEN transaction_amount ELSE 0 END) AS product_charges
             FROM billing_logs
             WHERE COALESCE(effective_date, created_at) >= $1::date
               AND COALESCE(effective_date, created_at) < ($1::date + interval '1 month')
             GROUP BY reseller_id`,
            [targetMonthDate]
        );
        const logsMap = logsResult.rows.reduce((acc, l) => {
            acc[l.reseller_id] = l;
            return acc;
        }, {});

        // 3.1 Fetch channel partner commission logs for the month
        const channelCommResult = await pool.query(
            `SELECT reseller_id, total_collection, net_commission 
             FROM channel_commission_logs 
             WHERE month = $1`,
            [targetMonthYm]
        );
        const channelCommMap = channelCommResult.rows.reduce((acc, c) => {
            acc[c.reseller_id] = c;
            return acc;
        }, {});

        // 4. Process each reseller in parallel
        const { calculateMonthlyBillBreakdown, getActiveBillingRulesForResellers } = require("./service");
        const isCurrentMonth = targetMonthYm === getDhakaMonthYm();

        // 4.1 Batch-load active billing rules once for all resellers; row
        // tasks apply them in-memory via preloadedRules (no per-row queries).
        // Finalized bills already froze their rule lines in bill_details.
        const billingRulesMap = await getActiveBillingRulesForResellers(
            resellers.map((r) => r.id),
            targetMonthYm,
        );

        const rowTasks = resellers.map((r) => async () => {
            const bill = billsMap[r.id];
            const logs = logsMap[r.id] || { paid: 0, discount: 0, product_charges: 0 };

            let projected = 0;
            let prevDue = 0;

            if (bill) {
                projected = Number(bill.amount || 0) + Number(bill.adjustment || 0);
                prevDue = Number(bill.previous_due || 0);
            } else {
                if (r.partner_type === 'channel_partner') {
                    const cLog = channelCommMap[r.id];
                    if (cLog) {
                        // For Channel Partners, projected bill is (Collection - Partner's Share)
                        projected = Number(cLog.total_collection || 0) - Number(cLog.net_commission || 0);
                    } else {
                        projected = 0;
                    }
                } else if (isCurrentMonth) {
                    try {
                        const breakdown = await calculateMonthlyBillBreakdown(r.id, targetMonthYm, r, {
                            preloadedRules: billingRulesMap[r.id] || [],
                        });
                        projected = Number(breakdown.total || 0);
                    } catch (e) {
                        projected = 0;
                    }
                } else {
                    projected = 0;
                }
                prevDue = Number(dueMap[r.id] || 0);
            }


            const paid = Number(logs.paid || 0);
            const discount = Number(logs.discount || 0);
            const productCharges = Number(logs.product_charges || 0);
            const totalBill = prevDue + projected + productCharges;
            const newDue = totalBill - paid - discount;

            return {
                id: r.id,
                name: r.name,
                company: r.company_name,
                contact: r.contact,
                projected: projected,
                prev_due: prevDue,
                total_bill: totalBill,
                paid: paid,
                discount: discount,
                new_due: newDue,
                next_pay_date: r.next_pay_date,
            };
        });

        // P4: run breakdowns in small chunks, not one unbounded Promise.all.
        // Each breakdown costs ~4 queries; N resellers x unbounded concurrency
        // saturates the 10-connection pool and queues every other request.
        // Tasks are factories (not pre-started promises) so the cap is real.
        const rows = [];
        const CHUNK = 5;
        for (let i = 0; i < rowTasks.length; i += CHUNK) {
            const chunk = await Promise.all(rowTasks.slice(i, i + CHUNK).map((t) => t()));
            rows.push(...chunk);
        }
        
        // Calculate grand totals
        const totals = rows.reduce((acc, row) => {
            acc.projected += row.projected;
            acc.paid += row.paid;
            acc.discount += row.discount;
            acc.due += row.new_due;
            return acc;
        }, { projected: 0, paid: 0, discount: 0, due: 0 });

        res.json({
            month: targetMonthYm,
            rows,
            totals
        });
    } catch (error) {
        console.error("getMonthlySummary error:", error);
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

/**
 * Update next pay date from monthly summary
 */
const updateMonthlySummaryPayDate = async (req, res) => {
    try {
        const { reseller_id, date } = req.body;
        if (!reseller_id) return res.status(400).json({ message: "reseller_id is required" });
        if (date !== undefined && date !== null && date !== '') {
            const d = new Date(date);
            if (isNaN(d.getTime()) || d < new Date('2000-01-01') || d > new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)) {
                return res.status(400).json({ message: "Invalid date" });
            }
        }

        await pool.query(
            `UPDATE resellers SET next_pay_date = $1, updated_at = NOW() WHERE id = $2`,
            [date || null, reseller_id]
        );

        res.json({ success: true, message: "Pay date updated" });
    } catch (error) {
        console.error("updateMonthlySummaryPayDate error:", error);
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};

module.exports = {
    addBillingLog,
    addDiscount,
    getBillingLogs,
    getMonthlySummary,
    updateMonthlySummaryPayDate,
    finalizeResellerBill,
    getFinancialAuditLogs,
};
