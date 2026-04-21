BEGIN;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at
  ON public.audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at
  ON public.audit_logs (user_id, created_at DESC);

CREATE OR REPLACE VIEW public.admin_activity_logs AS
SELECT
  al.id,
  al.user_id AS admin_id,
  u.email::text AS admin_email,
  al.action AS action_type,
  al.entity_table AS entity_type,
  al.entity_id::text AS entity_id,
  COALESCE(
    NULLIF(al.metadata ->> 'entityLabel', ''),
    CONCAT(al.entity_table, ':', al.entity_id::text)
  ) AS entity_label,
  COALESCE(al.old_values, '{}'::jsonb) AS old_value,
  COALESCE(al.new_values, '{}'::jsonb) AS new_value,
  COALESCE(al.metadata, '{}'::jsonb) AS metadata,
  al.created_at
FROM public.audit_logs al
LEFT JOIN public.users u ON u.id = al.user_id;

COMMIT;
