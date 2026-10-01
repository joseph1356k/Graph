#!/usr/bin/env node
// EL CONTRATO DE GRAPH — corre las verificaciones de scripts/verify-*.js y emite un solo veredicto.
// Es el juez de docs/specs/*.md: cada fila de una tabla «| # | Promesa | Juez |» tiene que tener un
// verify-*.js que la juzgue, y cada verify-*.js tiene que ser el juez de alguna fila.
//
//   node scripts/contrato.js                  el contrato entero (es lo que corre `npm test`)
//   node scripts/contrato.js diarizacion      solo los jueces cuyo nombre contenga «diarizacion»:
//                                             sirve para iterar, y NO vale como veredicto
//
// Veredicto (última línea, siempre una de estas):
//   CONTRATO INTACTO: N promesas.
//   CONTRATO ROTO: M promesa(s) incumplida(s). El cambio no puede entrar así.
//   NO SE PUDO JUZGAR: …
// Cuentan como INCUMPLIDAS, además de la que falla:
//   «⧗ PENDIENTE»  la promesa está escrita y todavía no tiene código detrás;
//   «⧗ SIN JUEZ»   la fila está en la spec y ningún verify la juzga: borrar el verify no la retira.
// Una fila retirada se tacha (el enunciado empieza con «~~») y deja de pedir juez.
// «⏭» no es verde ni rojo: el juez no puede correr en esta máquina (sin Postgres…). Se nombra en el
// veredicto, para que un «no se juzgó» no se lea como «se cumple».
//
// Código de salida: 99 si no llegó a juzgar (falta node_modules, un verify que no es juez de ninguna
// fila, un número en dos specs): un «no sé» nunca se disfraza de recuento. Si no, el número de
// promesas incumplidas (0 = intacto).
//
// Cómo se cruza una fila con su juez:
//   - specs nuevas (NNN ≥ 001): el verify imprime una línea por promesa con su número, con
//     scripts/lib/promesas.js. Sin esa línea, la fila sale SIN JUEZ aunque el verify pase.
//   - lo heredado (docs/specs/000-lo-heredado.md): un verify por fila, y la fila vale lo que su
//     código de salida. Son las verificaciones que Graph traía al entrar al monorepo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SPECS = path.join(RAIZ, 'docs', 'specs');
const LIMITE_MS = Number(process.env.CONTRATO_LIMITE_MS) || 120000;
const EN_PARALELO = Number(process.env.CONTRATO_EN_PARALELO) || Math.min(4, os.cpus().length);

const color = (codigo) => (texto) => (process.stdout.isTTY ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
const rojo = color(31);
const verde = color(32);
const ambar = color(33);
const gris = color(90);

function noSePudoJuzgar(motivo, detalles = []) {
  for (const detalle of detalles) console.log(rojo(`  ✘ ${detalle}`));
  if (detalles.length) console.log();
  console.log(rojo(`NO SE PUDO JUZGAR: ${motivo}`));
  process.exit(99);
}

const celdas = (linea) => linea.trim().replace(/^\||\|$/g, '').split('|').map((celda) => celda.trim());
const sinComillas = (texto) => texto.replace(/`/g, '').trim();
const mismoTexto = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

// Las tablas de las specs. «filas»: lo prometido. «fuera»: los verify que NO son del contrato, con
// su porqué (necesitan producción, una base real o un navegador).
function leerSpecs() {
  const filas = [];
  const fuera = new Map();
  if (!fs.existsSync(SPECS)) return { filas, fuera };
  for (const archivo of fs.readdirSync(SPECS).filter((nombre) => nombre.endsWith('.md')).sort()) {
    let tabla = null;
    for (const linea of fs.readFileSync(path.join(SPECS, archivo), 'utf8').split(/\r?\n/)) {
      if (!linea.trim().startsWith('|')) { tabla = null; continue; }
      const c = celdas(linea);
      if (/^#$/.test(c[0]) && /^promesa$/i.test(c[1] || '') && /^juez$/i.test(c[c.length - 1])) { tabla = 'filas'; continue; }
      if (/^fuera del contrato$/i.test(c[0])) { tabla = 'fuera'; continue; }
      if (!tabla || c.every((celda) => /^[-: ]*$/.test(celda))) continue;
      if (tabla === 'fuera') {
        fuera.set(sinComillas(c[0]), c.slice(1).join(' | '));
      } else if (/^\d+$/.test(c[0])) {
        filas.push({
          spec: archivo,
          numero: Number(c[0]),
          enunciado: c.slice(1, -1).join(' | '),
          juez: sinComillas(c[c.length - 1]),
          heredada: archivo.startsWith('000-')
        });
      }
    }
  }
  return { filas, fuera };
}

function correr(juez) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const hijo = spawn(process.execPath, [path.join('scripts', juez)], { cwd: RAIZ, env: process.env });
    let salida = '';
    let colgado = false;
    hijo.stdout.on('data', (trozo) => { salida += trozo; });
    hijo.stderr.on('data', (trozo) => { salida += trozo; });
    // Un verify que no termina es un rojo con nombre, no un portero colgado: el del navegador se
    // quedó nueve minutos esperando el día que se midió esto (2026-09-30).
    const reloj = setTimeout(() => { colgado = true; hijo.kill(); }, LIMITE_MS);
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      resolve({ juez, codigo, colgado, salida, ms: Date.now() - inicio });
    });
  });
}

async function correrTodos(jueces) {
  const resultados = new Map();
  const cola = [...jueces];
  const obrero = async () => {
    for (let juez = cola.shift(); juez; juez = cola.shift()) resultados.set(juez, await correr(juez));
  };
  await Promise.all(Array.from({ length: Math.min(EN_PARALELO, jueces.length) }, obrero));
  return resultados;
}

// Las líneas que imprime scripts/lib/promesas.js: estado y número de promesa.
const MARCA = /^\s*(✔|✘|⧗ PENDIENTE|⏭)\s+(\d+)\s+·\s*(.*)$/u;
const ESTADO = { '✔': 'ok', '✘': 'rota', '⧗ PENDIENTE': 'pendiente', '⏭': 'saltada' };

// El detalle de una marca son las líneas que le siguen, hasta la siguiente marca o una línea vacía.
function marcasDe(resultado) {
  const marcas = new Map();
  let actual = null;
  for (const linea of resultado.salida.split(/\r?\n/)) {
    const m = MARCA.exec(linea);
    if (m) {
      actual = { estado: ESTADO[m[1]], enunciado: m[3], detalle: [] };
      marcas.set(Number(m[2]), actual);
    } else if (!linea.trim()) {
      actual = null;
    } else if (actual && actual.detalle.length < 8) {
      actual.detalle.push(`      ${linea.trim()}`);
    }
  }
  return marcas;
}

const cola = (salida, lineas = 12) => salida.trimEnd().split(/\r?\n/).slice(-lineas).map((linea) => `      ${linea}`).join('\n');

async function main() {
  const filtros = process.argv.slice(2);
  const { filas, fuera } = leerSpecs();
  if (!filas.length) noSePudoJuzgar('ninguna spec de docs/specs/ tiene tabla de promesas «| # | Promesa | Juez |»');
  if (!fs.existsSync(path.join(RAIZ, 'node_modules'))) noSePudoJuzgar('falta node_modules. Corre  npm ci  en services/graph.');

  const vivas = filas.filter((fila) => !fila.enunciado.startsWith('~~'));
  const enDisco = fs.readdirSync(__dirname).filter((nombre) => /^verify-.*\.js$/.test(nombre));

  const errores = [];
  const vistos = new Map();
  for (const fila of filas) {
    if (vistos.has(fila.numero)) errores.push(`la promesa ${fila.numero} está en dos filas: ${vistos.get(fila.numero)} y ${fila.spec}`);
    vistos.set(fila.numero, fila.spec);
  }
  const conFila = new Set(vivas.map((fila) => fila.juez));
  for (const nombre of enDisco) {
    if (conFila.has(nombre) && fuera.has(nombre)) errores.push(`${nombre} es juez de una fila y a la vez está «fuera del contrato»`);
    if (!conFila.has(nombre) && !fuera.has(nombre)) errores.push(`${nombre} no es juez de ninguna fila de docs/specs/*.md ni está en «Fuera del contrato»`);
  }
  for (const nombre of fuera.keys()) {
    if (!enDisco.includes(nombre)) errores.push(`«Fuera del contrato» nombra ${nombre}, que no existe en scripts/`);
  }
  if (errores.length) noSePudoJuzgar(`scripts/ y docs/specs/*.md no cuadran: ${errores.length} problema(s), arriba.`, errores);

  const aJuzgar = vivas.filter((fila) => !filtros.length || filtros.some((filtro) => fila.juez.includes(filtro)));
  if (!aJuzgar.length) noSePudoJuzgar(`ningún juez se llama como «${filtros.join('», «')}»`);
  const jueces = [...new Set(aJuzgar.map((fila) => fila.juez))].filter((nombre) => enDisco.includes(nombre));

  console.log(gris(`juzgando Graph: ${jueces.length} verificaciones, ${EN_PARALELO} a la vez…`));
  const inicio = Date.now();
  const resultados = await correrTodos(jueces);

  // Una marca con un número que ninguna spec promete: el verify juzga algo que nadie escribió.
  const numerosVivos = new Set(vivas.map((fila) => fila.numero));
  const marcas = new Map();
  for (const [juez, resultado] of resultados) {
    marcas.set(juez, marcasDe(resultado));
    for (const numero of marcas.get(juez).keys()) {
      if (!numerosVivos.has(numero)) errores.push(`${juez} juzga la promesa ${numero}, que no es fila de ninguna spec`);
    }
  }
  if (errores.length) noSePudoJuzgar(`scripts/ y docs/specs/*.md no cuadran: ${errores.length} problema(s), arriba.`, errores);

  let rotas = 0;
  const saltadas = [];
  for (const fila of aJuzgar) {
    const etiqueta = `${fila.numero} · ${fila.enunciado}`;
    const resultado = resultados.get(fila.juez);
    const marca = resultado && marcas.get(fila.juez).get(fila.numero);
    if (!resultado) {
      rotas += 1;
      console.log(ambar(`  ⧗ SIN JUEZ ${etiqueta}`));
      console.log(gris(`      la spec nombra ${fila.juez}, que no existe en scripts/`));
    } else if (resultado.colgado) {
      rotas += 1;
      console.log(rojo(`  ✘ ${etiqueta}`));
      console.log(gris(`      ${fila.juez} no terminó en ${LIMITE_MS / 1000} s y se cortó\n${cola(resultado.salida, 6)}`));
    } else if (marca) {
      if (marca.estado !== 'saltada' && !mismoTexto(marca.enunciado, fila.enunciado)) {
        rotas += 1;
        console.log(rojo(`  ✘ ${etiqueta}`));
        console.log(gris(`      ${fila.juez} la juzga con otro enunciado: «${marca.enunciado}». El de la spec es el que vale.`));
      } else if (marca.estado === 'ok') {
        console.log(verde(`  ✔ ${etiqueta}`));
      } else if (marca.estado === 'saltada') {
        saltadas.push(fila.numero);
        console.log(gris(`  ⏭ ${etiqueta}\n${marca.detalle.join('\n')}`));
      } else if (marca.estado === 'pendiente') {
        rotas += 1;
        console.log(ambar(`  ⧗ PENDIENTE ${etiqueta}`));
        console.log(gris(marca.detalle.join('\n')));
      } else {
        rotas += 1;
        console.log(rojo(`  ✘ ${etiqueta}`));
        console.log(gris(marca.detalle.join('\n')));
      }
    } else if (!fila.heredada) {
      rotas += 1;
      console.log(ambar(`  ⧗ SIN JUEZ ${etiqueta}`));
      console.log(gris(`      ${fila.juez} corre, pero no imprime la marca de la promesa ${fila.numero} (scripts/lib/promesas.js)`));
    } else if (resultado.codigo !== 0) {
      rotas += 1;
      console.log(rojo(`  ✘ ${etiqueta}`));
      console.log(gris(`      ${fila.juez} salió con código ${resultado.codigo}\n${cola(resultado.salida)}`));
    } else if (/^\s*⏭/mu.test(resultado.salida)) {
      saltadas.push(fila.numero);
      const motivo = resultado.salida.split(/\r?\n/).find((linea) => /^\s*⏭/u.test(linea)).replace(/^\s*⏭️?\s*/u, '');
      console.log(gris(`  ⏭ ${etiqueta}\n      ${motivo}`));
    } else {
      console.log(verde(`  ✔ ${etiqueta}`));
    }
  }

  // Un verify de una spec nueva que sale mal con todas sus promesas en verde: algo falló fuera de
  // ellas (un require, un proceso que no cerró). No es de ninguna fila, y tampoco es verde.
  for (const [juez, resultado] of resultados) {
    const suyas = aJuzgar.filter((fila) => fila.juez === juez);
    if (resultado.codigo === 0 || resultado.colgado || suyas.some((fila) => fila.heredada)) continue;
    if ([...marcas.get(juez).values()].some((marca) => marca.estado === 'rota' || marca.estado === 'pendiente')) continue;
    rotas += 1;
    console.log(rojo(`  ✘ ${juez} salió con código ${resultado.codigo} sin ninguna promesa rota`));
    console.log(gris(cola(resultado.salida)));
  }

  const lento = [...resultados.values()].sort((a, b) => b.ms - a.ms)[0];
  console.log(gris(`\n${((Date.now() - inicio) / 1000).toFixed(0)} s · el más lento: ${lento.juez} (${(lento.ms / 1000).toFixed(0)} s)`));
  // Lo saltado no entra en la cuenta de lo que se cumple: el número es de lo JUZGADO.
  const juzgadas = aJuzgar.length - saltadas.length;
  const sinJuzgar = saltadas.length ? ` ${saltadas.length} sin juzgar en esta máquina (${saltadas.join(', ')}): no cuentan como cumplidas.` : '';

  if (filtros.length) {
    console.log(ambar(`PARCIAL: ${juzgadas} de ${vivas.length} promesas juzgadas, ${rotas} incumplida(s).${sinJuzgar} No es el veredicto del contrato.`));
    process.exit(Math.min(rotas, 98));
  }
  if (rotas === 0) {
    console.log(verde(`CONTRATO INTACTO: ${juzgadas} promesas.${sinJuzgar}`));
    process.exit(0);
  }
  console.log(rojo(`CONTRATO ROTO: ${rotas} promesa(s) incumplida(s). El cambio no puede entrar así.${sinJuzgar}`));
  process.exit(Math.min(rotas, 98));
}

main().catch((error) => {
  // Nunca un catch mudo: si el juez se cae, dice por qué, y no es un rojo de las promesas.
  for (let e = error; e; e = e.cause) console.error(e.stack || e);
  console.log(rojo('NO SE PUDO JUZGAR: el juez se cayó antes de emitir veredicto.'));
  process.exit(99);
});
