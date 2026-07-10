-- APLICADO en el proyecto live (zyvfamlhlmztliexvmej) el 2026-07-10
-- (migración MCP `clinical_templates_dedupe_updated_at_trigger`).
-- clinical_templates ya tenía on_clinical_templates_updated (misma función
-- private.set_updated_at); la migración clinical_note_engine agregó un trigger
-- duplicado. Este drop deja uno solo. Idempotente (drop if exists).
drop trigger if exists set_clinical_templates_updated_at on public.clinical_templates;
