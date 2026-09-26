// Verifica el escudo de privacidad sin red ni base de datos: el corpus dorado
// (recall y precisión por tipo), la gramática de marcadores, el recorrido JSON,
// la restauración exacta, el barrido anti-fuga, el aislamiento entre consultas
// y los modos shadow/enforce del servicio.
//   node scripts/verify-privacy-shield.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ProtectionMap = require('../src/domain/privacy/ProtectionMap');
const tokens = require('../src/domain/privacy/tokens');
const { transformTextOrJson, walkStrings } = require('../src/domain/privacy/jsonWalk');
const { normalizeComparable } = require('../src/domain/privacy/canon');
const { posthocLeakCheck } = require('../src/domain/privacy/identitySection');
const PrivacyShieldService = require('../src/application/use-cases/PrivacyShieldService');
const { withPrivacyScope, lastPrivacyResult } = require('../src/infrastructure/privacy/PrivacyContext');
const { sanitizeMetadata } = require('../src/domain/usage/UsageEvent');

const MIN_RECALL = 0.98;
const MIN_PRECISION = 0.95;

let passed = 0;
function check(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok ${passed}. ${name}`);
  });
}
function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* 1. Corpus dorado                                                     */
/* ------------------------------------------------------------------ */

function runCorpus() {
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'privacidad', 'corpus.json'), 'utf8'));
  const byType = {};
  const bump = (type, field) => {
    byType[type] = byType[type] || { esperados: 0, tapados: 0, falsosPositivos: 0, emitidos: 0 };
    byType[type][field] += 1;
  };
  const fallos = [];

  for (const caso of corpus.casos) {
    const map = new ProtectionMap({ seeds: caso.seeds || [], excludedNames: caso.excluir || [] });
    const protegido = map.protectText(caso.texto);
    const restaurado = map.restoreText(protegido);
    if (restaurado !== caso.texto) fallos.push(`${caso.id}: restore(protect(x)) !== x`);

    const comparable = normalizeComparable(protegido);
    for (const esperado of caso.esperado || []) {
      bump(esperado.type, 'esperados');
      const sigueVisible = comparable.includes(normalizeComparable(esperado.value));
      if (sigueVisible) fallos.push(`${caso.id}: no se tapó «${esperado.value}» → ${protegido}`);
      else bump(esperado.type, 'tapados');
    }
    for (const intacto of caso.noTapar || []) {
      if (!comparable.includes(normalizeComparable(intacto))) {
        fallos.push(`${caso.id}: se tapó de más «${intacto}» → ${protegido}`);
      }
    }
    // Precisión: cada marcador emitido tiene que corresponder a un valor esperado
    // (o a una parte de él: «Juan» dentro de «Juan David Pérez»).
    const esperadosNorm = (caso.esperado || []).map((e) => normalizeComparable(e.value));
    for (const token of tokens.findTokens(protegido)) {
      const surface = map.tokenIndex.get(tokens.formatToken(token.type, token.n, token.k));
      bump(token.type, 'emitidos');
      const surfaceNorm = normalizeComparable(surface || '');
      const cuadra = esperadosNorm.some((e) => e === surfaceNorm || e.includes(surfaceNorm) || surfaceNorm.includes(e));
      if (!cuadra) {
        bump(token.type, 'falsosPositivos');
        fallos.push(`${caso.id}: marcador de más ${token.raw} = «${surface}» en ${protegido}`);
      }
    }
  }

  console.log('\n  tipo               esperados  tapados  recall   emitidos  FP  precisión');
  let totalEsperados = 0;
  let totalTapados = 0;
  let totalEmitidos = 0;
  let totalFP = 0;
  for (const [type, s] of Object.entries(byType)) {
    const recall = s.esperados ? s.tapados / s.esperados : 1;
    const precision = s.emitidos ? (s.emitidos - s.falsosPositivos) / s.emitidos : 1;
    totalEsperados += s.esperados; totalTapados += s.tapados; totalEmitidos += s.emitidos; totalFP += s.falsosPositivos;
    console.log(`  ${type.padEnd(18)} ${String(s.esperados).padStart(9)}  ${String(s.tapados).padStart(7)}  ${recall.toFixed(3)}   ${String(s.emitidos).padStart(8)}  ${String(s.falsosPositivos).padStart(2)}  ${precision.toFixed(3)}`);
  }
  const recall = totalEsperados ? totalTapados / totalEsperados : 1;
  const precision = totalEmitidos ? (totalEmitidos - totalFP) / totalEmitidos : 1;
  console.log(`  TOTAL              ${String(totalEsperados).padStart(9)}  ${String(totalTapados).padStart(7)}  ${recall.toFixed(3)}   ${String(totalEmitidos).padStart(8)}  ${String(totalFP).padStart(2)}  ${precision.toFixed(3)}`);
  for (const fallo of fallos) console.log(`  ✘ ${fallo}`);
  return { recall, precision, fallos, casos: corpus.casos.length };
}

async function main() {
  section('1 · Corpus dorado');
  const corpus = runCorpus();
  await check(`el corpus tiene ≥60 casos (${corpus.casos})`, () => assert.ok(corpus.casos >= 60));
  await check(`recall ≥ ${MIN_RECALL} (${corpus.recall.toFixed(3)})`, () => assert.ok(corpus.recall >= MIN_RECALL, corpus.fallos.join('\n')));
  await check(`precisión ≥ ${MIN_PRECISION} (${corpus.precision.toFixed(3)})`, () => assert.ok(corpus.precision >= MIN_PRECISION, corpus.fallos.join('\n')));
  await check('ningún caso se tapó de más ni perdió la restauración exacta', () => assert.deepStrictEqual(corpus.fallos, []));

  section('2 · Gramática de marcadores');
  await check('acepta las variantes que escriben los modelos, con corchetes', () => {
    const found = tokens.findTokens('[PACIENTE_NOMBRE_01] [paciente nombre 2] **[PATIENT_NAME_3]** [DOCUMENTO_1_2] [Phone Number 4]');
    assert.deepStrictEqual(found.map((t) => [t.type, t.n, t.k]), [
      ['PACIENTE_NOMBRE', 1, 1], ['PACIENTE_NOMBRE', 2, 1], ['PACIENTE_NOMBRE', 3, 1], ['DOCUMENTO', 1, 2], ['TELEFONO', 4, 1]
    ]);
  });
  await check('con corchetes también las formas cortas y los sinónimos que abrevia el modelo', () => {
    const found = tokens.findTokens('[PACIENTE_1] [NOMBRE_2] [Cédula 1] [DOC_3] [TEL_1] [CELULAR_2] [DIR_1] [NOMBRE_DEL_PACIENTE_4]');
    assert.deepStrictEqual(found.map((t) => `${t.type}_${t.n}`), [
      'PACIENTE_NOMBRE_1', 'PACIENTE_NOMBRE_2', 'DOCUMENTO_1', 'DOCUMENTO_3', 'TELEFONO_1', 'TELEFONO_2', 'DIRECCION_1', 'PACIENTE_NOMBRE_4'
    ]);
    assert.strictEqual(tokens.findTokens('[id_1] [nota 1] [Anexo 2]').length, 0, 'lo que no nombra un tipo no es un marcador');
  });
  await check('un marcador deformado sin corchetes no se adivina pero se cuenta', () => {
    assert.strictEqual(tokens.countDeformedTokens('Paciente PACIENTE NOMBRE 1, DOCUMENTO 2, ver PACIENTE_1'), 3);
    assert.strictEqual(tokens.countDeformedTokens('se revisó el documento 1 del expediente'), 0, 'la prosa en minúsculas no cuenta');
    assert.strictEqual(tokens.countDeformedTokens('PACIENTE_NOMBRE_1 y [DOCUMENTO_1]'), 0, 'los válidos ya se restauraron o ya se contaron');
    const map = new ProtectionMap({});
    map.protectText('la paciente se llama Rosa Elena Díaz');
    assert.strictEqual(map.restoreText('Nombre: [PACIENTE_1]'), 'Nombre: Rosa Elena Díaz');
    assert.strictEqual(map.restoreText('Nombre: PACIENTE NOMBRE 1'), 'Nombre: PACIENTE NOMBRE 1');
    assert.strictEqual(map.summary().unknownTokens, 1, 'la nota tiene que avisar, no decir que todo se resolvió');
  });
  await check('sin corchetes solo la forma exacta: «el documento 1 dice» no es un marcador', () => {
    assert.strictEqual(tokens.findTokens('el documento 1 dice que Documento_1 tampoco').length, 0);
    assert.strictEqual(tokens.findTokens('valor DOCUMENTO_1 aquí').length, 1);
  });
  await check('en la casilla de identificación un alias se lleva a la forma principal', () => {
    assert.strictEqual(tokens.normalizeIdentityAliases('Nombre: [PACIENTE_NOMBRE_1_3]\nDocumento: [DOCUMENTO_1_2]'), 'Nombre: [PACIENTE_NOMBRE_1]\nDocumento: [DOCUMENTO_1]');
    assert.strictEqual(tokens.normalizeIdentityAliases('{"content":"Nombre: [PACIENTE_NOMBRE_1_3]"}'), '{"content":"Nombre: [PACIENTE_NOMBRE_1]"}');
    assert.strictEqual(tokens.normalizeIdentityAliases('don [PACIENTE_NOMBRE_1_3] siga'), 'don [PACIENTE_NOMBRE_1_3] siga');
  });

  section('3 · Mapa de protección');
  await check('mismo valor ⇒ mismo marcador; formas distintas ⇒ alias de la misma entidad', () => {
    const map = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Juan David Pérez' }] });
    const out = map.protectText('Juan David Pérez llegó; don Juan se sentó; JUAN DAVID PÉREZ firmó; Juan salió.');
    assert.strictEqual(out, '[PACIENTE_NOMBRE_1] llegó; don [PACIENTE_NOMBRE_1_2] se sentó; [PACIENTE_NOMBRE_1_3] firmó; [PACIENTE_NOMBRE_1_2] salió.');
    assert.strictEqual(map.entities.length, 1);
  });
  await check('restaura exactamente la forma tapada, incluida la cédula con guiones del dictado', () => {
    const map = new ProtectionMap({ seeds: [{ type: 'DOCUMENTO', value: 'CC 2345677543' }] });
    const texto = 'cédula 23-45-67-75-43 y también 2345677543';
    const out = map.protectText(texto);
    assert.strictEqual(out, 'cédula [DOCUMENTO_1_2] y también [DOCUMENTO_1_3]');
    assert.strictEqual(map.restoreText(out), texto);
  });
  await check('un marcador que este mapa no emitió se deja visible y se cuenta', () => {
    const map = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Ana Ruiz' }] });
    map.protectText('paciente Ana Ruiz');
    const out = map.restoreText('[PACIENTE_NOMBRE_1] y [PACIENTE_NOMBRE_7] y [DOCUMENTO_1]');
    assert.strictEqual(out, 'Ana Ruiz y [PACIENTE_NOMBRE_7] y [DOCUMENTO_1]');
    assert.strictEqual(map.summary().unknownTokens, 2);
  });
  await check('restauración JSON-aware: un valor con comillas no rompe el objeto', () => {
    const map = new ProtectionMap({ seeds: [{ type: 'DIRECCION', value: 'Calle 1 "La Loma" # 2-3' }] });
    map.protectText('Dirección: Calle 1 "La Loma" # 2-3');
    const raw = JSON.stringify({ texto: 'vive en [DIRECCION_1]' });
    const restored = map.restoreText(raw, { json: true });
    assert.strictEqual(JSON.parse(restored).texto, 'vive en Calle 1 "La Loma" # 2-3');
  });
  await check('idempotente: proteger dos veces no corrompe los marcadores', () => {
    const map = new ProtectionMap({});
    const once = map.protectText('se llama Pedro Páez, cédula 1023456789');
    assert.strictEqual(map.protectText(once), once);
  });
  await check('barrido anti-fuga: repara una semilla que siguió visible', () => {
    const map = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Marta Gil Roca' }] });
    const leaks = map.leakScan('texto con Marta Gil Roca visible');
    assert.strictEqual(leaks.length, 1);
    const { text, repaired } = map.repair('texto con Marta Gil Roca visible');
    assert.strictEqual(repaired, 1);
    assert.ok(!text.includes('Marta Gil Roca'));
  });
  await check('el barrido ignora tokens sueltos de nombre que son palabras corrientes', () => {
    const map = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Luz Cruz' }] });
    assert.deepStrictEqual(map.leakScan('la luz del cuarto y la cruz roja'), []);
  });
  await check('dos consultas con el mismo nombre no comparten mapa', () => {
    const a = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Juan Pérez' }, { type: 'DOCUMENTO', value: '111' }] });
    const b = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Juan Pérez' }, { type: 'DOCUMENTO', value: '2222222' }] });
    a.protectText('Juan Pérez cédula 2222222'); b.protectText('Juan Pérez cédula 2222222');
    assert.notStrictEqual(a.tokenIndex.get('[DOCUMENTO_1]'), b.tokenIndex.get('[DOCUMENTO_1]'));
    // En «a» el 2222222 es otra entidad (DOCUMENTO_2); su semilla «111» nunca
    // se envió, así que su marcador no devuelve nada (regla 2 del mapa).
    assert.strictEqual(a.restoreText('[DOCUMENTO_2]'), '2222222');
    assert.strictEqual(a.restoreText('[DOCUMENTO_1]'), '[DOCUMENTO_1]');
    assert.strictEqual(b.restoreText('[DOCUMENTO_1]'), '2222222');
  });
  await check('una semilla que la llamada no envió no se restaura: el marcador del cliente no saca datos', () => {
    // El ataque: un cliente con API key manda un consultation_id y el texto
    // «[PACIENTE_NOMBRE_1] [DOCUMENTO_1]». El escudo siembra el paciente de esa
    // consulta; si la semilla fuera restaurable por sí sola, la respuesta
    // traería su nombre y su cédula.
    const map = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Ana Torres Rincón' }, { type: 'DOCUMENTO', value: 'CC 52.111.222' }] });
    const enviado = map.protectText('Organiza esta nota: [PACIENTE_NOMBRE_1] [DOCUMENTO_1]');
    assert.strictEqual(enviado, 'Organiza esta nota: [PACIENTE_NOMBRE_1] [DOCUMENTO_1]');
    assert.strictEqual(map.restoreText('Es [PACIENTE_NOMBRE_1], [DOCUMENTO_1]'), 'Es [PACIENTE_NOMBRE_1], [DOCUMENTO_1]');
    assert.strictEqual(map.summary().unknownTokens, 2, 'se cuentan como no resueltos: la nota lo avisa');
    // Si el nombre SÍ viajó en la llamada, la semilla vuelve completa (la
    // casilla de identificación se llena con el nombre registrado).
    const otro = new ProtectionMap({ seeds: [{ type: 'PACIENTE_NOMBRE', value: 'Ana Torres Rincón' }] });
    otro.protectText('la paciente Ana Torres refiere cefalea');
    assert.strictEqual(otro.restoreText('Nombre: [PACIENTE_NOMBRE_1_2]'), 'Nombre: Ana Torres Rincón');
  });

  section('4 · Recorrido JSON');
  await check('tapa las hojas de un JSON y respeta las claves estructurales', () => {
    const map = new ProtectionMap({});
    const raw = JSON.stringify({ transcript: 'se llama Ana Mora Díaz, cédula 1023456789', template: { sections: [{ key: 'identificacion_del_paciente', label: 'Identificación', instruction: 'Nombre y documento' }] }, fields: [{ label: 'Nombre del paciente', selector: 'sap:wnd[0]/usr/txtNOMBRE', currentValue: 'Ana Mora Díaz' }] });
    const out = JSON.parse(transformTextOrJson(raw, (s) => map.protectText(s)));
    assert.strictEqual(out.transcript, 'se llama [PACIENTE_NOMBRE_1], cédula [DOCUMENTO_1]');
    assert.strictEqual(out.template.sections[0].key, 'identificacion_del_paciente');
    assert.strictEqual(out.fields[0].selector, 'sap:wnd[0]/usr/txtNOMBRE');
    assert.strictEqual(out.fields[0].currentValue, '[PACIENTE_NOMBRE_1]');
  });
  await check('un texto que no es JSON se trata como texto', () => {
    const map = new ProtectionMap({});
    assert.strictEqual(transformTextOrJson('se llama Ana Mora Díaz', (s) => map.protectText(s)), 'se llama [PACIENTE_NOMBRE_1]');
  });
  await check('walkStrings devuelve la misma referencia si nada cambió', () => {
    const value = { a: ['x', { b: 'y' }] };
    assert.strictEqual(walkStrings(value, (s) => s), value);
  });

  section('5 · Chequeo post-hoc de la casilla de identificación');
  await check('marcadores en la casilla ⇒ sin fuga; un nombre real ⇒ fuga', () => {
    const limpio = posthocLeakCheck(JSON.stringify({ sections: [{ key: 'identificacion_del_paciente', content: 'Nombre: [PACIENTE_NOMBRE_1]\nDocumento: [DOCUMENTO_1]' }] }));
    assert.deepStrictEqual([limpio.checked, limpio.leak], [true, false]);
    const prudente = posthocLeakCheck(JSON.stringify({ sections: [{ key: 'identificacion_del_paciente', content: 'Nombre: No referido en la consulta.\nDocumento: No referido en la consulta.' }] }));
    assert.deepStrictEqual([prudente.checked, prudente.leak], [true, false]);
    const fuga = posthocLeakCheck(JSON.stringify({ sections: [{ key: 'identificacion_del_paciente', content: 'Nombre: Juan Pérez\nDocumento: 1023456789' }] }));
    assert.deepStrictEqual([fuga.checked, fuga.leak], [true, true]);
  });

  section('6 · Servicio: modos, ámbito y ledger');
  const encounter = { id: 'enc-1', doctor_id: null, patient_id: '', transcript: 'La paciente se llama María Fernanda López, cédula 1.036.457.892.', note_json: null };
  const payload = () => ({ model: 'x', messages: [{ role: 'system', content: 'Reglas.' }, { role: 'user', content: JSON.stringify({ transcript: encounter.transcript }) }], response_format: { type: 'json_object' } });

  await check('enforce: sale tapado, con la regla de sistema, y vuelve con los datos reales', async () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'enforce' } });
    await withPrivacyScope({ encounter }, async () => {
      const prot = await svc.protectChatPayload(payload(), { feature: 'note_generation' });
      assert.ok(!JSON.stringify(prot.payload).includes('María Fernanda'));
      assert.ok(prot.payload.messages[0].content.includes('PRIVACIDAD'));
      const data = svc.restoreChatResponse({ choices: [{ message: { content: JSON.stringify({ sections: [{ key: 'identificacion_del_paciente', content: 'Nombre: [PACIENTE_NOMBRE_1]\nDocumento: [DOCUMENTO_1]' }] }) } }] }, prot);
      assert.strictEqual(JSON.parse(data.choices[0].message.content).sections[0].content, 'Nombre: María Fernanda López\nDocumento: 1.036.457.892');
      const meta = svc.metadataFor(prot);
      assert.strictEqual(meta.privacyMode, 'enforce');
      assert.strictEqual(meta.privacyLeakScan, 'ok');
      assert.strictEqual(meta.privacyRehydration, 'complete');
      assert.strictEqual(meta.privacyPosthoc, false);
      assert.ok(/PACIENTE_NOMBRE:1/.test(meta.privacyTokens));
      assert.strictEqual(lastPrivacyResult().shielded, true);
    });
  });
  await check('shadow: manda el original y anota lo que taparía', async () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'shadow' } });
    await withPrivacyScope({ encounter }, async () => {
      const original = payload();
      const prot = await svc.protectChatPayload(original, { feature: 'note_generation' });
      assert.strictEqual(prot.payload, original);
      assert.ok(prot.payload.messages[1].content.includes('María Fernanda'));
      const meta = svc.metadataFor(prot);
      assert.strictEqual(meta.privacyMode, 'shadow');
      assert.ok(/PACIENTE_NOMBRE:1/.test(meta.privacyTokens));
      assert.strictEqual(meta.privacyPosthoc, undefined);
    });
  });
  await check('el modo se decide por funcionalidad', () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'shadow', PRIVACY_SHIELD_MODE_NOTE_GENERATION: 'enforce' } });
    assert.strictEqual(svc.modeFor('note_generation'), 'enforce');
    assert.strictEqual(svc.modeFor('asistente'), 'shadow');
    assert.strictEqual(new PrivacyShieldService({ env: {} }).modeFor('x'), 'shadow');
  });
  await check('un modo mal escrito se delata: no cae en silencio a shadow', () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'shadow', PRIVACY_SHIELD_MODE_NOTE_GENERATION: 'enforced', PRIVACY_SHIELD_MODE_ASISTENTE: 'enforce', PRIVACY_SHIELD_MODE_FIELD_MATCHING: '' } });
    assert.deepStrictEqual(svc.invalidModeSettings(), ['PRIVACY_SHIELD_MODE_NOTE_GENERATION']);
    assert.strictEqual(svc.modeFor('note_generation'), 'shadow', 'el valor inválido se ignora');
    assert.strictEqual(svc.describeModes(['note_generation', 'asistente']), 'por defecto shadow · asistente=enforce');
    assert.deepStrictEqual(new PrivacyShieldService({ env: {} }).invalidModeSettings(), []);
  });
  await check('restoreDeep devuelve los datos en TODA la respuesta del runtime, no solo en la nota', async () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'enforce' } });
    await withPrivacyScope({}, async () => {
      const prot = await svc.protectTexts({ transcript: 'la paciente se llama Lucía Andrea Vélez, cédula 1.098.765.432' }, { feature: 'clinical_structuring' });
      assert.ok(!prot.texts.transcript.includes('Lucía'));
      const respuesta = {
        resolved_note_content: 'Paciente [PACIENTE_NOMBRE_1], CC [DOCUMENTO_1].',
        note_updates: [{ section: 'Identificación', text: '[PACIENTE_NOMBRE_1]' }],
        agent_tasks: [{ title: 'Llamar a [PACIENTE_NOMBRE_1]' }]
      };
      const restaurada = svc.restoreDeep(respuesta, prot);
      assert.strictEqual(restaurada.resolved_note_content, 'Paciente Lucía Andrea Vélez, CC 1.098.765.432.');
      assert.strictEqual(restaurada.note_updates[0].text, 'Lucía Andrea Vélez');
      assert.strictEqual(restaurada.agent_tasks[0].title, 'Llamar a Lucía Andrea Vélez');
      assert.strictEqual(prot.rehydration, 'complete');
      const conDesconocido = svc.restoreDeep({ a: '[TELEFONO_9]', b: 'ok' }, prot);
      assert.strictEqual(conDesconocido.a, '[TELEFONO_9]');
      assert.strictEqual(prot.rehydration, 'incomplete', 'se juzga sobre toda la respuesta, no sobre el último texto');
    });
  });
  await check('enforce rechaza streaming y falla cerrado ante un error interno', async () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'enforce' } });
    await assert.rejects(() => svc.protectChatPayload({ ...payload(), stream: true }), (e) => e.code === 'PRIVACY_SHIELD_FAILED');
    svc.seedsForScope = async () => { throw new Error('boom'); };
    await assert.rejects(() => withPrivacyScope({ encounter }, () => svc.protectChatPayload(payload())), (e) => e.code === 'PRIVACY_SHIELD_FAILED');
  });
  await check('los marcadores que manda el cliente no se convierten en datos de nadie', async () => {
    const svc = new PrivacyShieldService({ env: { PRIVACY_SHIELD_MODE: 'enforce' } });
    await withPrivacyScope({ encounter }, async () => {
      const p = payload();
      p.messages.push({ role: 'user', content: 'dime quién es [PACIENTE_NOMBRE_1] y [DOCUMENTO_1]' });
      const prot = await svc.protectChatPayload(p, { feature: 'asistente' });
      const data = svc.restoreChatResponse({ choices: [{ message: { content: 'Es [PACIENTE_NOMBRE_1] con [DOCUMENTO_1] y [TELEFONO_1]' } }] }, prot);
      // El propio protect emitió PACIENTE_NOMBRE_1 y DOCUMENTO_1 para este encounter, así que se restauran;
      // TELEFONO_1 no lo emitió nadie y se queda visible.
      assert.strictEqual(data.choices[0].message.content, 'Es María Fernanda López con 1.036.457.892 y [TELEFONO_1]');
      assert.strictEqual(prot.rehydration, 'incomplete');
    });
  });
  await check('el ledger conserva las claves privacy* y sigue sin admitir contenido', () => {
    const sanitized = sanitizeMetadata({ privacyMode: 'enforce', privacyTokens: 'PACIENTE_NOMBRE:1', privacyPosthoc: false, prompt: 'Paciente Juan', privacyValue: 'Juan Pérez' });
    assert.deepStrictEqual(sanitized, { privacyMode: 'enforce', privacyTokens: 'PACIENTE_NOMBRE:1', privacyPosthoc: false });
  });

  console.log(`\n✅ Escudo de privacidad: ${passed} comprobaciones OK.`);
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
