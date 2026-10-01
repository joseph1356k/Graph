// Lector del corpus de guías clínicas (knowledge/guias-clinicas/*.md).
//
// Lo comparten el compilador (scripts/build-guideline-corpus.js) y su
// verificación (scripts/verify-guideline-corpus.js). En runtime NO se lee
// Markdown: el índice carga el JSON compilado con `require`, que es lo único
// que Vercel empaqueta sin configuración extra.
//
// Formato de una guía:
//
//   ---
//   id: hta-adultos
//   titulo: Hipertensión arterial en adultos
//   organismo: ESC · MinSalud Colombia
//   anio: 2024
//   fuente: ESC 2024 Guidelines for the management of elevated BP and hypertension
//   especialidades: [medicina_general, medicina_interna, cardiologia]
//   cie10: [I10, I11]
//   palabras_clave: [hipertension, presion arterial, HTA]
//   fecha_revision: 2026-10-01
//   revisado_por:
//   ---
//   > Resumen orientativo …
//   ## Sección
//   texto…
//
// Cada `##` es un fragmento recuperable por separado.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORPUS_DIR = path.join(__dirname, '..', '..', 'knowledge', 'guias-clinicas');
const CORPUS_FILE = path.join(CORPUS_DIR, 'guidelines.corpus.json');
const SYNONYMS_FILE = path.join(CORPUS_DIR, 'sinonimos.json');
const CORPUS_VERSION = 1;

const REQUIRED_FIELDS = Object.freeze(['id', 'titulo', 'organismo', 'anio', 'fuente', 'especialidades', 'palabras_clave']);
const LIST_FIELDS = Object.freeze(['especialidades', 'cie10', 'palabras_clave']);
const MAX_CHUNK_CHARS = 2500;
const MIN_SECTIONS = 2;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SPECIALTY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CIE10_PATTERN = /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?$/;

function parseList(raw) {
  const inner = `${raw || ''}`.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function parseFrontMatter(markdown, filename = '') {
  const text = `${markdown || ''}`.replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error(`${filename}: falta la cabecera --- … --- con los metadatos`);
  }
  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) {
      throw new Error(`${filename}: línea de metadatos sin "clave: valor": ${line}`);
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    meta[key] = LIST_FIELDS.includes(key) ? parseList(value) : value.replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(match[0].length) };
}

function slugify(value) {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Divide el cuerpo por `## Título`. El texto previo (sin blockquotes) es la nota de la guía. */
function splitSections(body) {
  const lines = `${body || ''}`.split('\n');
  const sections = [];
  let current = null;
  const preface = [];
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { titulo: heading[1].trim(), lineas: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lineas.push(line);
    else preface.push(line);
  }
  const nota = preface
    .filter((line) => line.trim().startsWith('>'))
    .map((line) => line.replace(/^>\s?/, '').trim())
    .join(' ')
    .trim();
  return {
    nota,
    secciones: sections
      .map((section) => ({ titulo: section.titulo, texto: section.lineas.join('\n').trim() }))
      .filter((section) => section.texto)
  };
}

function parseGuideline(markdown, filename = '') {
  const { meta, body } = parseFrontMatter(markdown, filename);
  for (const field of REQUIRED_FIELDS) {
    const value = meta[field];
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`${filename}: falta el metadato obligatorio "${field}"`);
    }
  }
  if (!ID_PATTERN.test(meta.id)) {
    throw new Error(`${filename}: id "${meta.id}" debe ser kebab-case ascii`);
  }
  const expectedId = path.basename(filename, '.md');
  if (filename && expectedId !== meta.id) {
    throw new Error(`${filename}: el id "${meta.id}" debe coincidir con el nombre del archivo`);
  }
  const anio = Number(meta.anio);
  if (!Number.isInteger(anio) || anio < 1990 || anio > 2100) {
    throw new Error(`${filename}: anio "${meta.anio}" inválido`);
  }
  for (const specialty of meta.especialidades) {
    if (!SPECIALTY_PATTERN.test(specialty)) {
      throw new Error(`${filename}: especialidad "${specialty}" debe ir en snake_case (como normalizeSpecialtyCode)`);
    }
  }
  for (const code of meta.cie10 || []) {
    if (!CIE10_PATTERN.test(code)) {
      throw new Error(`${filename}: código CIE-10 "${code}" con formato inválido (ej. I10, E11.9)`);
    }
  }
  const { nota, secciones } = splitSections(body);
  if (secciones.length < MIN_SECTIONS) {
    throw new Error(`${filename}: una guía necesita al menos ${MIN_SECTIONS} secciones "##" con texto`);
  }
  const seen = new Set();
  for (const section of secciones) {
    const slug = slugify(section.titulo);
    if (seen.has(slug)) {
      throw new Error(`${filename}: sección repetida "${section.titulo}"`);
    }
    seen.add(slug);
    if (section.texto.length > MAX_CHUNK_CHARS) {
      throw new Error(`${filename}: la sección "${section.titulo}" supera ${MAX_CHUNK_CHARS} caracteres (${section.texto.length}); divídela`);
    }
  }
  return {
    id: meta.id,
    titulo: meta.titulo,
    organismo: meta.organismo,
    anio,
    fuente: meta.fuente,
    especialidades: meta.especialidades,
    cie10: meta.cie10 || [],
    palabras_clave: meta.palabras_clave,
    fecha_revision: meta.fecha_revision || '',
    revisado_por: meta.revisado_por || '',
    nota,
    secciones
  };
}

function listGuidelineFiles(dir = CORPUS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => path.join(dir, name));
}

function sourceHash(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.basename(file));
    hash.update('\n');
    hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** Compila todas las guías del directorio al objeto que se escribe como JSON. */
function buildCorpus(dir = CORPUS_DIR) {
  const files = listGuidelineFiles(dir);
  const guidelines = [];
  const ids = new Set();
  for (const file of files) {
    const guideline = parseGuideline(fs.readFileSync(file, 'utf8'), path.basename(file));
    if (ids.has(guideline.id)) {
      throw new Error(`id repetido: ${guideline.id}`);
    }
    ids.add(guideline.id);
    guidelines.push(guideline);
  }
  return {
    version: CORPUS_VERSION,
    source_hash: sourceHash(files),
    guidelines
  };
}

function readCorpusFile(file = CORPUS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readSynonyms(file = SYNONYMS_FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

module.exports = {
  CORPUS_DIR,
  CORPUS_FILE,
  SYNONYMS_FILE,
  CORPUS_VERSION,
  MAX_CHUNK_CHARS,
  MIN_SECTIONS,
  REQUIRED_FIELDS,
  parseFrontMatter,
  parseGuideline,
  splitSections,
  slugify,
  listGuidelineFiles,
  sourceHash,
  buildCorpus,
  readCorpusFile,
  readSynonyms
};
