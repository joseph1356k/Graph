// Supabase REST falso, en memoria, para los arneses que levantan rutas reales.
// Cubre el subconjunto de PostgREST que usan los repositorios: filtros eq/in/
// gte/lt, `or=(and(...),and(...))` de las plantillas, `metadata->>clave`,
// order/limit, insert con `on_conflict` (upsert) y update por filtro.
const crypto = require('crypto');

function parseParams(query) {
  return `${query || ''}`.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=');
    return [pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1))];
  });
}

function valueOf(row, column) {
  const json = column.match(/^(\w+)->>(\w+)$/);
  if (json) return row[json[1]]?.[json[2]];
  return row[column];
}

function matches(row, column, filter) {
  const actual = valueOf(row, column);
  const eq = filter.match(/^eq\.(.*)$/);
  if (eq) return `${actual}` === eq[1];
  const inList = filter.match(/^in\.\((.*)\)$/);
  if (inList) return inList[1].split(',').map((v) => v.trim()).includes(`${actual}`);
  const gte = filter.match(/^gte\.(.*)$/);
  if (gte) return `${actual}` >= gte[1];
  const lt = filter.match(/^lt\.(.*)$/);
  if (lt) return `${actual}` < lt[1];
  throw new Error(`Fake Supabase: filtro no soportado ${column}=${filter}`);
}

function applyFilters(rows, params) {
  let result = rows.slice();
  for (const [name, value] of params) {
    if (name === 'select' || name === 'order' || name === 'limit' || name === 'on_conflict') continue;
    if (name === 'or') {
      const ownerMatch = value.match(/and\(owner_id\.eq\.([^,]+),status\.eq\.active\)/);
      const wantsInstitutional = value.includes('and(scope.eq.institutional,status.eq.active)');
      result = result.filter((row) => {
        const institutional = wantsInstitutional && row.scope === 'institutional' && row.status === 'active';
        const own = ownerMatch && row.owner_id === ownerMatch[1] && row.status === 'active';
        return institutional || own;
      });
      continue;
    }
    if (name === 'id' && /^eq\./.test(value) && !/^eq\.[0-9a-f-]{36}$/i.test(value)) {
      const error = new Error('invalid input syntax for type uuid');
      error.statusCode = 400;
      throw error;
    }
    result = result.filter((row) => matches(row, name, value));
  }
  const orderParam = params.find(([name]) => name === 'order');
  if (orderParam) {
    const [column, direction] = orderParam[1].split(',')[0].split('.');
    result.sort((a, b) => {
      const av = `${valueOf(a, column) ?? ''}`;
      const bv = `${valueOf(b, column) ?? ''}`;
      return (av < bv ? -1 : av > bv ? 1 : 0) * (direction === 'desc' ? -1 : 1);
    });
    if (orderParam[1] === 'is_default.desc,name.asc') {
      result.sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || `${a.name}`.localeCompare(`${b.name}`));
    }
  }
  const limitParam = params.find(([name]) => name === 'limit');
  if (limitParam) result = result.slice(0, Number(limitParam[1]));
  return result;
}

function createFakeSupabase() {
  const tables = {};
  const table = (name) => {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  };
  const rpcHandlers = {};
  const insertOne = (name, row, query) => {
    const now = new Date().toISOString();
    const rows = table(name);
    if (`${query}`.includes('on_conflict') && row.id) {
      const index = rows.findIndex((item) => item.id === row.id);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...row, updated_at: now };
        return { ...rows[index] };
      }
    }
    const stored = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
    rows.push(stored);
    return { ...stored };
  };
  return {
    tables,
    table,
    rpcHandlers,
    isConfigured: () => true,
    async select(name, query) {
      return applyFilters(table(name), parseParams(query)).map((row) => ({ ...row }));
    },
    // PostgREST acepta un lote (un arreglo de filas) en el mismo POST, y el cliente real devuelve
    // la primera: la telemetría de Windows inserta así.
    async insert(name, row, query = '') {
      if (Array.isArray(row)) return row.map((one) => insertOne(name, one, query))[0];
      return insertOne(name, row, query);
    },
    async update(name, query, patch) {
      const params = parseParams(`${query}`.split('&select=')[0]);
      const rows = applyFilters(table(name), params);
      if (rows.length === 0) return null;
      const target = table(name).find((row) => row.id === rows[0].id);
      Object.assign(target, patch, { updated_at: new Date().toISOString() });
      return { ...target };
    },
    // Borra las filas que cumplen el filtro y las devuelve, como PostgREST con
    // `Prefer: return=representation`. Sin filtro no borra: el cliente real tampoco.
    async delete(name, query) {
      const params = parseParams(query).filter(([key]) => key !== 'select');
      if (!params.length) throw new Error('Fake Supabase: delete sin filtro');
      const doomed = new Set(applyFilters(table(name), params));
      const kept = table(name).filter((row) => !doomed.has(row));
      table(name).length = 0;
      table(name).push(...kept);
      return [...doomed].map((row) => ({ ...row }));
    },
    async rpc(fn, args = {}) {
      if (typeof rpcHandlers[fn] === 'function') return rpcHandlers[fn](args);
      return null;
    }
  };
}

module.exports = createFakeSupabase;
