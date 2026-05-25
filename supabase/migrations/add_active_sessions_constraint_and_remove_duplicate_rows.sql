-- Clean up any duplicate rows first
DELETE FROM active_sessions a
USING active_sessions b
WHERE a.role = b.role
  AND a.logged_in_at < b.logged_in_at;

-- Add the unique constraint
ALTER TABLE active_sessions
  ADD CONSTRAINT active_sessions_role_key UNIQUE (role);