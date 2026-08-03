// Base de datos falsa de propósito general para las pruebas del carril de
// dispositivos y del carril clínico de aparatos.
//
// Implementa el subconjunto de PostgREST que usan WindowsDeviceService,
// ConsultationMirrorService y ConsultationQueryService — más rico que el de
// fakeNoteExportSupabase (que solo filtra por eq.): aquí también viven
// is.null / not.is.null / gt. / in.() / order / limit y update con filtros,
// porque el emparejamiento se decide con esos operadores (CAS de un solo uso,
// vínculo activo, caducidad del código).
//
// Igual que su hermano: existe para probar rutas, auth, validaciones y códigos
// HTTP sin credenciales. La semántica autoritativa de índices parciales y
// carreras se prueba contra Postgres real (verify-device-db.js).
const crypto = require('crypto');

function createFakeClinicalSupabase(initialTables = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(initialTables)) {
    tables[name] = rows.map((row) => ({ ...row }));
  }

  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

  function ensure(table) {
    tables[table] = tables[table] || [];
    return tables[table];
  }

  // `col.op.valor` (la forma que usan or= y and=): "status.eq.active" → condición.
  function parseDottedCondition(text) {
    const first = text.indexOf('.');
    const second = text.indexOf('.', first + 1);
    const col = text.slice(0, first);
    const op = text.slice(first + 1, second);
    const value = text.slice(second + 1);
    if (op === 'eq') return { col, op: 'eq', value };
    if (op === 'is' && value === 'null') return { col, op: 'is-null' };
    throw new Error(`fakeClinicalSupabase: condición no soportada "${text}"`);
  }

  // Parte por comas del nivel superior, respetando paréntesis: "a,and(b,c)" → ["a","and(b,c)"].
  function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
      current += ch;
    }
    if (current) parts.push(current);
    return parts;
  }

  // or=(and(a.eq.x,b.eq.y),c.eq.z) → [[condA,condB],[condC]] (cada rama es un AND).
  function parseOrBranches(raw) {
    const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw;
    return splitTopLevel(inner).map((branch) => {
      const clean = branch.trim();
      if (clean.startsWith('and(') && clean.endsWith(')')) {
        return splitTopLevel(clean.slice(4, -1)).map((cond) => parseDottedCondition(cond.trim()));
      }
      return [parseDottedCondition(clean)];
    });
  }

  // query string → { filters, order, limit, onConflict }
  function parseQuery(query) {
    const parsed = { filters: [], order: null, limit: null, onConflict: null };
    for (const pair of `${query || ''}`.split('&').filter(Boolean)) {
      const eq = pair.indexOf('=');
      const name = decodeURIComponent(pair.slice(0, eq));
      const raw = decodeURIComponent(pair.slice(eq + 1));
      if (name === 'select' || name === 'offset') continue;
      if (name === 'limit') { parsed.limit = Number(raw) || null; continue; }
      if (name === 'on_conflict') { parsed.onConflict = raw; continue; }
      if (name === 'or') { parsed.filters.push({ op: 'or', branches: parseOrBranches(raw) }); continue; }
      if (name === 'order') {
        // Soporta varias claves: "is_default.desc,name.asc".
        parsed.order = raw.split(',').map((part) => {
          const dot = part.lastIndexOf('.');
          const dir = part.slice(dot + 1);
          return dir === 'asc' || dir === 'desc'
            ? { col: part.slice(0, dot), desc: dir === 'desc' }
            : { col: part, desc: false };
        });
        continue;
      }
      if (raw === 'is.null') parsed.filters.push({ col: name, op: 'is-null' });
      else if (raw === 'not.is.null') parsed.filters.push({ col: name, op: 'not-null' });
      else if (raw.startsWith('eq.')) parsed.filters.push({ col: name, op: 'eq', value: raw.slice(3) });
      else if (raw.startsWith('gt.')) parsed.filters.push({ col: name, op: 'gt', value: raw.slice(3) });
      else if (raw.startsWith('gte.')) parsed.filters.push({ col: name, op: 'gte', value: raw.slice(4) });
      else if (raw.startsWith('lt.')) parsed.filters.push({ col: name, op: 'lt', value: raw.slice(3) });
      else if (raw.startsWith('in.(')) {
        parsed.filters.push({ col: name, op: 'in', values: raw.slice(4, -1).split(',').map((v) => decodeURIComponent(v)) });
      } else {
        throw new Error(`fakeClinicalSupabase: operador no soportado en "${pair}"`);
      }
    }
    return parsed;
  }

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.op === 'or') {
        return filter.branches.some((branch) => branch.every((cond) => matches(row, [cond])));
      }
      const value = row[filter.col];
      if (filter.op === 'is-null') return value == null;
      if (filter.op === 'not-null') return value != null;
      if (filter.op === 'eq') return `${value ?? ''}` === `${filter.value}`;
      if (filter.op === 'gt') return `${value ?? ''}` > `${filter.value}`;
      if (filter.op === 'gte') return `${value ?? ''}` >= `${filter.value}`;
      if (filter.op === 'lt') return `${value ?? ''}` < `${filter.value}`;
      if (filter.op === 'in') return filter.values.some((v) => `${value ?? ''}` === `${v}`);
      return false;
    });
  }

  async function select(table, query) {
    const { filters, order, limit } = parseQuery(query);
    let rows = ensure(table).filter((row) => matches(row, filters));
    if (order) {
      rows = [...rows].sort((a, b) => {
        for (const key of order) {
          const left = `${a[key.col] ?? ''}`;
          const right = `${b[key.col] ?? ''}`;
          const cmp = key.desc ? right.localeCompare(left) : left.localeCompare(right);
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }
    if (limit) rows = rows.slice(0, limit);
    return clone(rows);
  }

  async function insert(table, row, query = '') {
    const { onConflict } = parseQuery(query);
    const rows = ensure(table);
    if (onConflict) {
      const existing = rows.find((r) => `${r[onConflict]}` === `${row[onConflict]}`);
      if (existing) return clone(existing);
    }
    // Índices unique reales que el servicio espera que la base haga cumplir.
    if (table === 'graph_windows_devices') {
      if (rows.some((r) => r.device_id === row.device_id || r.token_hash === row.token_hash)) {
        const error = new Error('duplicate key value violates unique constraint');
        error.statusCode = 409;
        error.supabaseCode = '23505';
        throw error;
      }
    }
    if (table === 'graph_device_doctor_links' && row.pairing_code) {
      if (rows.some((r) => r.pairing_code === row.pairing_code)) {
        const error = new Error('duplicate key value violates unique constraint');
        error.statusCode = 409;
        error.supabaseCode = '23505';
        throw error;
      }
    }
    const created = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...row
    };
    rows.push(created);
    return clone(created);
  }

  // Como SupabaseRestClient.update: devuelve la PRIMERA fila afectada, o
  // undefined si el filtro no casó ninguna (así se detecta un CAS perdido).
  async function update(table, query, patch) {
    const { filters } = parseQuery(query);
    const affected = ensure(table).filter((row) => matches(row, filters));
    for (const row of affected) Object.assign(row, patch);
    return affected.length ? clone(affected[0]) : undefined;
  }

  async function rpc(fn) {
    throw new Error(`fakeClinicalSupabase: RPC no soportada (${fn})`);
  }

  return { tables, select, insert, update, rpc };
}

module.exports = { createFakeClinicalSupabase };
