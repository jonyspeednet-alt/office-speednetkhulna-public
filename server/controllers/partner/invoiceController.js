// controllers/partner/invoiceController.js — payment history + invoice view
// Replaces payment_history.php and view_invoice.php (data side only; the
// print/PNG rendering happens client-side in the React SPA).
const pool = require("../../utilities/db");
const { parseAmount, toDateOnlyString, LOG_TYPE_EXPR } = require("../reseller/utils");

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** GET /api/partner/payments — all positive billing_logs */
const listPayments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, transaction_amount, change_desc, effective_date, created_at
       FROM billing_logs
       WHERE reseller_id = $1 AND transaction_amount > 0
       ORDER BY effective_date DESC, created_at DESC`,
      [req.reseller.id],
    );
    const total = result.rows.reduce(
      (s, p) => s + parseAmount(p.transaction_amount, 0),
      0,
    );
    res.json({ rows: result.rows, total: round2(total) });
  } catch (error) {
    console.error("partner listPayments error:", error);
    res.status(500).json({ message: "Failed to load payments" });
  }
};

/** GET /api/partner/invoice/:billId — scoped to the logged-in reseller */
const getInvoice = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const billId = Number(req.params.billId);
    if (!billId) return res.status(400).json({ message: "Invalid invoice id" });

    const billRes = await pool.query(
      `SELECT mb.*, r.reseller_name, r.company_name, r.pop_location, r.contact_no
       FROM monthly_bills mb
       JOIN resellers r ON r.id = mb.reseller_id
       WHERE mb.id = $1 AND mb.reseller_id = $2`,
      [billId, resellerId],
    );
    const bill = billRes.rows[0];
    if (!bill) return res.status(404).json({ message: "Invoice not found" });

    let items = [];
    try {
      items =
        typeof bill.bill_details === "string"
          ? JSON.parse(bill.bill_details)
          : bill.bill_details || [];
    } catch (_) {
      items = [];
    }
    if (!Array.isArray(items)) items = [];

    // B8: pg DATE arrives as a local-midnight Date — toISOString() would shift
    // it a day back under Asia/Dhaka. Slice the calendar date instead.
    const ym = toDateOnlyString(bill.bill_month).slice(0, 7);
    // Office parity: bucket by canonical log_type (LOG_TYPE_EXPR, same as the
    // office invoice). Summing every row inflated total_paid with discounts
    // and product charges; rule discounts live in bill items, never here.
    const logTypeExpr = LOG_TYPE_EXPR();
    const paidRes = await pool.query(
      `SELECT
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'payment'), 0) AS paid,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'discount'), 0) AS discount,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0) AS product_charges
       FROM billing_logs
       WHERE reseller_id = $1 AND TO_CHAR(COALESCE(effective_date, created_at),'YYYY-MM') = $2
         AND ${logTypeExpr} IN ('payment', 'discount', 'product', 'product_charge', 'charge')`,
      [resellerId, ym],
    );
    const totalPaid = parseAmount(paidRes.rows[0]?.paid, 0);
    const totalDiscount = parseAmount(paidRes.rows[0]?.discount, 0);
    const totalProductCharges = parseAmount(paidRes.rows[0]?.product_charges, 0);
    const discountRows = await pool.query(
      `SELECT id, transaction_amount AS amount, change_desc AS note,
              effective_date, created_at, ${logTypeExpr} AS log_type
       FROM billing_logs
       WHERE reseller_id = $1 AND TO_CHAR(COALESCE(effective_date, created_at),'YYYY-MM') = $2
         AND ${logTypeExpr} = 'discount'
       ORDER BY effective_date ASC, created_at ASC`,
      [resellerId, ym],
    );
    // Rule lines from the frozen bill snapshot (single source of truth).
    const ruleItems = items.filter((it) => it && it.rule_id != null);
    const prevDue = parseAmount(bill.previous_due, 0);
    const amount = parseAmount(bill.amount, 0);
    const adjustment = parseAmount(bill.adjustment, 0);
    // Office formula (Invoice netPayable): prev + amount + adj + product - paid - discount
    const netPayable = round2(prevDue + amount + adjustment + totalProductCharges - totalPaid - totalDiscount);

    res.json({
      invoice: {
        id: bill.id,
        invoice_no: String(bill.id).padStart(5, "0"),
        bill_month: bill.bill_month,
        created_at: bill.created_at,
        reseller_name: bill.reseller_name,
        company_name: bill.company_name,
        pop_location: bill.pop_location,
        contact_no: bill.contact_no,
        items,
        rule_items: ruleItems,
        discounts: discountRows.rows || [],
        previous_due: prevDue,
        amount,
        adjustment,
        adjustment_note: bill.adjustment_note || "",
        total_paid: totalPaid,
        total_discount: totalDiscount,
        total_product_charges: totalProductCharges,
        net_payable: netPayable,
      },
    });
  } catch (error) {
    console.error("partner getInvoice error:", error);
    res.status(500).json({ message: "Failed to load invoice" });
  }
};

module.exports = { listPayments, getInvoice };
