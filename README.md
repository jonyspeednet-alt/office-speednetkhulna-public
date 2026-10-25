# Channel Partner Billing System - Speed Net Office

**Project:** Channel Partner Billing Standardization  
**Status:** ✅ 80% Complete (Phase 1-4 Deployed)  
**Production:** 🟢 LIVE & OPERATIONAL

---

## 🎯 Quick Start

### For Developers
```bash
# Clone repository
git clone <repository-url>

# Install dependencies
cd server
npm install

# Start development server
npm run dev
```

### For Production
Production deployment is managed outside this repository. No server addresses, credentials or deploy automation are included here.

Required environment variables include `DEFAULT_RESET_PASSWORD` (temporary password issued by the admin password-reset flow; the employee is forced to change it on first login).

---

## 📚 Documentation

### Quick Links
- **[Current Status](CURRENT_STATUS.md)** - Current project status and progress
- **[Project Summary](PROJECT_COMPLETE_SUMMARY.md)** - Complete project overview
- **[Deployment Guide](PHASE_4_DEPLOYMENT_COMPLETE.md)** - Latest deployment details

### Implementation Guides
- [Phase 1: Database Schema](PHASE_1_IMPLEMENTATION_SUMMARY.md)
- [Phase 2: Billing Separation](PHASE_2_IMPLEMENTATION_SUMMARY.md)
- [Phase 3: Partner Advances](PHASE_3_IMPLEMENTATION_SUMMARY.md)
- [Phase 4: Reconciliation](PHASE_4_IMPLEMENTATION_SUMMARY.md)

### Quick Reference
- [API Quick Reference](PHASE_2_QUICK_REFERENCE.md)
- [Deployment Scripts](deploy-phase4.ps1)

---

## 🚀 Features

### ✅ Implemented (Phase 1-4)

**Accurate Commission Calculation**
- Commission based on realized (actually paid) amounts
- Separate tracking of deferred (unpaid) amounts
- Service period separated from billing period

**Partner Advances**
- Track partner advance payments
- Automatic deduction from commission
- Excel import for bulk operations
- Complete advance history

**Reconciliation Workflow**
- Month-end reconciliation process
- Approval/rejection workflow
- PDF report generation (Bengali + English)
- Auto-reconciliation cron job (5th of each month)
- Data locking after approval

**Audit Trail**
- Complete immutable audit log
- State machine for workflow tracking
- Reconciliation snapshots

### 🔄 Pending (Phase 5)

**Audit Hardening**
- NUMERIC data types for financial calculations
- Database-level immutable audit enforcement
- State machine triggers
- Audit verification tools

---

## 🔌 API Endpoints

### Base URL
```
Production: https://office.speednetkhulna.com/api
Development: http://localhost:5000/api
```

### Commission & Payments
```http
GET  /channel-partners/:resellerId/commission/summary?month=YYYY-MM
POST /channel-partners/:resellerId/commission-generate
GET  /channel-partners/:resellerId/payments?month=YYYY-MM
POST /channel-partners/:resellerId/payments/init
POST /channel-partners/:resellerId/payments/record
POST /channel-partners/:resellerId/payments/bulk
```

### Partner Advances
```http
POST  /channel-partners/:resellerId/advances
POST  /channel-partners/:resellerId/advances/bulk
GET   /channel-partners/:resellerId/advances/pending
GET   /channel-partners/:resellerId/advances/history
POST  /channel-partners/:resellerId/import-partner-advances
PATCH /channel-partners/:resellerId/advances/:id/apply
PATCH /channel-partners/:resellerId/advances/:id/dispute
PATCH /channel-partners/:resellerId/advances/:id/reverse
```

### Reconciliation
```http
POST /channel-partners/:resellerId/reconciliation/initiate
GET  /channel-partners/:resellerId/reconciliation/list
GET  /channel-partners/:resellerId/reconciliation/:id
POST /channel-partners/:resellerId/reconciliation/:id/approve
POST /channel-partners/:resellerId/reconciliation/:id/reject
GET  /channel-partners/:resellerId/reconciliation/:id/report
```

---

## 💡 Usage Examples

### Monthly Workflow

**1. Create Bills (Beginning of Month)**
```javascript
POST /api/channel-partners/1/user-payments/init
{
  "month": "2026-05"
}
```

**2. Record Payments (Throughout Month)**
```javascript
POST /api/channel-partners/1/user-payments/record
{
  "user_id": 123,
  "month": "2026-05",
  "amount_paid": 5000,
  "payment_date": "2026-05-15"
}
```

**3. Record Partner Advances (If Any)**
```javascript
POST /api/channel-partners/1/advances
{
  "user_id": 123,
  "advance_amount": 2000,
  "advance_type": "self_paid",
  "notes": "Partner paid user directly"
}
```

**4. Generate Commission (End of Month)**
```javascript
POST /api/channel-partners/1/commission-generate
{
  "month": "2026-05"
}
```

**5. Initiate Reconciliation (5th of Next Month)**
```javascript
POST /api/channel-partners/1/reconciliation/initiate
{
  "month": "2026-05"
}
```

**6. Approve Reconciliation**
```javascript
POST /api/channel-partners/1/reconciliation/1/approve
{
  "notes": "Approved for payment"
}
```

**7. Download PDF Report**
```javascript
GET /api/channel-partners/1/reconciliation/1/report
```

---

## 🗄️ Database Schema

### Key Tables

**channel_user_payments** (Modified)
- `service_period` - Which month the service covered
- `bill_issued_date` - When the bill was created
- `billing_status` - 'realized', 'partial_deferred', 'deferred'
- `realized_amount` - Amount actually paid
- `deferred_amount` - Amount unpaid

**channel_partner_advances** (New)
- Partner advance payment tracking
- Settlement status management
- Audit trail

**billing_reconciliation_logs** (New)
- Month-end reconciliation records
- Approval workflow tracking
- Snapshot data for audit

**channel_settlement_state_machine** (New)
- Workflow state tracking
- Month locking mechanism

**reseller_financial_audit_log_immutable** (New)
- Append-only audit trail
- Complete transaction history

---

## 🧪 Testing

### Manual Testing Checklist
- [ ] Create monthly bills
- [ ] Record payments (partial and full)
- [ ] Record partner advances
- [ ] Import advances from Excel
- [ ] Generate commission
- [ ] Initiate reconciliation
- [ ] Approve reconciliation
- [ ] Verify month is locked
- [ ] Try to modify locked month (should fail)
- [ ] Download PDF report

### API Testing
```bash
# Health check
curl https://office.speednetkhulna.com/api/health/ready

# Commission summary
curl https://office.speednetkhulna.com/api/channel-partners/1/commission/summary?month=2026-05 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🔧 Troubleshooting

### Common Issues

**PM2 Process Not Starting**
```bash
pm2 logs office-api-a --lines 100
pm2 restart office-api-a
```

**Cannot Modify Locked Month**
```sql
-- Check if month is locked
SELECT * FROM billing_reconciliation_logs 
WHERE reconciliation_month = '2026-05-01' 
AND reconciliation_status = 'approved';
```

**Cron Job Not Running**
```bash
pm2 logs | grep "Reconciliation cron"
```

---

## 📊 Production Status

**Server:** [REDACTED]:${SSH_PORT}  
**Database:** ${DB_NAME}  
**API:** https://office.speednetkhulna.com

**PM2 Processes:**
- ✅ office-api-a - ONLINE
- ✅ office-api-b - ONLINE

**Health:** ✅ OK (db_latency: 1ms)

---

## 🤝 Contributing

### Development Workflow
1. Create feature branch
2. Make changes
3. Test locally
4. Create pull request
5. Deploy to production after approval

### Code Style
- Use ES6+ features
- Follow existing patterns
- Add comments for complex logic
- Update documentation

---

## 📞 Support

### Documentation
- Check [CURRENT_STATUS.md](CURRENT_STATUS.md) for latest status
- See [PROJECT_COMPLETE_SUMMARY.md](PROJECT_COMPLETE_SUMMARY.md) for overview
- Review phase-specific docs for details

### Contact
- **Team:** Speed Net IT
- **Server:** [REDACTED]:${SSH_PORT}
- **Database:** ${DB_NAME}

---

## 📝 License

Proprietary - Speed Net IT

---

## 🎉 Acknowledgments

**Developed by:** Kiro AI Assistant  
**Deployed by:** Speed Net IT Team  
**Project Duration:** May 13-14, 2026  
**Status:** 80% Complete (4 of 5 phases)

---

**Last Updated:** 2026-05-14 10:30 AM (Asia/Dhaka)
