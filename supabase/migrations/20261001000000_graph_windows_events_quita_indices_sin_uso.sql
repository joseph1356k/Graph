-- ============================================================================
-- graph_windows_events pierde los dos índices que nadie leía (spec 001).
--
-- YA APLICADA en miracle-app el 2026-10-01, por orden del dueño: la base estaba en
-- 613 MB de los 500 MB del plan y bajó a 536 MB. Este archivo deja escrito lo que
-- se hizo; correrlo otra vez no hace nada.
--
-- Medido ese día (pg_stat_all_indexes, desde que existe la tabla):
--   graph_windows_events_app_idx (email, app_id, id desc)   35 MB   25 lecturas
--   graph_windows_events_run_idx (run_id, id)               22 MB    0 lecturas
--   graph_windows_events_email_idx (email, id desc)         35 MB   21.738 lecturas
--
-- Ninguna consulta de Graph filtra por app_id ni por run_id: WindowsPanelService
-- lee siempre por email + id, y ese índice se queda. Si algún día el panel filtra
-- por corrida, el índice vuelve con su consulta, no antes.
-- ============================================================================

drop index if exists public.graph_windows_events_app_idx;
drop index if exists public.graph_windows_events_run_idx;
