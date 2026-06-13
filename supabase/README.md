# Supabase

SQL migrations for the Miracle "doble conexión" feature.

The previously documented project ref no longer resolves. Treat these migrations as
the source of truth and apply them to the active replacement project:

```
supabase link --project-ref <your-ref>
supabase db push
```

| Migration | What it creates |
|---|---|
| `20260602000001_encounters.sql` | `encounters` (per-encounter note `jsonb`) + owner-only RLS |
| `20260602000002_encounter_events.sql` | `encounter_events` append-only audit trail + RLS |
| `20260603000001_patients.sql` | `patients` + `encounters.patient_id` + RLS |
| `20260604000001_leads.sql` | Public lead inserts with no public read access |
| `20260613050536_harden_clinical_access.sql` | Explicit grants, permanent-user-only clinical RLS, tenant relationship checks, private Realtime authorization |

After pushing:

1. Disable **Allow public access** in Realtime Settings.
2. Enable Google and configure the callback plus application redirect URLs.
3. Run Security Advisor, Performance Advisor and RLS tests.
4. Verify that an anonymous Supabase user cannot access clinical tables.

For local Google OAuth, set these values in the ignored root `.env`:

```text
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<google-web-client-id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=<new-google-client-secret>
```

The Google secret previously shared in chat must be revoked. Do not reuse it.
