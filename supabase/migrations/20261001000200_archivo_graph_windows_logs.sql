-- ============================================================================
-- archivo.graph_windows_logs: a dónde van los logs de Ü Windows que salen de
-- graph_windows_events (spec 001).
--
-- YA APLICADA en miracle-app el 2026-10-01. Ese día salieron de la tabla 400.235
-- líneas (331.330 de más de 7 días y 68.905 repeticiones de la última semana) y
-- la tabla bajó de 246 MB a 5,6 MB. No se destruyeron: están aquí, en 17 MB.
--
-- Una fila por usuario, instalación y hora, con las líneas de esa hora en un solo
-- texto (un JSON por línea), que Postgres guarda comprimido. Cada línea lleva:
--   id=id · t=created_at (µs) · c=client_at (µs) · p=phase · l=label
--   a=app_id · s=surface_url · w=workflow_id · r=run_id
--   d=detail, solo cuando dice algo más que {tag: phase, text: label}
--
-- El esquema `archivo` no está expuesto por la API. El mantenimiento diario NO
-- escribe aquí: lo que caduca cada día se borra. Para deshacerse del archivo
-- cuando ya no haga falta:  drop table archivo.graph_windows_logs;
-- ============================================================================

create schema if not exists archivo;
revoke all on schema archivo from anon, authenticated;

create table if not exists archivo.graph_windows_logs (
  email text not null,
  install_id text not null default '',
  hora timestamptz not null,
  desde_id bigint not null,
  hasta_id bigint not null,
  filas integer not null,
  lineas text not null,
  archivado_en timestamptz not null default now(),
  primary key (email, install_id, hora, desde_id)
);
alter table archivo.graph_windows_logs enable row level security;
