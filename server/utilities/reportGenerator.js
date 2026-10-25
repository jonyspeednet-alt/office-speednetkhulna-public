const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../utilities/db');

/**
 * Generate reconciliation report in PDF format
 * @param {Object} reconciliation - Reconciliation data
 * @returns {Promise<string>} - Path to generated PDF
 */
async function generateReconciliationReport(reconciliation) {
    try {
        // Get partner details
        const partnerResult = await db.query(
            `SELECT r.reseller_name AS name,
                    COALESCE(s.profit_share_percentage,
                      (SELECT c.profit_share_pct FROM channel_commission_logs c WHERE c.reseller_id=r.id ORDER BY c.created_at DESC LIMIT 1), 0) AS profit_share_pct
             FROM resellers r LEFT JOIN channel_partner_profile_settings s ON s.reseller_id=r.id WHERE r.id=$1`,
            [reconciliation.reseller_id]
        );

        if (partnerResult.rows.length === 0) {
            throw Object.assign(new Error('Partner not found'), { status: 404 });
        }

        const partner = partnerResult.rows[0];

        // Create PDF document
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            bufferPages: true
        });

        const month = normalizeReconciliationMonth(reconciliation.reconciliation_month);
        const fileName = `reconciliation_${reconciliation.reseller_id}_${month.replace(/-/g, '')}.pdf`;
        const reportsDir = path.join(__dirname, '../reports');

        // Ensure reports directory exists
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        const filePath = path.join(reportsDir, fileName);
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Register Bengali TTF fonts for PDFKit
        const fontRegular = path.join(__dirname, '../assets/fonts/HindSiliguri-Regular.ttf');
        const fontBold = path.join(__dirname, '../assets/fonts/HindSiliguri-Bold.ttf');
        const hasRegularFont = fs.existsSync(fontRegular);
        const hasBoldFont = fs.existsSync(fontBold);

        if (hasRegularFont) {
            doc.registerFont('BanglaFont', fontRegular);
            doc.font('BanglaFont');
        }
        if (hasBoldFont) {
            doc.registerFont('BanglaFontBold', fontBold);
        }
        doc.fontSize(20)
            .text('মাসিক নিষ্পত্তি রিপোর্ট', { align: 'center' })
            .fontSize(16)
            .text('Monthly Settlement Report', { align: 'center' })
            .moveDown(2);

        // Partner Information
        doc.fontSize(12)
            .text(`Partner / পার্টনার: ${partner.name}`, { bold: true })
            .text(`Month / মাস: ${formatMonth(reconciliation.reconciliation_month)}`)
            .text(`Profit Share / লাভের হার: ${partner.profit_share_pct}%`)
            .text(`Status / অবস্থা: ${getStatusInBengali(reconciliation.reconciliation_status)}`)
            .moveDown(1.5);

        // Draw separator line
        doc.moveTo(50, doc.y)
            .lineTo(545, doc.y)
            .stroke()
            .moveDown(1);

        // Summary Section
        doc.fontSize(14)
            .text('Summary / সারাংশ', { underline: true })
            .moveDown(0.5);

        doc.fontSize(11);

        // Collection Details
        doc.text('Collection Details / সংগ্রহের বিবরণ:', { bold: true })
            .fontSize(10)
            .text(`  Total Collected / মোট সংগৃহীত: ${formatCurrency(reconciliation.total_collected)} BDT`)
            .text(`  Total Realized / প্রকৃত প্রাপ্ত: ${formatCurrency(reconciliation.total_realized)} BDT`)
            .text(`  Total Deferred / বকেয়া: ${formatCurrency(reconciliation.total_deferred)} BDT`)
            .moveDown(0.5);

        // Commission Calculation
        doc.fontSize(11)
            .text('Commission Calculation / কমিশন হিসাব:', { bold: true })
            .fontSize(10)
            .text(`  Gross Commission / মোট কমিশন: ${formatCurrency(reconciliation.gross_commission)} BDT`)
            .text(`  Partner Advances / অগ্রিম পেমেন্ট: ${formatCurrency(reconciliation.partner_advances)} BDT`)
            .text(`  Deferred Amount / বকেয়া বিল: ${formatCurrency(reconciliation.total_deferred)} BDT`)
            .text(`  Adjustments / সমন্বয়: ${formatCurrency(reconciliation.adjustments || 0)} BDT`)
            .text(`  Deductions / কর্তন: ${formatCurrency(reconciliation.deductions || 0)} BDT`)
            .moveDown(0.5);

        // Net Commission (highlighted)
        doc.fontSize(14)
            .fillColor('blue')
            .text(`Net Commission / নিট কমিশন: ${formatCurrency(reconciliation.net_commission)} BDT`, {
                bold: true,
                underline: true
            })
            .fillColor('black')
            .moveDown(1.5);

        // Draw separator line
        doc.moveTo(50, doc.y)
            .lineTo(545, doc.y)
            .stroke()
            .moveDown(1);

        // Approval Information
        if (reconciliation.approved_at) {
            doc.fontSize(11)
                .text('Approval Information / অনুমোদনের তথ্য:', { bold: true })
                .fontSize(10)
                .text(`  Approved By / অনুমোদনকারী: ${reconciliation.approved_by_name || 'N/A'}`)
                .text(`  Approved At / অনুমোদনের সময়: ${formatDateTime(reconciliation.approved_at)}`)
                .moveDown(1);
        } else {
            doc.fontSize(11)
                .text('Status / অবস্থা:', { bold: true })
                .fontSize(10)
                .text(`  Initiated By / শুরুকারী: ${reconciliation.initiated_by_name || 'N/A'}`)
                .text(`  Initiated At / শুরুর সময়: ${formatDateTime(reconciliation.initiated_at)}`)
                .moveDown(1);
        }

        // Get detailed breakdown from snapshot
        if (reconciliation.snapshot_data) {
            const snapshot = typeof reconciliation.snapshot_data === 'string'
                ? JSON.parse(reconciliation.snapshot_data)
                : reconciliation.snapshot_data;

            // Add page break if needed
            if (doc.y > 650) {
                doc.addPage();
            }

            // Draw separator line
            doc.moveTo(50, doc.y)
                .lineTo(545, doc.y)
                .stroke()
                .moveDown(1);

            // Payment Details
            if (snapshot.payments && snapshot.payments.length > 0) {
                doc.fontSize(11)
                    .text('Payment Details / পেমেন্টের বিবরণ:', { bold: true })
                    .moveDown(0.5);

                doc.fontSize(9);

                // Table header
                const tableTop = doc.y;
                doc.text('User / ইউজার', 50, tableTop, { width: 150 })
                    .text('Amount / টাকা', 200, tableTop, { width: 80, align: 'right' })
                    .text('Realized / প্রাপ্ত', 280, tableTop, { width: 80, align: 'right' })
                    .text('Deferred / বকেয়া', 360, tableTop, { width: 80, align: 'right' })
                    .text('Status / অবস্থা', 440, tableTop, { width: 100 });

                doc.moveDown(0.3);

                // Draw line under header
                doc.moveTo(50, doc.y)
                    .lineTo(545, doc.y)
                    .stroke()
                    .moveDown(0.3);

                // Table rows
                snapshot.payments.forEach((payment, index) => {
                    if (doc.y > 700) {
                        doc.addPage();
                        doc.fontSize(9);
                    }

                    const rowY = doc.y;
                    doc.text(payment.user_name || 'N/A', 50, rowY, { width: 150 })
                        .text(formatCurrency(payment.amount_paid), 200, rowY, { width: 80, align: 'right' })
                        .text(formatCurrency(payment.realized_amount), 280, rowY, { width: 80, align: 'right' })
                        .text(formatCurrency(payment.deferred_amount), 360, rowY, { width: 80, align: 'right' })
                        .text(getStatusInBengali(payment.billing_status), 440, rowY, { width: 100 });

                    doc.moveDown(0.5);
                });

                doc.moveDown(1);
            }

            // Advance Details
            if (snapshot.advances && snapshot.advances.length > 0) {
                // Add page break if needed
                if (doc.y > 650) {
                    doc.addPage();
                }

                doc.fontSize(11)
                    .text('Advance Details / অগ্রিম পেমেন্টের বিবরণ:', { bold: true })
                    .moveDown(0.5);

                doc.fontSize(9);

                // Table header
                const tableTop = doc.y;
                doc.text('User / ইউজার', 50, tableTop, { width: 150 })
                    .text('Amount / টাকা', 200, tableTop, { width: 100, align: 'right' })
                    .text('Type / ধরন', 300, tableTop, { width: 120 })
                    .text('Notes / নোট', 420, tableTop, { width: 125 });

                doc.moveDown(0.3);

                // Draw line under header
                doc.moveTo(50, doc.y)
                    .lineTo(545, doc.y)
                    .stroke()
                    .moveDown(0.3);

                // Table rows
                snapshot.advances.forEach((advance, index) => {
                    if (doc.y > 700) {
                        doc.addPage();
                        doc.fontSize(9);
                    }

                    const rowY = doc.y;
                    doc.text(advance.user_name || 'N/A', 50, rowY, { width: 150 })
                        .text(formatCurrency(advance.advance_amount), 200, rowY, { width: 100, align: 'right' })
                        .text(getAdvanceTypeInBengali(advance.advance_type), 300, rowY, { width: 120 })
                        .text(advance.notes || '-', 420, rowY, { width: 125 });

                    doc.moveDown(0.5);
                });

                doc.moveDown(1);
            }
        }

        // Footer
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);

            // Draw footer line
            doc.moveTo(50, doc.page.height - 70)
                .lineTo(545, doc.page.height - 70)
                .stroke();

            doc.fontSize(8)
                .fillColor('gray')
                .text(
                    'Generated by Speed Net Office System | স্পিড নেট অফিস সিস্টেম',
                    50,
                    doc.page.height - 60,
                    { align: 'center', width: 495 }
                )
                .text(
                    `Generated on: ${formatDateTime(new Date())} | Page ${i + 1} of ${pageCount}`,
                    50,
                    doc.page.height - 45,
                    { align: 'center', width: 495 }
                )
                .fillColor('black');
        }

        // Finalize PDF
        doc.end();

        return new Promise((resolve, reject) => {
            stream.on('finish', () => {
                console.log(`PDF report generated: ${filePath}`);
                resolve(`/reports/${fileName}`);
            });
            stream.on('error', (error) => {
                console.error('Error generating PDF:', error);
                reject(error);
            });
        });

    } catch (error) {
        console.error('Error in generateReconciliationReport:', error);
        throw error;
    }
}

/**
 * Format currency with commas
 */
function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '0.00';
    return parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format month (YYYY-MM to readable format)
 */
function normalizeReconciliationMonth(value) {
    if (value instanceof Date && Number.isNaN(value.getTime())) {
        throw Object.assign(new Error('Invalid reconciliation month'), { status: 400 });
    }
    const text = value instanceof Date
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).formatToParts(value)
            .filter((part) => part.type === 'year' || part.type === 'month')
            .reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {})
        : null;
    const month = text ? `${text.year}-${text.month}` : String(value || '').slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) === 0) {
        throw Object.assign(new Error('Invalid reconciliation month'), { status: 400 });
    }
    return month;
}

function formatMonth(monthStr) {
    const date = new Date(normalizeReconciliationMonth(monthStr) + '-01T00:00:00Z');
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const bengaliMonths = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
        'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

    return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()} / ${bengaliMonths[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Format date and time
 */
function formatDateTime(dateTime) {
    if (!dateTime) return 'N/A';
    const date = new Date(dateTime);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

/**
 * Get status in Bengali
 */
function getStatusInBengali(status) {
    const statusMap = {
        'pending': 'অপেক্ষমাণ (Pending)',
        'approved': 'অনুমোদিত (Approved)',
        'rejected': 'প্রত্যাখ্যাত (Rejected)',
        'cancelled': 'বাতিল (Cancelled)',
        'realized': 'প্রাপ্ত (Realized)',
        'partial_deferred': 'আংশিক বকেয়া (Partial Deferred)',
        'deferred': 'বকেয়া (Deferred)'
    };

    return statusMap[status] || status;
}

/**
 * Get advance type in Bengali
 */
function getAdvanceTypeInBengali(type) {
    const typeMap = {
        'self_paid': 'নিজে পরিশোধ (Self Paid)',
        'direct_payment': 'সরাসরি পেমেন্ট (Direct Payment)',
        'adjustment': 'সমন্বয় (Adjustment)',
        'other': 'অন্যান্য (Other)'
    };

    return typeMap[type] || type;
}

module.exports = {
    generateReconciliationReport,
    normalizeReconciliationMonth
};
