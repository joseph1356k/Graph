// GATE de paridad del catálogo de tarifas.
//   node scripts/verify-ai-usage-pricing.js
//
// El costo se calcula en Node (src/domain/usage/pricing.js) para no depender de
// la red en el camino crítico, pero la tabla `public.ai_model_prices` existe
// para poder auditarlo y reconstruirlo desde SQL. Dos copias del mismo dato son
// dos copias que pueden separarse: este test exige que no lo hagan.
//
// Se compara contra el ARCHIVO de migración, no contra la base, para que corra
// sin credenciales y falle en CI antes de desplegar.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { RATE_CARDS, PRICING_VERSION } = require('../src/domain/usage/pricing');

const MIGRATION = path.join(
  __dirname, '..', 'supabase', 'migrations', '20260804000000_ai_usage_telemetry.sql'
);

let checks = 0;
function check(label, fn) {
  fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

console.log('Paridad del catálogo de tarifas (código ↔ migración)');

const sql = fs.readFileSync(MIGRATION, 'utf8');

// Extrae las filas del INSERT de semillas. El orden de columnas está fijado en
// la migración; si alguien lo cambia sin tocar esto, el parseo falla y el test
// avisa en vez de comparar en silencio contra la columna equivocada.
const insertBlock = sql.slice(sql.indexOf('insert into public.ai_model_prices'));
const columnsMatch = /\(provider, model, api_family, version, input_per_mtok, cached_input_per_mtok,\s*output_per_mtok, per_minute_usd, source_url, source_captured_at\)/.exec(insertBlock);

check('la migración inserta las columnas en el orden esperado', () => {
  assert.ok(columnsMatch, 'cambió el orden de columnas del INSERT de tarifas: revisa este test');
});

const rowRe = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/g;
const seeded = [];
let match;
while ((match = rowRe.exec(insertBlock)) !== null) {
  const numeric = (raw) => {
    const text = `${raw}`.trim();
    return text === 'null' ? null : Number(text);
  };
  seeded.push({
    provider: match[1],
    model: match[2],
    apiFamily: match[3],
    version: match[4],
    inputPerMTok: numeric(match[5]),
    cachedInputPerMTok: numeric(match[6]),
    outputPerMTok: numeric(match[7]),
    perMinuteUsd: numeric(match[8])
  });
}

check(`la migración trae tarifas sembradas (${seeded.length})`, () => {
  assert.ok(seeded.length > 0, 'no se pudo leer ninguna fila de tarifas de la migración');
});

check('el código y la migración tienen el MISMO número de tarifas', () => {
  assert.strictEqual(
    RATE_CARDS.length, seeded.length,
    `código: ${RATE_CARDS.length}, migración: ${seeded.length}. ` +
    'Añadir una tarifa exige tocar los dos sitios.'
  );
});

function keyOf(entry) {
  return `${entry.provider}|${entry.model}|${entry.apiFamily}`;
}

const seededByKey = new Map(seeded.map((entry) => [keyOf(entry), entry]));

for (const card of RATE_CARDS) {
  check(`coincide ${keyOf(card)}`, () => {
    const row = seededByKey.get(keyOf(card));
    assert.ok(row, `la migración no siembra ${keyOf(card)}`);
    assert.strictEqual(row.version, card.version, 'versión distinta');
    assert.strictEqual(row.inputPerMTok, card.inputPerMTok, 'precio de entrada distinto');
    assert.strictEqual(row.cachedInputPerMTok, card.cachedInputPerMTok, 'precio de caché distinto');
    assert.strictEqual(row.outputPerMTok, card.outputPerMTok, 'precio de salida distinto');
    assert.strictEqual(row.perMinuteUsd, card.perMinuteUsd, 'precio por minuto distinto');
  });
}

check('toda tarifa declara su versión y su fuente', () => {
  for (const card of RATE_CARDS) {
    assert.strictEqual(card.version, PRICING_VERSION, `${keyOf(card)} sin la versión vigente`);
    assert.ok(card.sourceUrl, `${keyOf(card)} sin URL de fuente: no se podría auditar`);
    assert.strictEqual(card.currency, 'USD');
  }
});

check('ninguna tarifa está en cero por descuido', () => {
  for (const card of RATE_CARDS) {
    const tienePrecio = [card.inputPerMTok, card.outputPerMTok, card.perMinuteUsd, card.perRequestUsd]
      .some((value) => typeof value === 'number' && value > 0);
    assert.ok(tienePrecio,
      `${keyOf(card)} no tiene ningún precio > 0. Un cero silencioso oculta gasto real.`);
  }
});

check('no hay tarifas duplicadas para la misma vigencia', () => {
  const seen = new Set();
  for (const card of RATE_CARDS) {
    const key = `${keyOf(card)}|${card.effectiveFrom}`;
    assert.ok(!seen.has(key), `tarifa duplicada: ${key}`);
    seen.add(key);
  }
});

console.log(`\n✅ Catálogo de tarifas: ${checks} comprobaciones OK.`);
