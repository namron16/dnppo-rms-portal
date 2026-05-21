# DPDA Inbox Installation & Setup Guide

## Quick Start

The DPDA Inbox module is now ready to use. Follow these steps to set it up:

### 1. Database Migration

Run the migration to add necessary columns to your Supabase database:

```sql
-- File: supabase/migrations/add_dpda_inbox_columns.sql
-- Copy and run in Supabase SQL Editor
```

Or use Supabase CLI:
```bash
supabase migration up
```

### 2. Verify DPDA Role

Ensure that users have the `DPDA` role assigned in the `profiles` table:

```sql
UPDATE profiles 
SET role = 'DPDA' 
WHERE id = '<user_id>';
```

### 3. Test Access

1. Login as a user with DPDA role
2. Navigate to the admin panel
3. You should see "DPDA Inbox" in the sidebar under "Management"
4. Click to access the inbox

### 4. Optional: Set Initial Priority

If you want to set priority levels on existing forwarded documents:

```sql
UPDATE forwarded_documents 
SET priority = 'high' 
WHERE created_at > NOW() - INTERVAL '7 days'
AND priority IS NULL;
```

## File Locations

```
app/
├── admin/
│   └── dpda-inbox/
│       └── page.tsx                    # Main page
└── api/
    └── dpda-inbox/
        ├── route.ts                    # List endpoint
        └── [id]/
            ├── approve/route.ts        # Approve action
            ├── disapprove/route.ts     # Disapprove action
            ├── comment/route.ts        # Comment action
            └── forward-back/route.ts   # Forward back action

components/
├── dpda-inbox/
│   ├── DPDAFilterBar.tsx              # Search & filter controls
│   ├── ForwardedFileCard.tsx          # Document card component
│   └── FileDetailsModal.tsx           # Detail view modal
└── ui/
    ├── DPDAStatusBadge.tsx            # Status indicator
    └── PriorityBadge.tsx              # Priority indicator

supabase/
└── migrations/
    └── add_dpda_inbox_columns.sql     # Database schema
```

## Configuration

### Sidebar Navigation

The DPDA Inbox is automatically added to the sidebar for DPDA users. The navigation is defined in:

`components/layout/Sidebar.tsx`

**DPDA Navigation Items:**
```
- Master Documents
- Admin Orders
- Daily Journal
- Organization
- e-Library
- Archive
- DPDA Inbox ← New
```

### Environment Variables

No additional environment variables are required. The module uses existing:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Feature Flags

The module is controlled by user role. Only users with:
- Role: `DPDA` or `DPDO`
- Permission: `canApproveReview`

Can access the inbox.

## Database Schema

### Required Tables

1. **forwarded_documents** (must exist)
   - Already exists in your system
   - New columns added by migration

2. **notifications** (created by migration)
   - Stores approval notifications
   - Automatically created if not exists

3. **profiles** (must exist)
   - Already exists in your system
   - Used for DPDA role verification

### New Columns on forwarded_documents

```sql
ALTER TABLE forwarded_documents ADD COLUMN IF NOT EXISTS:
- dpda_status VARCHAR(50) DEFAULT 'pending'
- dpda_reviewed_by UUID
- dpda_reviewed_at TIMESTAMP
- dpda_comments JSONB DEFAULT '[]'
- dpda_rejection_reason TEXT
- priority VARCHAR(20) DEFAULT 'medium'
- returned_at TIMESTAMP
- returned_by UUID
```

## API Security

All API endpoints include:

1. **Authentication Check**
   - Verifies user is logged in
   - Returns 401 if unauthorized

2. **Authorization Check**
   - Verifies user has DPDA role
   - Returns 403 if not DPDA

3. **Data Validation**
   - Validates request payload
   - Returns 400 if invalid

## Testing

### Test Scenarios

1. **List Documents**
   ```bash
   curl http://localhost:3000/api/dpda-inbox
   ```

2. **Approve Document**
   ```bash
   curl -X POST http://localhost:3000/api/dpda-inbox/[id]/approve \
     -H "Content-Type: application/json" \
     -d '{"comments": "Approved"}'
   ```

3. **Add Comment**
   ```bash
   curl -X POST http://localhost:3000/api/dpda-inbox/[id]/comment \
     -H "Content-Type: application/json" \
     -d '{"comment": "Test comment"}'
   ```

### Manual Testing Checklist

- [ ] Login with DPDA account
- [ ] See "DPDA Inbox" in sidebar
- [ ] Load inbox page without errors
- [ ] See list of forwarded documents
- [ ] Click on a document to view details
- [ ] Test search functionality
- [ ] Test filter by sender
- [ ] Test filter by status
- [ ] Test sort options
- [ ] Try to approve a document
- [ ] Try to disapprove a document
- [ ] Try to add a comment
- [ ] Try to forward back
- [ ] Verify notifications created
- [ ] Test pagination
- [ ] Test responsive design on mobile
- [ ] Verify access denied for non-DPDA users

## Troubleshooting

### Issue: "Only DPDA can access this module"

**Solution:**
- Verify user's role is set to 'DPDA' in profiles table
- Check role is loaded correctly in useAuth hook
- Refresh page after role change

### Issue: No documents appear in inbox

**Solution:**
- Verify forwarded_documents table has data with `recipient_role = 'DPDA'`
- Check recipient_role column values
- Review API response in browser DevTools Network tab
- Check server logs for SQL errors

### Issue: API returns 403 Forbidden

**Solution:**
- Verify user is authenticated
- Check user role is 'DPDA'
- Verify permissions in lib/auth.tsx
- Review server logs for authorization details

### Issue: Notifications not appearing

**Solution:**
- Verify notifications table exists
- Check notifications are being inserted (query table directly)
- Verify recipient_role matches sender_role from forwarded document
- Check Supabase RLS policies for notifications table

### Issue: Styling looks broken

**Solution:**
- Verify Tailwind CSS is configured correctly
- Check tailwind.config.ts includes correct content paths
- Clear Next.js cache: `rm -rf .next`
- Rebuild: `npm run build`

## Performance Optimization

### Database Queries

The module uses strategic indexes:
```sql
CREATE INDEX idx_forwarded_documents_dpda_status
CREATE INDEX idx_forwarded_documents_recipient_dpda_status
CREATE INDEX idx_forwarded_documents_created_at_desc
```

### Pagination

Default: 12 documents per page (configurable in page.tsx)

### Caching

- Client-side: React state caching
- Server-side: Supabase query results
- Browser: CSS and JS file caching

## Monitoring

### Key Metrics to Track

1. **Review Time**: Time from forwarding to DPDA review completion
2. **Approval Rate**: Percentage of documents approved vs disapproved
3. **Load Time**: Page load and API response times
4. **Error Rate**: Failed operations and API errors

### Logging

All actions are logged via `adminLogger`:
- User: DPDA role
- Action: Approved, Disapproved, Forwarded Back
- Document: ID, Title, Sender
- Timestamp: Automatically recorded

## Maintenance

### Regular Tasks

1. **Monthly**: Review log history for issues
2. **Quarterly**: Analyze DPDA workflow metrics
3. **Annually**: Archive old reviewed documents

### Backup

Ensure Supabase backups include:
- forwarded_documents table
- notifications table
- profiles table

## Support Resources

- **Documentation**: [DPDA_INBOX_README.md](./DPDA_INBOX_README.md)
- **Code**: `app/admin/dpda-inbox/page.tsx`
- **API**: `app/api/dpda-inbox/`
- **Components**: `components/dpda-inbox/`

## Next Steps

1. ✅ Run database migration
2. ✅ Assign DPDA role to users
3. ✅ Test module access
4. ✅ Verify all workflows
5. ✅ Monitor for issues
6. 📊 Track metrics
7. 🔄 Optimize based on usage

## Contact

For issues or questions, refer to:
- [DPDA_INBOX_README.md](./DPDA_INBOX_README.md) - Comprehensive documentation
- Supabase console for database issues
- Browser DevTools for frontend issues
- Server logs for backend issues
