const pool = require("../utilities/db");
const { getActor, getReqMeta } = require("../utilities/resellerFinancialAudit");
const { listResellers, createReseller, getResellerProfile } = require("./reseller/profile");
const { getResellerProfileDetails } = require("./reseller/details");
const { updateReseller } = require("./reseller/update");
const { getStatusNoc } = require("./reseller/status");
const { createBandwidthRequest, listBandwidthRequests, reviewBandwidthRequest, applyApprovedRequest } = require("./reseller/bandwidth");
const { getBillingLogs, addBillingLog, addDiscount, getMonthlySummary, updateMonthlySummaryPayDate, finalizeResellerBill, getFinancialAuditLogs } = require("./reseller/billing");
const { getInvoice, getInvoiceByBillId, sendInvoiceEmailByReseller, sendInvoiceEmailByBillId } = require("./reseller/invoice");
const { getPartnerSheetList, ingestPartnerSheetWebhook } = require("./reseller/sheets");
const { changeResellerRate, getResellerRateChangeLogs } = require("./reseller/rateChange");
const { initialize } = require("./reseller/dbSetup");
const { getDhakaMonthYm, parseAmount } = require("./reseller/utils");
const { getPartnerReport, getPartnerTrends, getPartnerDetailReport, getPartnerLifetimeReport } = require("./reseller/partnerReport");
const { previewRetroactiveCorrection, applyRetroactiveCorrection } = require("./reseller/retroactiveCorrection");
const { listRules, createRule, updateRule, deactivateRule } = require("./reseller/billingRules");

const runFinalize = async (req, res) => {
    try {
        await initialize();
        const resellerId = Number(req.params.resellerId);
        const monthYm = String(req.body.month || getDhakaMonthYm());
        if (!Number.isSafeInteger(resellerId) || resellerId <= 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthYm) || Number(monthYm.slice(0, 4)) === 0) {
            return res.status(400).json({ message: "Valid reseller ID and month (YYYY-MM) are required" });
        }
        const adjustment = parseAmount(req.body.adjustment, 0);
        const adjustmentNote = adjustment !== 0 ? String(req.body.adjustment_note || "").trim() : null;
        if (adjustment !== 0 && !adjustmentNote) {
            return res.status(400).json({ message: "Adjustment note is required for non-zero adjustment" });
        }
        const fromDay = parseInt(req.body.from_day, 10) || undefined;
        const toDay = parseInt(req.body.to_day, 10) || undefined;

        const actor = getActor(req);
        const reqMeta = getReqMeta(req);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await finalizeResellerBill(client, {
                resellerId,
                monthYm,
                adjustment,
                adjustmentNote,
                fromDay,
                toDay,
                actor,
                reqMeta,
                source: "manual",
                requestPayload: { ...req.body },
            });
            await client.query("COMMIT");
            res.json(result);
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("runFinalize POST handler:", error);
        res.status(error.status || 500).json({ message: error.status ? error.message : 'Server Error. Please try again later.' });
    }
};

// Alias: route POST /invoice/:resellerId/finalize -> runFinalize
const finalizeInvoice = runFinalize;

// Batch: generate (finalize) bills for all active resellers for a given month
const generateMonthlyBills = async (req, res) => {
    try {
        await initialize();
        const monthYm = String(req.body.month || getDhakaMonthYm()).slice(0, 7);
        const actor = getActor(req);
        const reqMeta = getReqMeta(req);

        const resellers = await pool.query(
            `SELECT id FROM resellers WHERE status = 'active'`
        );

        const results = [];
        for (const r of resellers.rows) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await finalizeResellerBill(client, {
                    resellerId: r.id,
                    monthYm,
                    adjustment: 0,
                    adjustmentNote: null,
                    actor,
                    reqMeta,
                    source: 'batch',
                    requestPayload: { ...req.body },
                });
                await client.query('COMMIT');
                results.push({ resellerId: r.id, success: true, message: result.message });
            } catch (error) {
                await client.query('ROLLBACK');
                results.push({ resellerId: r.id, success: false, message: 'Failed' });
            } finally {
                client.release();
            }
        }

        const successCount = results.filter(r => r.success).length;
        res.json({
            month: monthYm,
            total: results.length,
            success: successCount,
            failed: results.length - successCount,
            results,
        });
    } catch (error) {
        console.error('generateMonthlyBills error:', error);
        res.status(500).json({ message: 'Server Error. Please try again later.' });
    }
};


module.exports = {
    listResellers,
    createReseller,
    getResellerProfile,
    getResellerProfileDetails,
    updateReseller,
    getStatusNoc,
    createBandwidthRequest,
    listBandwidthRequests,
    reviewBandwidthRequest,
    applyApprovedRequest,
    getBillingLogs,
    addBillingLog,
    addDiscount,
    getMonthlySummary,
    updateMonthlySummaryPayDate,
    getFinancialAuditLogs,
    runFinalize,
    finalizeInvoice,
    generateMonthlyBills,
    getInvoice,
    getInvoiceByBillId,
    sendInvoiceEmailByReseller,
    sendInvoiceEmailByBillId,
    getPartnerSheetList,
    ingestPartnerSheetWebhook,
    changeResellerRate,
    getResellerRateChangeLogs,
    getPartnerReport,
    getPartnerTrends,
    getPartnerDetailReport,
    getPartnerLifetimeReport,
    previewRetroactiveCorrection,
    applyRetroactiveCorrection,
    listRules,
    createRule,
    updateRule,
    deactivateRule,
    initialize,
};
