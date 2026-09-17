-- ============================================================================
-- Whitelist de voz Live (gpt-realtime) para la app Android
--
-- graph_app_users.realtime_allowed: qué instalaciones pueden pedir un token
-- efímero de sesión Realtime (POST /api/android/realtime/session). Default
-- false: ninguna queda habilitada hasta que un admin la active a mano desde
-- el panel Android del Provider Studio.
--
-- POR QUÉ SE ENDURECE EL PRIVILEGIO Y NO SOLO LA RLS
--
-- La policy "clientes actualizan su instalacion" (20260719120000) es
--   for update to anon, authenticated using (true) with check (true)
-- sin ninguna condición. Si realtime_allowed quedara alcanzada por esa
-- policy, cualquier instalación (con la key publishable, sin sesión de
-- admin) podría hacer PATCH .../graph_app_users?device_id=eq.<cualquiera>
-- con {"realtime_allowed": true} y auto-otorgarse (o otorgarle a otro
-- dispositivo) acceso a voz Live — exactamente el agujero que esta
-- whitelist existe para tapar.
--
-- RLS es row-level: una policy de UPDATE no puede excluir una columna
-- puntual del propio row que sí autoriza. La barrera correcta es de
-- privilegio, columna por columna — mismo principio que
-- 20260727033327_graph_note_exports_revoke_client_writes (no confiar sólo
-- en RLS como única barrera): se revoca el UPDATE de tabla completa que el
-- default privilege del proyecto concede a anon/authenticated, y se vuelve
-- a conceder columna por columna, dejando afuera realtime_allowed. Esa
-- columna sólo la escribe el backend Graph con service-role (bypassa
-- privilegios y RLS) desde AndroidPanelService.setRealtimeAllowed — no se
-- necesitó una función RPC nueva porque el backend ya opera con
-- service-role, igual que el resto de AndroidPanelService.
--
-- El mismo default privilege también concede INSERT de tabla completa, y la
-- policy de insert ("clientes registran su instalacion", 20260719120000) es
-- igual de abierta (with check (true), sin condición) — sin revocar INSERT
-- columna por columna también, cualquiera con la key publishable podía
-- crear una fila NUEVA con {"device_id":"lo-que-sea","realtime_allowed":true}
-- y saltarse el whitelist entero sin pasar por el toggle de admin. Mismo
-- endurecimiento, mismo motivo, para el verbo que faltaba.
-- ============================================================================

alter table public.graph_app_users
  add column realtime_allowed boolean not null default false;

revoke update on table public.graph_app_users from anon, authenticated;
grant update (device_id, display_name, auth_user_id, device_model, app_version, created_at, last_seen_at)
  on public.graph_app_users to anon, authenticated;

revoke insert on table public.graph_app_users from anon, authenticated;
grant insert (device_id, display_name, auth_user_id, device_model, app_version, created_at, last_seen_at)
  on public.graph_app_users to anon, authenticated;
