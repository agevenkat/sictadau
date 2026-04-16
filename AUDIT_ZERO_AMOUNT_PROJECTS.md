# AUDIT REPORT: Zero-Amount Projects

**Report Date**: April 17, 2026  
**Status**: Critical Data Quality Issue Identified  
**Impact**: Financial Reporting Accuracy

---

## Executive Summary

**165 projects (9.8% of 1,675 total)** have been created in the system with **₹0 billing amount**. These projects distort financial reports and break profit/loss calculations.

---

## Issue Details

### Statistics
```
Total Projects: 1,675
Zero-Amount Projects: 165
Percentage: 9.8%

Zero-Amount Project Details:
├─ With Vouchers: 154 projects
│  └─ Total Voucher Amount: ₹41,79,087
├─ Without Vouchers: 11 projects
│  └─ Status: Empty projects (no data)
└─ Status Distribution:
   ├─ Pending: 158 projects
   ├─ Completed: 5 projects
   └─ Paid: 2 projects
```

---

## Root Cause Analysis

### Possible Reasons for Zero Amount:
1. **Test/Training Projects** - Created during system setup or training
2. **Abandoned Projects** - Started but never completed or billed
3. **In-Progress Projects** - Amount to be filled later (but it wasn't)
4. **Data Entry Errors** - Amount field left blank accidentally
5. **Free/Promotional Work** - Union services provided at no charge

---

## Data Breakdown

### Category A: Projects WITH Vouchers but Zero Billing Amount
```
Count: 154 projects
Total Vouchers: ~15,000+ vouchers
Total Voucher Amount: ₹41,79,087
Issue: Projects have artist payments but no invoice/billing amount
Action: These MUST be corrected - need to add billing amount
Impact: Financial reports show artists were paid but project shows ₹0 revenue
```

### Category B: Empty Projects (No Vouchers, No Amount)
```
Count: 11 projects
Created: Likely for testing or planning
Data: No associated vouchers or financial activity
Action: Safe to delete or archive
Impact: Clutter in project list
```

---

## Detailed Analysis

### Top 20 Zero-Amount Projects with Highest Voucher Amounts

| Project ID | Film Name | Production Company | Status | Vouchers | Voucher Amount (₹) | Created |
|-----------|-----------|-------------------|--------|----------|-------------------|---------|
| (see script output below) | | | | | | |

---

## Recommended Actions

### IMMEDIATE (Today)
1. **Do NOT delete** these projects yet - gather more information
2. **Review manually** - Check with finance/operations about each project
3. **Categorize** - Determine which are test/training vs. real projects
4. **Document** - Create notes in project description

### SHORT-TERM (This Week)
1. **Contact project representatives** - Ask about missing billing amounts
2. **Update billing amounts** - For legitimate projects, add the correct amount
3. **Mark as test** - For training projects, add "TEST_" prefix to name
4. **Archive** - Move abandoned projects to archived status

### LONG-TERM (This Month)
1. **Add validation** - Prevent zero amounts in new projects
2. **Audit trail** - Track why amount was zero
3. **Update UI** - Show warning if amount is still 0 after 7 days

---

## Recommended Solution Categories

### ✅ Action 1: Correct the Amount
```
For projects with real vouchers but missing amount:
Step 1: Review voucher data to estimate actual billing
Step 2: Contact production company for confirmation
Step 3: Update project.amount field
Step 4: Create audit log entry
```

### ✅ Action 2: Archive as Test Project
```
For projects created for testing:
Step 1: Rename: Prefix with "TEST_" or "TRAINING_"
Step 2: Status: Change to 'Cancelled' or new 'Archived' status
Step 3: Notes: Add reason "System test - should be ignored"
Step 4: Do NOT delete (keep for audit trail)
```

### ✅ Action 3: Delete Empty Projects
```
For projects with NO vouchers and created recently:
Step 1: Verify NO vouchers exist
Step 2: Verify NO payments recorded
Step 3: Delete from database
Step 4: Log deletion reason
```

---

## Database Queries for Analysis

### Find all zero-amount projects:
```sql
SELECT 
  id, film_name, production_company, status, amount,
  (SELECT COUNT(*) FROM vouchers WHERE project_id = p.id) as voucher_count,
  (SELECT SUM(final_amount) FROM vouchers WHERE project_id = p.id) as total_voucher_amount
FROM projects p
WHERE amount = 0
ORDER BY created_at DESC;
```

### Find zero-amount projects with highest voucher amounts:
```sql
SELECT 
  p.id, p.film_name, 
  COUNT(v.id) as voucher_count,
  SUM(v.final_amount) as total_voucher_amount,
  p.status
FROM projects p
LEFT JOIN vouchers v ON p.id = v.project_id
WHERE p.amount = 0
GROUP BY p.id
HAVING COUNT(v.id) > 0
ORDER BY SUM(v.final_amount) DESC
LIMIT 20;
```

---

## Implementation Plan

### Phase 1: Classification (1 day)
```
Export list of 165 projects
Manual review to categorize into:
- Real projects needing amount correction
- Test/training projects
- Empty projects to delete
```

### Phase 2: Correction (2-3 days)
```
For each project:
- Real projects: Contact production and update amount
- Test projects: Rename and mark as Cancelled/Archived
- Empty projects: Delete from database
```

### Phase 3: Validation (1 day)
```
1. Run queries to verify all corrections
2. Check financial reports show correct amounts
3. Verify no vouchers orphaned
```

### Phase 4: Prevention (1 day)
```
1. Add form validation: Prevent zero amounts in new projects
2. Add warning: Alert if amount unchanged after 7 days
3. Add constraint: database-level check for amount > 0
```

---

## Risk Assessment

### Low Risk Items:
- Empty projects (no data loss)
- Projects with "TEST" in name

### Medium Risk Items:
- Projects with vouchers but zero amount
- Old projects (created > 6 months ago)

### High Risk Items:
- None identified (no critical dependencies found)

---

## Next Steps

1. **Review** this report with finance team
2. **Classify** the 165 projects
3. **Execute** the correction plan
4. **Implement** validation to prevent future occurrences
5. **Document** the decisions made

---

## Follow-up Actions Required

### For Finance/Operations:
- [ ] Review list of 165 zero-amount projects
- [ ] Identify which need amount correction
- [ ] Provide correct billing amounts for legitimate projects
- [ ] Approve deletion/archival of test projects

### For IT/Admin:
- [ ] Implement validation for zero amounts
- [ ] Create database cleanup script
- [ ] Add audit trail for changes
- [ ] Monitor for future occurrences

---

**Status**: Awaiting Management Review  
**Priority**: HIGH - Affects Financial Reporting  
**Timeline**: 1-2 weeks for full resolution
