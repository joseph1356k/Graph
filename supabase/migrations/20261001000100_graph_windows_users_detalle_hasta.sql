-- ============================================================================
-- graph_windows_users.detalle_hasta: hasta cuándo hay alguien mirando en vivo a
-- este usuario en el panel de Windows del Provider Studio (spec 001).
--
-- Graph junta las líneas repetidas del log de cada equipo antes de guardarlas.
-- Mientras `detalle_hasta` esté en el futuro, no las junta: quien depura con el
-- panel abierto ve el log entero. La escribe WindowsPanelService.marcarMirando
-- al abrirse el stream, y la lee WindowsTelemetryService con el latido.
--
-- Nula o en el pasado = nadie mira. Añadir la columna no reescribe la tabla.
-- ============================================================================

alter table public.graph_windows_users
  add column if not exists detalle_hasta timestamptz;
