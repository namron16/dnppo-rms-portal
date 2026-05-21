-- Migration: Add DPDA review columns to forwarded_documents table
-- This migration adds DPDA review functionality to track approvals/disapprovals and comments

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

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_forwarded_documents_dpda_status 
  ON forwarded_documents(dpda_status);

CREATE INDEX IF NOT EXISTS idx_forwarded_documents_recipient_dpda_status 
  ON forwarded_documents(recipient_role, dpda_status);

CREATE INDEX IF NOT EXISTS idx_forwarded_documents_created_at_desc 
  ON forwarded_documents(created_at DESC);

-- Create table for notifications if it doesn't exist
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
