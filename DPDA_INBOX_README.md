# DPDA Inbox Module - Documentation

## Overview

The DPDA Inbox is a professional document review and approval system designed for Deputy Directors for Administration (DPDA) to manage forwarded files from P1 to P10. This module provides a modern, responsive interface for reviewing, approving, disapproving, and commenting on forwarded documents.

## Features

### Core Functionality

1. **Document Review Dashboard**
   - View all forwarded files in a clean, organized grid/card layout
   - Real-time status indicators (Pending Review, Approved, Disapproved, Returned with Comments, Returned)
   - Priority levels (Low, Medium, High, Urgent)
   - Document type indicators

2. **Advanced Search & Filtering**
   - Search by file title, sender, or notes
   - Filter by sender (P1-P10)
   - Filter by status
   - Filter by priority
   - Sort options: Newest First, Oldest First, Highest Priority, By Sender

3. **Detailed File Review**
   - Modal view with complete document details
   - View main document and all attachments
   - Sender information and date received
   - Document type and priority display

4. **Approval Workflow**
   - **Approve**: Accept the forwarded file with optional notes
   - **Disapprove**: Reject the file with reason and feedback
   - **Add Comments**: Leave detailed comments before forwarding back
   - **Forward Back**: Send document back to sender with DPDA's decision and comments

5. **Status Tracking**
   - Automatic status updates when actions are taken
   - Complete audit trail of DPDA actions
   - Status badges with visual indicators

6. **Notifications**
   - Automatic notifications sent to sender when document is reviewed
   - Different notification types for approval, disapproval, and return

## File Structure

### Pages
- `app/admin/dpda-inbox/page.tsx` - Main DPDA Inbox page

### API Routes
- `app/api/dpda-inbox/route.ts` - Fetch forwarded documents for DPDA
- `app/api/dpda-inbox/[id]/approve/route.ts` - Approve a document
- `app/api/dpda-inbox/[id]/disapprove/route.ts` - Disapprove a document
- `app/api/dpda-inbox/[id]/comment/route.ts` - Add comments to a document
- `app/api/dpda-inbox/[id]/forward-back/route.ts` - Forward document back to sender

### Components
- `components/dpda-inbox/DPDAFilterBar.tsx` - Search, filter, and sort controls
- `components/dpda-inbox/ForwardedFileCard.tsx` - Individual document card
- `components/dpda-inbox/FileDetailsModal.tsx` - Detailed view and action modal
- `components/ui/DPDAStatusBadge.tsx` - Status indicator component
- `components/ui/PriorityBadge.tsx` - Priority indicator component

## Usage

### Accessing the DPDA Inbox

1. Login with a DPDA account
2. Click "DPDA Inbox" in the sidebar under "Management"
3. The inbox displays all forwarded files awaiting DPDA review

### Reviewing a Document

1. **Browse Files**: Scroll through the document list or use filters
2. **View Details**: Click on any file card to open the detailed view modal
3. **Review Content**: 
   - Check file title, sender, and date
   - Review sender's notes
   - Download and view attachments
4. **Take Action**:
   - **Approve**: Click "Approve" button, optionally add notes, click "Confirm"
   - **Disapprove**: Click "Disapprove", add reason and feedback, click "Confirm"
   - **Comment**: Click "Add Comment", type your comment, click "Confirm"
5. **Forward Back**: After taking action, click "Forward Back to Sender" to send the decision

### Filtering & Searching

- **Search Bar**: Type to search by file title, sender, or sender's notes
- **Status Filter**: View documents by their current status
- **Sender Filter**: See files from specific senders (P1-P10)
- **Priority Filter**: Focus on high-priority items
- **Sort Options**: Organize documents by date, priority, or sender

## Database Schema

### forwarded_documents Table (Additional Columns)

| Column | Type | Description |
|--------|------|-------------|
| `dpda_status` | VARCHAR(50) | Current DPDA status: pending, approved, disapproved, returned_with_comments, returned |
| `dpda_reviewed_by` | UUID | ID of the DPDA who reviewed the document |
| `dpda_reviewed_at` | TIMESTAMP | When the DPDA completed their review |
| `dpda_comments` | JSONB | Array of comments/notes from DPDA |
| `dpda_rejection_reason` | TEXT | Reason for disapproval (if applicable) |
| `priority` | VARCHAR(20) | Document priority: low, medium, high, urgent |
| `returned_at` | TIMESTAMP | When the document was forwarded back |
| `returned_by` | UUID | ID of DPDA who forwarded back |

### notifications Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `recipient_role` | VARCHAR(20) | Recipient role (e.g., P1) |
| `type` | VARCHAR(50) | Notification type |
| `title` | TEXT | Notification title |
| `message` | TEXT | Notification message |
| `document_id` | UUID | Related document ID |
| `document_type` | VARCHAR(50) | Type of document |
| `related_id` | UUID | Related forwarded document ID |
| `is_read` | BOOLEAN | Read status |
| `created_at` | TIMESTAMP | Creation timestamp |
| `read_at` | TIMESTAMP | When notification was read |

## Status Flow Diagram

```
Pending Review
     ↓
  (DPDA Review)
  ├─→ Approve → [Ready to Send Back]
  ├─→ Disapprove → [Ready to Send Back]
  └─→ Add Comment → Returned with Comments → [Ready to Send Back]
                              ↓
                        Forward Back
                              ↓
                          Returned
```

## Role-Based Access

- **DPDA/DPDO**: Full access to review, approve, disapprove, and forward back documents
- **P1-P10**: Cannot access this module (access control at page level)
- **Admin**: Cannot access this module (specific to DPDA role)

## API Endpoints

### GET /api/dpda-inbox
Fetch forwarded documents for DPDA review

**Query Parameters:**
- `status` (optional): Filter by dpda_status
- `search` (optional): Search in title and notes
- `sender` (optional): Filter by sender_role
- `priority` (optional): Filter by priority
- `sort` (optional): Sort order (date-desc, date-asc, priority-high, sender)
- `limit` (default: 50): Number of items per page
- `offset` (default: 0): Pagination offset

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "sender_role": "P1",
      "title": "Document Title",
      "status": "pending",
      "dpda_status": "pending",
      "priority": "high",
      "created_at": "2024-01-15T10:00:00Z",
      "forwarded_attachments": [...]
    }
  ],
  "count": 25,
  "total": 25
}
```

### POST /api/dpda-inbox/[id]/approve
Approve a forwarded document

**Request Body:**
```json
{
  "comments": "Document looks good. Approved."
}
```

**Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Document approved successfully"
}
```

### POST /api/dpda-inbox/[id]/disapprove
Disapprove a forwarded document

**Request Body:**
```json
{
  "comments": "Detailed feedback...",
  "reason": "Incomplete information"
}
```

**Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Document disapproved successfully"
}
```

### POST /api/dpda-inbox/[id]/comment
Add a comment to a document

**Request Body:**
```json
{
  "comment": "Please review page 3 more carefully"
}
```

**Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Comment added successfully"
}
```

### POST /api/dpda-inbox/[id]/forward-back
Forward document back to sender

**Response:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Document forwarded back to sender successfully"
}
```

## Styling

The DPDA Inbox uses Tailwind CSS with a professional color scheme:

- **Primary Blue**: #3b82f6 (Actions, active states)
- **Success Green**: #22c55e (Approvals)
- **Danger Red**: #ef4444 (Disapprovals)
- **Warning Amber**: #f59e0b (Pending)
- **Info Blue**: #0ea5e9 (Comments)
- **Neutral Slate**: #64748b (General UI)

## Security Considerations

1. **Role-Based Access Control**: Only DPDA can access this module
2. **RLS Policies**: Database-level security ensures users only see their own inbox
3. **Audit Logging**: All DPDA actions are logged for compliance
4. **User Verification**: Each request is verified against authenticated user

## Performance

- **Pagination**: Documents are paginated (12 per page by default)
- **Indexing**: Database queries optimized with strategic indexes
- **Lazy Loading**: Attachments and details loaded on demand
- **Caching**: Browser caches UI state for smoother experience

## Future Enhancements

1. **Batch Actions**: Approve/disapprove multiple documents at once
2. **Custom Workflows**: Define approval chains and escalation paths
3. **Analytics**: Dashboard with review metrics and trends
4. **Integration**: Email notifications and calendar invitations
5. **Archive**: Separate inbox for reviewed documents
6. **Custom Priority Levels**: Configure priority rules per document type
7. **SLA Tracking**: Monitor review turnaround times

## Troubleshooting

### Documents Not Loading
- Verify DPDA role is correctly assigned
- Check browser console for API errors
- Ensure forwarded_documents table exists and has data

### Notifications Not Appearing
- Verify notifications table exists
- Check if recipient role is correctly set
- Ensure realtime subscriptions are enabled in Supabase

### Actions Not Working
- Verify API routes are correctly deployed
- Check request payload matches API expectations
- Review server logs for error details

## Support

For issues or questions about the DPDA Inbox module, please:
1. Check this documentation
2. Review API response errors
3. Verify database schema and migrations
4. Check server logs and browser console for detailed error messages
