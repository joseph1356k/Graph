#!/usr/bin/env node
// Juez de las promesas 605, 606 y 607 de
// docs/specs/006-el-asistente-clinico-responde-con-respaldo.md: las métricas del asistente clínico.
//
// Cada métrica tiene su script con sus umbrales (que solo suben, nunca bajan) y su detalle:
//   605  scripts/eval-guideline-retrieval.js   retrieval sobre scripts/fixtures/rag-eval.json
//   606  scripts/eval-assistant-answers.js     respuestas grabadas, buenas y malas a propósito
//   607  scripts/measure-chat-tokens.js        tokens de entrada del chat en consultas típicas
// Este juez los corre y cruza su código de salida con la promesa. Para ver el detalle de una:
//   npm run eval:rag · npm run eval:answers · npm run measure:tokens
//
//   node scripts/verify-asistente-metricas.js
const path = require('path');
const { spawnSync } = require('child_process');
const { promesa, cerrar } = require('./lib/promesas');

const METRICAS = [
  {
    numero: 605,
    enunciado: 'Sobre la evaluación de retrieval, con al menos 300 preguntas, 60 fuera de tema y 40 fuera del corpus: recall@3 de 97 % o más, recall@1 de 90 % o más, MRR de 0,93 o más, ninguna guía en las preguntas fuera de tema, 90 % o más de las preguntas fuera del corpus sin extracto de relevancia alta, búsqueda p95 de 10 ms o menos e índice construido en 300 ms o menos',
    script: 'eval-guideline-retrieval.js',
    resumen: /^\s+(global|fuera del corpus)/
  },
  {
    numero: 606,
    enunciado: 'Sobre al menos 150 respuestas de modelo grabadas: 100 % de las referencias inventadas eliminadas, 95 % o más de las cifras plantadas detectadas, 5 % o menos de falsos positivos del verificador, 100 % de los casos sin respaldo en abstención o con cifras marcadas, 100 % de las salidas rotas sin romper el chat y 100 % de las propuestas de nota sin persistir y respetando la nota firmada',
    script: 'eval-assistant-answers.js',
    resumen: /%\s+\(/
  },
  {
    numero: 607,
    enunciado: 'La mediana de tokens de entrada del chat en una consulta típica es de 6 000 o menos, con una sola llamada al modelo por pregunta',
    script: 'measure-chat-tokens.js',
    resumen: /^\s+global/
  }
];

async function main() {
  for (const metrica of METRICAS) {
    const corrida = spawnSync(process.execPath, [path.join(__dirname, metrica.script)], {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    const salida = `${corrida.stdout || ''}${corrida.stderr || ''}`;
    for (const linea of salida.split(/\r?\n/).filter((texto) => metrica.resumen.test(texto))) {
      console.log(`  ${metrica.script.replace(/\.js$/, '')}: ${linea.trim()}`);
    }
    await promesa(metrica.numero, metrica.enunciado, () => {
      if (corrida.status === 0) return;
      const cola = salida.trimEnd().split(/\r?\n/).slice(-4).join(' · ');
      throw new Error(`${metrica.script} salió con ${corrida.status ?? corrida.signal}: ${cola}`);
    });
    console.log();
  }
  cerrar('verify-asistente-metricas');
}

main();
