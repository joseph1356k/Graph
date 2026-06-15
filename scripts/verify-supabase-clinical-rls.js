const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const supabaseUrl = `${process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || ''}`.replace(/\/+$/, '');
const anonKey = `${process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''}`.trim();
const serviceRoleKey = `${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ''}`.trim();

function requireConfig() {
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing Supabase config for RLS verification: ${missing.join(', ')}`);
  }
}

async function supabaseFetch(pathname, init = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = text;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error_description || payload?.error || text || `HTTP ${response.status}`;
    const error = new Error(`${init.method || 'GET'} ${pathname} failed: ${message}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function anonHeaders(accessToken = anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

function serviceHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
  };
}

async function createAnonymousSession() {
  const payload = await supabaseFetch('/auth/v1/signup', {
    method: 'POST',
    headers: anonHeaders(),
    body: JSON.stringify({ data: { testRun: 'clinical-rls' } })
  });
  const accessToken = payload?.access_token || payload?.session?.access_token || '';
  const user = payload?.user || payload?.session?.user || null;
  assert(accessToken, 'anonymous signup must return an access token');
  assert(user?.id, 'anonymous signup must return a user id');
  assert.strictEqual(user.is_anonymous, true, 'test must exercise a Supabase anonymous user');
  return { accessToken, userId: user.id };
}

async function deleteUser(userId) {
  if (!userId) return;
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders()
  }).catch(() => undefined);
}

async function verifyClinicalDemoRls() {
  const suffix = crypto.randomBytes(5).toString('hex');
  const primary = await createAnonymousSession();
  const other = await createAnonymousSession();
  let patientId = '';
  let encounterId = '';

  try {
    const patients = await supabaseFetch('/rest/v1/patients?select=id,name,mrn,owner_id', {
      method: 'POST',
      headers: {
        ...anonHeaders(primary.accessToken),
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        name: `Codex RLS ${suffix}`,
        mrn: `rls-${suffix}`
      })
    });
    patientId = patients?.[0]?.id || '';
    assert(patientId, 'anonymous user must be able to create its own patient');
    assert.strictEqual(patients[0].owner_id, primary.userId, 'patient owner_id must default to auth.uid()');

    const visibleToOwner = await supabaseFetch(`/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}&select=id`, {
      headers: anonHeaders(primary.accessToken)
    });
    assert.strictEqual(visibleToOwner.length, 1, 'patient owner must be able to read its patient');

    const visibleToOtherUser = await supabaseFetch(`/rest/v1/patients?id=eq.${encodeURIComponent(patientId)}&select=id`, {
      headers: anonHeaders(other.accessToken)
    });
    assert.strictEqual(visibleToOtherUser.length, 0, 'another anonymous user must not read the patient');

    const encounters = await supabaseFetch('/rest/v1/encounters?select=id,label,owner_id,patient_id', {
      method: 'POST',
      headers: {
        ...anonHeaders(primary.accessToken),
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        patient_id: patientId,
        label: `Codex RLS Encounter ${suffix}`
      })
    });
    encounterId = encounters?.[0]?.id || '';
    assert(encounterId, 'anonymous user must be able to create an encounter for its patient');
    assert.strictEqual(encounters[0].owner_id, primary.userId, 'encounter owner_id must default to auth.uid()');

    await assert.rejects(
      () => supabaseFetch('/rest/v1/encounters?select=id', {
        method: 'POST',
        headers: {
          ...anonHeaders(other.accessToken),
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          patient_id: patientId,
          label: `Cross-owner block ${suffix}`
        })
      }),
      /row-level security|violates/i,
      'another user must not create an encounter for the patient'
    );

    const events = await supabaseFetch('/rest/v1/encounter_events?select=id,field_id,actor_id', {
      method: 'POST',
      headers: {
        ...anonHeaders(primary.accessToken),
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        encounter_id: encounterId,
        field_id: `codex-rls-${suffix}`,
        old_value: null,
        new_value: 'ok',
        source: 'human'
      })
    });
    assert(events?.[0]?.id, 'anonymous user must be able to append audit events for its encounter');
    assert.strictEqual(events[0].actor_id, primary.userId, 'event actor_id must default to auth.uid()');
  } finally {
    await deleteUser(primary.userId);
    await deleteUser(other.userId);
  }
}

async function main() {
  requireConfig();
  await verifyClinicalDemoRls();
  console.log('supabase clinical RLS verification passed');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
