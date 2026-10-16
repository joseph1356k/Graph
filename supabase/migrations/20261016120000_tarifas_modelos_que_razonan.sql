-- ============================================================================
-- Tarifas de gpt-5-mini, gpt-5.6-luna y gpt-6-luna (spec 021).
--
-- POR QUÉ UNA MIGRACIÓN APARTE: la semilla (20260804000000_ai_usage_telemetry.sql)
-- inserta con `on conflict do nothing`; en una base que ya la corrió, las filas
-- nuevas entran por aquí (mismo patrón que 20260827000000_tarifa_soniox.sql).
--
-- EL PRECIO: tarifa estándar de platform.openai.com/docs/pricing, leída el
-- 2026-10-16 (USD por millón de tokens: entrada, entrada cacheada, salida).
-- Sin estas filas, el asistente en uno de estos modelos entraría al ledger con
-- `cost_usd` nulo («sin tarifa»).
-- ============================================================================

insert into public.ai_model_prices
  (provider, model, api_family, version, input_per_mtok, cached_input_per_mtok,
   output_per_mtok, per_minute_usd, source_url, source_captured_at)
values
  ('openai', 'gpt-5-mini',   'chat_completions', '2026-08-04', 0.25, 0.025, 2.00, null, 'https://developers.openai.com/api/docs/pricing', '2026-10-16'),
  ('openai', 'gpt-5.6-luna', 'chat_completions', '2026-08-04', 0.20, 0.02,  1.20, null, 'https://developers.openai.com/api/docs/pricing', '2026-10-16'),
  ('openai', 'gpt-6-luna',   'chat_completions', '2026-08-04', 0.10, 0.01,  0.50, null, 'https://developers.openai.com/api/docs/pricing', '2026-10-16')
on conflict (provider, model, api_family, version) do nothing;
