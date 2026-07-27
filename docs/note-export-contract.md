# Exportación de nota clínica a la historia clínica

Contrato entre **Miracle Notes** (el médico firma y pide), **Graph** (valida,
persiste y sirve la cola) y **Operations** (el ejecutor que escribe en el HIS).

La regla que gobierna todo: **una consulta pasa a `exportada` única y
exclusivamente cuando el ejecutor confirma un éxito real.** Encolar no es
exportar. Reclamar no es exportar. "No falló" no es exportar.

## Piezas

| Pieza | Dónde |
|---|---|
| Tabla + RPCs | `supabase/migrations/20260727000000_graph_note_exports.sql` |
| Servicio | `src/application/use-cases/NoteExportService.js` |
| Snapshot / texto para el HIS | `src/application/use-cases/NoteExportSnapshot.js` |
| Hash de la firma (compartido con Notes) | `src/application/use-cases/NoteSignatureHash.js` |
| Persistencia | `src/infrastructure/repositories/SupabaseNoteExportRepository.js` |
| Rutas | `web/api/registerNoteExportRoutes.js` |
| Simulador (cliente de referencia) | `scripts/simulate-operations-executor.js` |

## Dos carriles de autenticación

- `/api/clinical/exports` → **JWT de Supabase** del médico (`requireClinicalAuth`).
- `/api/v1/operations/exports` → **X-API-Key** del ejecutor (`requireApiKey`).

Graph lee `consultations` con la service-role key, que salta el RLS de Notes; por
eso el servicio comprueba explícitamente organización y rol en cada operación.

## Carril Miracle Notes

### `POST /api/clinical/exports`
```json
{ "consultation_id": "<uuid>" }
```
Valida, en este orden: la consulta existe → el solicitante es el médico tratante
o admin/supervisor de la misma organización → `estado='aprobada'` → tiene `firma`
→ no es una nota de demostración → **el hash de la firma se re-verifica** contra
`note`/`resumen`/`codigos` tal como están en `consultations`.

> **Trampa del hash, verificada contra Postgres real:** Postgres normaliza el
> orden de claves de `jsonb`, así que el hash **solo cuadra si se calcula sobre la
> fila leída de la base de datos**, nunca sobre el objeto que se iba a insertar.
> `signConsultationNote` en Miracle Notes ya lo hace bien (hace `SELECT` y luego
> hashea). Si alguien mueve ese cálculo a antes de la escritura, **todas** las
> exportaciones empezarán a fallar con `SIGNATURE_HASH_MISMATCH`.

- `201 { export }` — trabajo creado en `pending`. **Nunca significa "exportada".**
- `409 { error: { code: "EXPORT_ALREADY_EXISTS" }, export }` — ya existía un
  trabajo para esta consulta. **No es un error para el frontend**: es la respuesta
  idempotente al doble clic / dos pestañas / reintento de red. El cliente adopta
  ese estado (así lo hace `createNoteExport` en Notes).
- `422 SIGNATURE_HASH_MISMATCH` — el contenido no coincide con la firma. No se
  encola nada: mandar al HIS algo que nadie firmó sería peor que no exportar.
- `409 CONSULTATION_NOT_APPROVED | CONSULTATION_NOT_SIGNED | CONSULTATION_IS_DEMO | CONSULTATION_ALREADY_EXPORTED`
- `403 EXPORT_FORBIDDEN` · `400 EXPORT_INVALID` · `503 WORKFLOW_NOT_CONFIGURED`

### `GET /api/clinical/exports?consultation_id=<uuid>`
`200 { export | null, consultation_estado }` — sin `payload` (la UI no necesita
PHI para pintar un estado). Es lo que hace que el estado sobreviva a una recarga.

### `POST /api/clinical/exports/:id/retry`
Solo desde `failed | needs_doctor | cancelled`, y solo si la consulta sigue
`aprobada`. Reencola la MISMA fila; `attempts` se conserva como historia.

### `POST /api/clinical/exports/:id/cancel`
Solo desde `pending`. Un trabajo `claimed` ya se está ejecutando contra el HIS y
no hay cancelación remota: ofrecer el botón sería un placebo.

## Carril Operations (pull)

El ejecutor **nunca** recibe conexiones entrantes: pregunta. Da igual que viva
detrás del firewall del hospital.

### `POST /api/v1/operations/exports/claim`
```json
{ "device": "equipo-consultorio-3" }
```
- `204` — no hay trabajo. Vuelve a preguntar luego.
- `200 { export: { id, workflow_id, attempts, lease_expires_at }, payload, plan }`

`payload` es el snapshot congelado al crear el trabajo:

```json
{
  "note": [ { "id": "...", "titulo": "...", "kind": "texto|lista", "texto": "...", "items": [] } ],
  "resumen": "...",
  "codigos": [ { "sistema": "CIE-10", "codigo": "M54.5", "descripcion": "..." } ],
  "firma": { "por": "...", "fecha": "...", "hash": "..." },
  "patient_ref": "<uuid o vacío>",
  "rendered_text": "MOTIVO DE CONSULTA:\n…",
  "context": "<= mismo texto que rendered_text>"
}
```

**PHI:** el payload lleva el contenido clínico (es lo que hay que escribir), pero
`patient_ref` es un uuid: **nunca nombre ni documento**. Solo `codigos` con
`estado='aceptado'` llegan al HIS.

El claim es FIFO con `FOR UPDATE SKIP LOCKED`: varios ejecutores en paralelo
nunca se llevan el mismo trabajo. Un trabajo `claimed` cuyo lease venció vuelve a
estar disponible — un equipo que se apagó a media tarea no bloquea la cola.

`plan` es `null` mientras Graph no resuelva el plan server-side (ver
`resolvePlan` en `web/server.js`); el ejecutor resuelve el suyo. Activarlo no
cambia este contrato.

### `POST /api/v1/operations/exports/:id/result`
```json
{ "device": "equipo-consultorio-3", "outcome": "ok",
  "folio": "HC-2026-001", "unresolved_fields": [], "error_code": "", "detail_code": "" }
```

`outcome`:
- **`ok`** — la acción de guardado se ejecutó **y se verificó la señal de éxito
  del HIS** (diálogo/folio). Solo esto exporta la consulta. "No lanzó excepción"
  no es `ok`.
- **`needs_doctor`** — faltan datos que el médico debe completar. Manda las
  etiquetas de los campos en `unresolved_fields` (una etiqueta de formulario no
  es PHI).
- **`error`** — falló. Manda un `error_code` tipado, **sin PHI**.

Respuesta `200 { acknowledged, idempotent, status, consultation_exported, export }`.

**El cliente DEBE reintentar hasta recibir ack.** Esto no es best-effort: si el
resultado no llega, Graph no puede saber que el HIS ya se escribió. Reenviar el
mismo resultado es seguro: devuelve ack con `idempotent: true` sin re-transicionar
ni duplicar auditoría.

Rechazos de contrato (no se arreglan reintentando igual): `409 EXPORT_NOT_OWNED`
(el trabajo lo tiene otro), `409 EXPORT_LEASE_EXPIRED` (venció el plazo; otro
ejecutor puede tenerlo ya), `409 EXPORT_NOT_CLAIMED`, `400 EXPORT_INVALID`.

## Estados

```
pending ──claim──► claimed ──result ok────────► completed   → consulta: exportada
                          ├─result needs_doctor► needs_doctor ┐
                          └─result error───────► failed       ├→ consulta: sigue aprobada
pending ──cancel─────────────────────────────► cancelled     ┘
```

No hay estado `expired`: un lease vencido es una **condición re-reclamable**, no
una transición que gestionar. `needs_doctor` ≠ `failed` porque la acción del
médico difiere: completar campos en el HIS vs. reintentar.

## Configuración

Requerido: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Sin la service-role key
las rutas responden `503` en vez de fingir que exportan.

| Variable | Default | Para qué |
|---|---|---|
| `GRAPH_NOTE_EXPORT_WORKFLOW_ID` | — | Workflow de automatización del HIS. Sin él, crear una exportación responde `503 WORKFLOW_NOT_CONFIGURED`. |
| `GRAPH_NOTE_EXPORT_LEASE_SECONDS` | `600` | Plazo del claim. |
| `GRAPH_NOTE_EXPORT_MAX_ATTEMPTS` | `3` | Intentos antes de dejar de servir el trabajo en el claim. |

En Miracle Notes: `NEXT_PUBLIC_API_BASE_URL` debe apuntar a este Graph, y Graph
debe incluir el origen del frontend en `ALLOWED_ORIGINS`.

## Probar sin SAP

```bash
# Flujo completo con el simulador como proceso aparte (los 9 pasos):
npm run demo:note-export
npm run demo:note-export -- --outcome error
npm run demo:note-export -- --outcome needs_doctor

# Contra un Graph que ya esté corriendo:
MIRACLE_API_KEY=... node scripts/simulate-operations-executor.js --watch --interval 5

# Suites
npm run test:note-export      # hash compartido + flujo sobre las rutas reales
npm run test:note-export-db   # esquema y RPCs contra Postgres real (salta sin BD)

# E2E completo: simulador real (proceso aparte) → HTTP → Graph real → Postgres real.
# Opt-in porque necesita `pg`, que no es dependencia del runtime (Graph habla con
# Supabase por HTTP). Salta con aviso si falta.
npm i pg --no-save && npm run test:note-export-real
```

Los tres arneses cubren cosas distintas y ninguno sustituye a otro:

| Arnés | Rutas HTTP | Base de datos | Simulador |
|---|---|---|---|
| `test:note-export` | reales | falsa, en memoria | simulado en proceso |
| `test:note-export-db` | — | **Postgres real** | — |
| `test:note-export-real` | reales | **Postgres real** | **proceso aparte** |

Lo que **ningún** arnés cubre todavía: la interfaz de Miracle Notes en un navegador
contra un Graph desplegado. Eso exige un Supabase de staging (ver más abajo).

El simulador **es el cliente de referencia**: cualquier proceso que hable
claim/result es un ejecutor válido. Reemplazarlo por el cliente Windows real no
toca ni el frontend ni Graph.

## Seguridad — límite conocido del piloto

La X-API-Key compartida es aceptable para QA/demo con datos de prueba y un
dispositivo. **Bloquea producción con pacientes reales:** una key horneada en un
`.exe` descompilable permite a quien la extraiga reclamar trabajos y leer PHI. El
upgrade es el enrolamiento per-install; el claim es el único punto de entrada y
los carriles de auth son middleware intercambiable, así que **endurecerlo no
cambia este contrato**.

Mitigaciones ya activas: lease corto, `claimed_by` auditado, techo de intentos,
`error_code` y telemetría tipados sin PHI, y purga del `payload` a las 72 h del
estado terminal vía `graph_purge_note_export_payloads()`.
