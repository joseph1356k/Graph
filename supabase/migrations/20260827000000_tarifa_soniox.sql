-- ============================================================================
-- Tarifa de Soniox (STT en streaming).
--
-- POR QUÉ UNA MIGRACIÓN APARTE. La semilla de tarifas
-- (20260804000000_ai_usage_telemetry.sql) inserta con `on conflict do nothing`,
-- así que añadir una fila allí solo sirve para instalaciones nuevas y para la
-- paridad que comprueba verify-ai-usage-pricing. En una base que ya corrió esa
-- migración, la fila nueva no entra sola: tiene que venir por aquí.
--
-- EL PRECIO. $0.12 por hora de audio en tiempo real = $0.002 por minuto
-- (el async, que este producto no usa, va a $0.10/hora). La tarifa de Soniox
-- ya incluye diarización, timestamps y confianza en el mismo precio, que es
-- justo lo que hace que medir el interrogatorio médico-paciente no cueste un
-- centavo más que no medirlo.
--
-- Fuente: https://soniox.com/pricing (consultada el 2026-08-26).
--
-- Sin esta fila los minutos de transcripción entran al ledger con `cost_usd`
-- nulo y la consola los presenta como "sin tarifa" — el costo por consulta era
-- un suelo, no un total.
-- ============================================================================

insert into public.ai_model_prices
  (provider, model, api_family, version, input_per_mtok, cached_input_per_mtok,
   output_per_mtok, per_minute_usd, source_url, source_captured_at)
values
  ('soniox', 'stt-rt-v5', 'transcription', '2026-08-04',
   null, null, null, 0.002, 'https://soniox.com/pricing', '2026-08-26')
on conflict (provider, model, api_family, version) do nothing;
