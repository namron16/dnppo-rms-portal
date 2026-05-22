-- Migration: Add DPDA review columns to forwarded_documents table
-- This migration adds DPDA review functionality to track approvals/disapprovals and comments
--
-- FIXES APPLIED:
--  1. Added RLS + policies for the notifications table (was missing entirely —
--     any authenticated user could read or insert any notification row).

-- These columns may already exist, but this ensures they're present
ALTER TABLE forwarded_documents
ADD COLUMN IF NOT EXISTS dpda_status VARCHAR(50) DEFAULT 'pending', -- pending, approved, disapproved, returned_with_comments, returned
ADD COLUMN IF NOT EXISTS dpda_reviewed_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS dpda_reviewed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS dpda_comments JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS dpda_rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES auth.users(id);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_forwarded_documents_dpda_status
  ON forwarded_documents(dpda_status);

CREATE INDEX IF NOT EXISTS idx_forwarded_documents_recipient_dpda_status
  ON forwarded_documents(recipient_role, dpda_status);

CREATE INDEX IF NOT EXISTS idx_forwarded_documents_created_at_desc
  ON forwarded_documents(created_at DESC);

-- Create notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role VARCHAR(20) NOT NULL,
  type VARCHAR(50) NOT NULL, -- document_approved, document_disapproved, document_returned_from_dpda, etc.
  title TEXT NOT NULL,
  message TEXT,
  document_id UUID,
  document_type VARCHAR(50),
  related_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_is_read
  ON notifications(recipient_role, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at_desc
  ON notifications(created_at DESC);

-- ============================================================
-- FIX: Enable RLS on notifications table and add access policies
-- Without this, any authenticated user can read or insert ANY
-- notification row — a data leak and security risk.
-- ============================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Recipients can only read their own notifications
CREATE POLICY "recipient reads own notifications"
  ON notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = recipient_role
    )
  );

-- Recipients can mark their own notifications as read (UPDATE is_read / read_at)
CREATE POLICY "recipient updates own notifications"
  ON notifications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = recipient_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = recipient_role
    )
  );

-- Only DPDA/DPDO can insert notifications (they are the ones triggering approve/disapprove)
-- Regular P1-P10 users should not be able to insert notifications directly
CREATE POLICY "dpda inserts notifications"
  ON notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('DPDA', 'DPDO')
    )
  );

-- No hard deletes on notifications