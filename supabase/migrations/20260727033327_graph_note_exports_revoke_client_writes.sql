-- ============================================================================
-- Endurecimiento de graph_note_exports: quitar los privilegios de escritura que
-- el default privilege del proyecto concede automáticamente a anon/authenticated.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN
--
-- `20260727000000_graph_note_exports.sql` hace `grant select ... to authenticated`
-- y da por hecho que el cliente queda sin privilegios de escritura. En este
-- proyecto Supabase eso no es cierto: hay un
--   alter default privileges in schema public grant all on tables to anon, authenticated
-- que concede ALL sobre cada tabla NUEVA de `public`. Verificado sobre la base
-- real: `has_table_privilege('authenticated', ..., 'insert')` devolvía true.
--
-- Las escrituras SÍ estaban bloqueadas — por RLS (activado, sin políticas de
-- escritura), que es como se diseñó. No había un agujero explotable: un INSERT
-- como `authenticated` fallaba, y `anon` veía 0 filas porque ninguna política le
-- aplica. Esta migración NO arregla una brecha.
--
-- Lo que hace es dejar de depender de RLS como ÚNICA barrera en la tabla que
-- decide si una nota clínica queda marcada como exportada a la historia clínica.
-- Con el privilegio concedido, cualquier política futura mal escrita (un
-- `for all`, un `using (true)` de más) se convierte en escritura real. Sin el
-- privilegio, no.
--
-- Reclamar trabajos, reportar resultados y mover una consulta a 'exportada' es
-- exclusivo de Graph con service-role. Un cliente autenticado solo LEE el estado
-- de su propia exportación (lo necesita la UI y Supabase Realtime).
--
-- Las tablas hermanas (`graph_windows_users`, `graph_windows_events`) arrastran el
-- mismo default privilege. No se tocan aquí: es una decisión aparte y no forma
-- parte de este cambio.
-- ============================================================================

revoke insert, update, delete, truncate, references, trigger
  on table public.graph_note_exports from anon, authenticated;

-- anon no tiene nada que hacer aquí: ni siquiera leer.
revoke select on table public.graph_note_exports from anon;

-- Lo único que conserva el cliente autenticado (RLS lo acota a sus propias filas).
grant select on table public.graph_note_exports to authenticated;
