-- ============================================================================
-- "Laboratorio de motores" — el soporte de datos para trabajar EN EQUIPO sobre
-- los motores del cliente Windows. Nace de una restricción concreta: varios
-- desarrolladores prueban contra UNA sola máquina (la del owner), así que el
-- panel de Windows Live deja de ser un visor y pasa a ser el banco de pruebas
-- compartido. Dos cosas hay que poder responder sin preguntarle a nadie:
--
--   1. ¿Qué funciona HOY, por motor?      -> se deriva de graph_windows_events
--                                            (phase = ok|error|skipped) y no
--                                            necesita tabla nueva.
--   2. ¿Qué intentó cada quién y cómo le  -> ESTO sí necesita tabla: es
--      fue?                                  conocimiento humano, no telemetría.
--
-- graph_studio_progress es (2): la bitácora de avances. Un desarrollador pega
-- el contexto de lo que hizo y marca si funcionó. Es deliberadamente prosa
-- libre (`body`) + un veredicto estructurado (`outcome`), porque el valor está
-- en el relato ("probé X, falló por Y") y el veredicto solo sirve para filtrar.
--
-- Mismo régimen de seguridad que graph_windows_*: RLS activado SIN políticas.
-- Ningún cliente toca esto directo; solo el backend Graph con service-role,
-- detrás del mismo gate solo-admin del panel (canManageGlobalWorkflows).
-- ============================================================================

create table if not exists public.graph_studio_progress (
  id bigint generated always as identity primary key,

  -- A qué motor aplica el avance. Es la MISMA clave que las tabs del panel de
  -- logs y que los docs (windowsEngines.js manda). '' = avance general.
  engine text not null default '',

  -- Doc de /studio-docs al que se ancla (id de index.json). '' = sin anclar.
  -- Permite que el lector de un motor muestre los avances de ese motor debajo.
  doc_id text not null default '',

  author_email text not null default '',
  author_name text not null default '',

  title text not null,
  -- El contexto pegado por el desarrollador. Markdown, sin límite práctico.
  body text not null default '',

  -- El veredicto. Es lo que convierte la bitácora en instrumento de medida:
  -- funciono | no_funciono | parcial | en_curso
  outcome text not null default 'en_curso',

  -- Contra qué build se probó. Sin esto un "funcionó" no es reproducible.
  app_version text not null default '',

  -- Etiquetas libres (p.ej. 'sap', 'incognito', 'mismatch') para cruzar
  -- avances que no comparten motor.
  tags text[] not null default '{}',

  created_at timestamptz not null default now()
);
alter table public.graph_studio_progress enable row level security;

-- Listado del panel: lo más nuevo primero, filtrable por motor.
create index if not exists graph_studio_progress_engine_idx
  on public.graph_studio_progress (engine, id desc);
-- Bloque de avances dentro del lector de un doc concreto.
create index if not exists graph_studio_progress_doc_idx
  on public.graph_studio_progress (doc_id, id desc);
create index if not exists graph_studio_progress_created_idx
  on public.graph_studio_progress (created_at desc);
