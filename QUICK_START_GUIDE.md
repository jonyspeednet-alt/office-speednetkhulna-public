# 🚀 Quick Start Guide - Channel Partner Reconciliation

**For:** Admins and Finance Team  
**Version:** 1.0  
**Date:** May 14, 2026

---

## 📋 Table of Contents

1. [Monthly Reconciliation Process](#monthly-reconciliation-process)
2. [API Endpoints](#api-endpoints)
3. [Common Tasks](#common-tasks)
4. [Troubleshooting](#troubleshooting)

---

## 🔄 Monthly Reconciliation Process

### Step 1: Initiate Reconciliation (Day 5 of Month)

**Automatic:** Cron job runs at 9:00 AM on 5th of each month  
**Manual:** Use API if needed

```bash
POST /api/channel-partners/:resellerId/reconciliation/initiate
{
  "month": "2026-05"
}
```

**What happens:**
- System calculates gross commission
- Deducts partner advances
- Creates snapshot of all data
- Status: `pending`

---

### Step 2: Review Reconciliation

```bash
GET /api/channel-partners/:resellerId/reconciliation/list?status=pending
```

**Check:**
- ✅ Total realized amount correct?
- ✅ Partner advances accurate?
- ✅ Net commission looks right?
- ✅ All payments included?

---

### Step 3: Download PDF Report

```bash
GET /api/channel-partners/:resellerId/reconciliation/:id/report
```

**Review PDF:**
- Partner information
- Summary (collected, realized, deferred)
- Payment breakdown
- Advance details
- Net commission

---

### Step 4: Approve or Reject

**If everything is correct:**
```bash
POST /api/channel-partners/:resellerId/reconciliation/:id/approve
{
  "notes": "Approved for payment"
}
```

**If there's an issue:**
```bash
POST /api/channel-partners/:resellerId/reconciliation/:id/reject
{
  "reason": "Incorrect advance amount for User Ali"
}
```

---

### Step 5: After Approval

**What happens:**
- ✅ Month is locked
- ✅ PDF report generated
- ❌ Cannot modify payments for that month
- ❌ Cannot add advances for that month

**To make changes:**
1. Reject the reconciliation
2. Fix the data
3. Re-initiate reconciliation
4. Approve again

---

## 🔌 API Endpoints

### Reconciliation

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/reconciliation/initiate` | Start reconciliation |
| GET | `/reconciliation/list` | List all reconciliations |
| GET | `/reconciliation/:id` | Get details |
| POST | `/reconciliation/:id/approve` | Approve and lock |
| POST | `/reconciliation/:id/reject` | Reject with reason |
| GET | `/reconciliation/:id/report` | Download PDF |

### Payments (Protected)

| Method | Endpoint | Protection |
|--------|----------|------------|
| POST | `/user-payments/record` | ❌ Blocked if month approved |
| POST | `/user-payments/bulk` | ❌ Blocked if month approved |

### Advances (Protected)

| Method | Endpoint | Protection |
|--------|----------|------------|
| POST | `/advances` | ❌ Blocked if month approved |
| POST | `/advances/bulk` | ❌ Blocked if month approved |
| GET | `/advances/history` | ✅ Always allowed |

---

## 📝 Common Tasks

### Task 1: Record Partner Advance

**When:** Partner pays a user directly

```bash
POST /api/channel-partners/:resellerId/advances
{
  "user_id": 123,
  "advance_amount": 5000,
  "advance_type": "self_paid",
  "notes": "Partner paid Ali directly"
}
```

**Advance Types:**
- `self_paid` - Partner paid user directly
- `direct_payment` - Direct payment to user
- `adjustment` - Adjustment/correction
- `other` - Other type

---

### Task 2: Import Advances from Excel

**Excel Format:**
```
| User Name | Advance Amount | Advance Type    | Notes              |
|-----------|----------------|-----------------|-------------------|
| Ali       | 5000           | self_paid       | Partner paid user |
| Karim     | 3000           | direct_payment  | Direct payment    |
```

**API Call:**
```bash
POST /api/channel-partners/:resellerId/import-partner-advances
Content-Type: multipart/form-data
Body: 
  - file: advances.xlsx
  - month: 2026-05
```

---

### Task 3: Check Pending Advances

```bash
GET /api/channel-partners/:resellerId/advances/pending
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_name": "Ali",
      "advance_amount": 5000,
      "advance_type": "self_paid",
      "settlement_status": "pending_adjustment"
    }
  ],
  "total_pending": 5000
}
```

---

### Task 4: View Advance History

```bash
GET /api/channel-partners/:resellerId/advances/history?month=2026-05&status=adjusted
```

**Filters:**
- `month` - Filter by month (YYYY-MM)
- `status` - Filter by status (pending_adjustment, adjusted, reversed, disputed)

---

### Task 5: Check Commission Summary

```bash
GET /api/channel-partners/:resellerId/commission/summary?month=2026-05
```

**Response:**
```json
{
  "month": "2026-05",
  "total_collected": 50000,
  "total_realized": 45000,
  "total_deferred": 5000,
  "gross_commission": 4500,
  "partner_advances": 2000,
  "net_commission": 2500,
  "commission_status": "not_generated"
}
```

---

## 🚨 Troubleshooting

### Error: "Month is locked"

**Problem:** Trying to modify data for an approved month

**Solution:**
1. Check reconciliation status:
   ```bash
   GET /api/channel-partners/:resellerId/reconciliation/list
   ```
2. If approved, reject it first:
   ```bash
   POST /api/channel-partners/:resellerId/reconciliation/:id/reject
   {
     "reason": "Need to add missing payment"
   }
   ```
3. Make your changes
4. Re-initiate and approve

---

### Error: "Reconciliation not found"

**Problem:** Reconciliation hasn't been initiated for that month

**Solution:**
```bash
POST /api/channel-partners/:resellerId/reconciliation/initiate
{
  "month": "2026-05"
}
```

---

### Error: "Cannot reconcile future month"

**Problem:** Trying to reconcile a month that hasn't happened yet

**Solution:** Only reconcile past or current months

---

### Cron Job Not Running

**Check:**
```bash
ssh -p ${SSH_PORT} ${DEPLOY_USER}@${PROD_HOST}
pm2 logs office-api-a | grep "Reconciliation Cron"
```

**Verify Schedule:**
- Runs on 5th of each month at 9:00 AM
- Cron expression: `0 9 5 * *`

**Manual Trigger:**
```bash
POST /api/channel-partners/:resellerId/reconciliation/initiate
{
  "month": "2026-05"
}
```

---

### PDF Generation Failed

**Check:**
1. Reports directory exists:
   ```bash
   ls -la ${APP_ROOT}/server/reports/
   ```
2. Permissions correct:
   ```bash
   chmod 755 ${APP_ROOT}/server/reports/
   ```
3. pdfkit installed:
   ```bash
   npm list pdfkit
   ```

---

## 📅 Monthly Checklist

### Day 1-4: Normal Operations
- [ ] Record user payments
- [ ] Record partner advances if any
- [ ] Monitor payment status

### Day 5: Reconciliation Day
- [ ] Check if cron job ran (9:00 AM)
- [ ] Review pending reconciliations
- [ ] Download PDF reports
- [ ] Verify all data

### Day 5-10: Approval Period
- [ ] Review each partner's reconciliation
- [ ] Check for discrepancies
- [ ] Approve or reject
- [ ] Generate final reports

### Day 10+: Post-Approval
- [ ] Process payments to partners
- [ ] Archive PDF reports
- [ ] Monitor for any issues

---

## 🔑 Key Concepts

### Service Period vs Bill Issued Date
- **Service Period:** Which month the service was provided (e.g., May)
- **Bill Issued Date:** When the bill was created (e.g., June 5)
- **Why it matters:** Commission calculated based on service period

### Realized vs Deferred
- **Realized:** Amount actually paid by user
- **Deferred:** Amount still unpaid (বকেয়া)
- **Why it matters:** Commission only on realized amount

### Billing Status
- **realized:** Fully paid
- **partial_deferred:** Partially paid
- **deferred:** Not paid yet

### Partner Advances
- Money partner paid to users directly
- Deducted from partner's commission
- Must be recorded for accurate settlement

### Reconciliation Status
- **pending:** Awaiting approval
- **approved:** Approved and locked
- **rejected:** Rejected, needs fixing

---

## 📞 Support

**Issues or Questions:**
- Check PM2 logs: `pm2 logs office-api-a --lines 100`
- Check database: Connect via psql
- Check API health: `curl https://office.speednetkhulna.com/api/health/ready`

**Documentation:**
- `PROJECT_COMPLETE_SUMMARY.md` - Complete project overview
- `PHASE_4_IMPLEMENTATION_SUMMARY.md` - Reconciliation details
- `PHASE_4_DEPLOYMENT_COMPLETE.md` - Deployment info

---

## ✅ Quick Reference

### Important Dates
- **5th of month:** Auto-reconciliation runs at 9:00 AM
- **5th-10th:** Review and approval period
- **10th+:** Process payments

### Important URLs
- **API:** https://office.speednetkhulna.com/api
- **Health Check:** https://office.speednetkhulna.com/api/health/ready

### Important Commands
```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs office-api-a --lines 100

# Restart if needed
pm2 reload ecosystem.config.js
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-14 10:30 AM (Asia/Dhaka)  
**For Questions:** Contact Speed Net IT Team
