# DPDA Inbox - Deployment Checklist

## Pre-Deployment Phase

### Code Review & Testing
- [ ] Review all created files for syntax errors
- [ ] Verify API endpoints compile without errors
- [ ] Test component rendering in browser
- [ ] Check for console errors/warnings
- [ ] Verify imports are correct
- [ ] Test TypeScript compilation: `npm run build`
- [ ] No build errors or warnings

### File Placement Verification
- [ ] `app/api/dpda-inbox/route.ts` exists
- [ ] `app/api/dpda-inbox/[id]/approve/route.ts` exists
- [ ] `app/api/dpda-inbox/[id]/disapprove/route.ts` exists
- [ ] `app/api/dpda-inbox/[id]/comment/route.ts` exists
- [ ] `app/api/dpda-inbox/[id]/forward-back/route.ts` exists
- [ ] `components/dpda-inbox/DPDAFilterBar.tsx` exists
- [ ] `components/dpda-inbox/ForwardedFileCard.tsx` exists
- [ ] `components/dpda-inbox/FileDetailsModal.tsx` exists
- [ ] `components/ui/DPDAStatusBadge.tsx` exists
- [ ] `components/ui/PriorityBadge.tsx` exists
- [ ] `app/admin/dpda-inbox/page.tsx` exists
- [ ] `components/layout/Sidebar.tsx` updated

### Documentation Check
- [ ] `DPDA_INBOX_README.md` exists
- [ ] `DPDA_INBOX_SETUP.md` exists
- [ ] `DPDA_INBOX_QUICK_REFERENCE.md` exists
- [ ] `DPDA_INBOX_FILE_INDEX.md` exists
- [ ] All documentation is readable
- [ ] No broken links or references

---

## Database Setup Phase

### Supabase Configuration
- [ ] Access Supabase console
- [ ] Navigate to SQL Editor
- [ ] Run migration: `supabase/migrations/add_dpda_inbox_columns.sql`
- [ ] Verify no SQL errors
- [ ] Confirm columns added to `forwarded_documents`:
  - [ ] `dpda_status` column exists
  - [ ] `dpda_reviewed_by` column exists
  - [ ] `dpda_reviewed_at` column exists
  - [ ] `dpda_comments` column exists
  - [ ] `dpda_rejection_reason` column exists
  - [ ] `priority` column exists
  - [ ] `returned_at` column exists
  - [ ] `returned_by` column exists
- [ ] Verify `notifications` table created
- [ ] Verify indexes created:
  - [ ] `idx_forwarded_documents_dpda_status`
  - [ ] `idx_forwarded_documents_recipient_dpda_status`
  - [ ] `idx_forwarded_documents_created_at_desc`
  - [ ] `idx_notifications_recipient_is_read`
  - [ ] `idx_notifications_created_at_desc`

### Sample Data
- [ ] Insert test forwarded documents with `recipient_role = 'DPDA'`
- [ ] Verify data appears in API queries
- [ ] Test with various status values
- [ ] Test with different priority levels

---

## User & Permission Setup

### DPDA User Configuration
- [ ] Identify all DPDA users
- [ ] Update their role in `profiles` table:
  ```sql
  UPDATE profiles SET role = 'DPDA' WHERE user_id IN (...);
  ```
- [ ] Verify role assignment:
  ```sql
  SELECT user_id, display_name, role FROM profiles WHERE role = 'DPDA';
  ```
- [ ] Ensure permissions are set correctly in `auth.tsx`
- [ ] Verify `canApproveReview` permission for DPDA

### Role-Based Access Control
- [ ] DPDA can access `/admin/dpda-inbox`
- [ ] P1-P10 cannot access `/admin/dpda-inbox`
- [ ] Admin cannot access `/admin/dpda-inbox`
- [ ] 403 Forbidden returns for unauthorized users
- [ ] 401 Unauthorized returns for unauthenticated users

---

## Environment Setup

### Environment Variables
- [ ] Verify `NEXT_PUBLIC_SUPABASE_URL` is set
- [ ] Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set
- [ ] No missing environment variables
- [ ] Environment values are correct for environment (dev/prod)

### Build & Deployment
- [ ] Run `npm install` to update dependencies
- [ ] Run `npm run build` to compile
- [ ] No build errors
- [ ] No build warnings
- [ ] Build artifacts are generated
- [ ] Run `npm run dev` locally
- [ ] Test locally in development mode

---

## Local Testing Phase

### Browser Testing
- [ ] Open `http://localhost:3000/admin/dpda-inbox`
- [ ] Login as DPDA user
- [ ] See "DPDA Inbox" in sidebar ✓
- [ ] Click to navigate to inbox ✓
- [ ] Inbox page loads without errors ✓
- [ ] Documents are displayed ✓

### Functionality Testing
- [ ] **List Documents**: Documents appear in grid
- [ ] **Search**: Type in search box, results filter
- [ ] **Filter by Sender**: Select sender, documents filter
- [ ] **Filter by Status**: Select status, documents filter
- [ ] **Filter by Priority**: Select priority, documents filter
- [ ] **Sort**: Try each sort option
- [ ] **Pagination**: Navigate between pages
- [ ] **Click Document**: Modal opens with details
- [ ] **View Attachments**: Click attachment links

### Action Testing
- [ ] **Approve**: Click approve, add comment, confirm
- [ ] **Verify Approve**: Check API response
- [ ] **Check Status**: Document status changed to "approved"
- [ ] **Disapprove**: Click disapprove, add reason, confirm
- [ ] **Verify Disapprove**: Check API response
- [ ] **Check Status**: Document status changed to "disapproved"
- [ ] **Add Comment**: Click add comment, type comment, confirm
- [ ] **Verify Comment**: Comment saved to document
- [ ] **Forward Back**: Click forward back button
- [ ] **Verify Forward**: Document status changed to "returned"

### UI/UX Testing
- [ ] Layout is clean and organized
- [ ] Colors match design spec
- [ ] Typography is readable
- [ ] Buttons are clickable and responsive
- [ ] Hover effects work
- [ ] Transitions are smooth
- [ ] No layout breaks or overlaps
- [ ] Spacing looks consistent
- [ ] Icons display correctly

### Error Handling Testing
- [ ] Try action without documents ✓ (shows empty state)
- [ ] Try search with no results ✓ (shows empty state)
- [ ] Try action and disconnect internet ✓ (shows error)
- [ ] Try action as non-DPDA user ✓ (shows access denied)
- [ ] Try invalid filter ✓ (ignored or defaults)

---

## Mobile Testing

### Responsive Design
- [ ] Test on tablet (portrait)
- [ ] Test on tablet (landscape)
- [ ] Test on phone (portrait)
- [ ] Test on phone (landscape)
- [ ] No broken layouts
- [ ] Buttons are touchable (>44px)
- [ ] Text is readable
- [ ] Forms are usable
- [ ] Modal opens/closes on mobile
- [ ] Pagination works on mobile

### Mobile Functionality
- [ ] Can view documents on mobile ✓
- [ ] Can approve on mobile ✓
- [ ] Can disapprove on mobile ✓
- [ ] Can add comments on mobile ✓
- [ ] Can forward back on mobile ✓

---

## API Testing

### Endpoint Testing
- [ ] GET `/api/dpda-inbox` returns documents
- [ ] Query params work (status, search, sender, priority, sort)
- [ ] Pagination works (limit, offset)
- [ ] POST `/api/dpda-inbox/[id]/approve` returns success
- [ ] POST `/api/dpda-inbox/[id]/disapprove` returns success
- [ ] POST `/api/dpda-inbox/[id]/comment` returns success
- [ ] GET `/api/dpda-inbox/[id]/comment` returns comments
- [ ] POST `/api/dpda-inbox/[id]/forward-back` returns success

### Error Response Testing
- [ ] 401 Unauthorized for unauthenticated
- [ ] 403 Forbidden for non-DPDA
- [ ] 404 Not Found for invalid ID
- [ ] 400 Bad Request for invalid payload
- [ ] 500 Internal Server Error handled gracefully

### Data Validation
- [ ] Empty comments are rejected
- [ ] Missing required fields are rejected
- [ ] Invalid IDs are rejected
- [ ] Unauthorized access is rejected

---

## Notification Testing

### Notification System
- [ ] Check `notifications` table exists
- [ ] Approve creates notification
- [ ] Disapprove creates notification
- [ ] Forward back creates notification
- [ ] Notification has correct recipient_role
- [ ] Notification has correct type
- [ ] Notification has correct document_id
- [ ] Sender receives notification

---

## Performance Testing

### Loading Performance
- [ ] Page loads in <2 seconds
- [ ] API responds in <1 second
- [ ] Modal opens instantly
- [ ] Pagination is quick

### Database Performance
- [ ] Queries use indexes correctly
- [ ] No slow queries (check Supabase dashboard)
- [ ] With 100+ documents, performance is acceptable
- [ ] Indexes are working

### Browser Performance
- [ ] No memory leaks
- [ ] No excessive rerenders
- [ ] DevTools shows <100ms for interactions
- [ ] No console errors or warnings

---

## Security Testing

### Authentication & Authorization
- [ ] Can't access as non-DPDA ✓
- [ ] Can't access as P1-P10 ✓
- [ ] Session verification works ✓
- [ ] Logout clears access ✓

### Data Protection
- [ ] No sensitive data in logs
- [ ] No hardcoded credentials
- [ ] API uses HTTPS only
- [ ] CORS headers are correct

---

## Staging Deployment

### Deploy to Staging
- [ ] Deploy code to staging environment
- [ ] Build succeeds on staging
- [ ] Run all database migrations on staging
- [ ] Create test DPDA user on staging
- [ ] Run smoke tests on staging

### Staging Testing
- [ ] Full functionality test on staging
- [ ] Performance test on staging
- [ ] Load test with multiple concurrent users
- [ ] Database backup test

---

## Pre-Production Phase

### Production Readiness
- [ ] Code review completed
- [ ] All tests passed
- [ ] Documentation reviewed
- [ ] Stakeholders approve deployment
- [ ] Rollback plan documented

### Database Backup
- [ ] Backup of production database created
- [ ] Backup verified and restorable
- [ ] Backup stored securely

---

## Production Deployment

### Go-Live
- [ ] Deploy to production during off-hours
- [ ] Monitor deployment logs
- [ ] Verify all files deployed correctly
- [ ] Verify no deployment errors
- [ ] Run database migration in production
- [ ] Verify schema changes applied

### Post-Deployment Verification
- [ ] Verify DPDA can access inbox
- [ ] Verify documents load correctly
- [ ] Test approval workflow
- [ ] Test notifications
- [ ] Monitor error logs
- [ ] Check performance metrics

---

## Post-Deployment

### User Communication
- [ ] Send announcement to DPDA users
- [ ] Provide quick reference guide link
- [ ] Explain new inbox features
- [ ] Set expectations for workflow
- [ ] Provide support contact info

### Monitoring
- [ ] Monitor error rate in logs
- [ ] Monitor API response times
- [ ] Monitor database performance
- [ ] Check for 500 errors
- [ ] Check for failed API calls
- [ ] Monitor notifications system

### User Support
- [ ] First-day support escalation ready
- [ ] Help desk briefed on new module
- [ ] FAQ prepared
- [ ] Support documentation available
- [ ] Training videos available

### Optimization (First Week)
- [ ] Gather user feedback
- [ ] Fix any reported issues
- [ ] Optimize slow queries if needed
- [ ] Improve error messages if needed
- [ ] Adjust pagination if needed

---

## Success Criteria

### Technical Success
- ✅ All features working as designed
- ✅ No critical errors in logs
- ✅ Performance meets requirements
- ✅ Database queries optimized
- ✅ API endpoints responding correctly
- ✅ Notifications working reliably

### User Success
- ✅ DPDA users can access inbox
- ✅ DPDA users can review documents
- ✅ DPDA users can approve/disapprove
- ✅ DPDA users can forward back
- ✅ Senders receive notifications
- ✅ Workflow is smooth and intuitive

### Business Success
- ✅ Reduces document processing time
- ✅ Improves document traceability
- ✅ Provides audit trail
- ✅ Increases efficiency
- ✅ Users are satisfied
- ✅ No production incidents

---

## Rollback Plan

If critical issues arise:

1. **Immediate**: Disable DPDA Inbox in sidebar
2. **Database**: Restore previous version (if needed)
3. **Communication**: Notify all users
4. **Investigation**: Identify root cause
5. **Fix**: Deploy corrected version
6. **Re-deployment**: Redeploy after fixes

---

## Documentation

### For Administrators
- [ ] `/DPDA_INBOX_SETUP.md` provided
- [ ] Migration instructions clear
- [ ] Troubleshooting guide available
- [ ] Support contacts listed

### For Users
- [ ] `/DPDA_INBOX_QUICK_REFERENCE.md` provided
- [ ] Training materials prepared
- [ ] FAQs documented
- [ ] Support available

### For Developers
- [ ] `/DPDA_INBOX_README.md` provided
- [ ] `/DPDA_INBOX_FILE_INDEX.md` provided
- [ ] Code commented
- [ ] API documented

---

## Sign-Off

- [ ] Project Lead Approval: _________________ Date: _____
- [ ] Tech Lead Approval: __________________ Date: _____
- [ ] QA Approval: ______________________ Date: _____
- [ ] Business Lead Approval: _________________ Date: _____

---

**Deployment Date**: ________________  
**Deployed By**: ________________  
**Deployment Notes**: ________________  

---

**Status**: ✅ READY FOR DEPLOYMENT

All checklist items should be completed before going live.
For questions, refer to the documentation or contact the development team.
