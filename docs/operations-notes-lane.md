# El carril de Operations sobre Miracle Notes

Operations (el cliente Windows que automatiza SAP) pilota Miracle Notes **por API, nunca
clicando su UI**: crea consultas, guarda el dictado, genera y ajusta notas — una tras otra,
sin el médico frente al PC. El médico llega después, revisa el lote en el portal, firma y
pulsa «Exportar a HC»; la cola de `graph_note_exports` lleva la nota a SAP.

La regla que gobierna el carril: **el aparato produce BORRADORES. Firmar y exportar son del
médico, siempre** — «no se envían consultas hasta que el médico le da enviar a HC».

## Identidad: tres credenciales, tres poderes

| Credencial | Quién la tiene | Qué puede hacer |
|---|---|---|
| Key de enrolamiento (`GRAPH_ENROLL_KEYS`) | Embebida en el `.exe` | SOLO dar de alta un dispositivo (`POST /api/v1/enroll`) |
| Token per-install (`uwd_…`, hash en `graph_windows_devices`) | Una por instalación, emitida al enrolar | Todo `/api/v1` + pedir código de emparejamiento + (con vínculo) el carril clínico |
| JWT de Supabase del médico | El médico, en su navegador | Todo lo clínico + LO QUE EL APARATO NUNCA: firmar, exportar, vincular/desvincular equipos |

El vínculo médico↔equipo (`graph_device_doctor_links`) nace de un canje: el equipo muestra
un código de 8 caracteres (10 minutos, un solo uso) y el médico lo teclea en Miracle Notes →
Equipos. Un vínculo activo por equipo (índice parcial); re-emparejar revoca el anterior;
el médico revoca desde el portal cuando quiera. Revocar el vínculo NO mata la credencial del
equipo (sigue exportando a SAP); revocar el dispositivo mata todo.

## Matriz de rutas

| Ruta | Médico (JWT) | Aparato (token+vínculo) |
|---|---|---|
| `/api/clinical/templates*` | sí | sí (ownership del médico vinculado; institucionales no) |
| `/api/clinical/encounters*` (crear/leer/dictado/generar/nota) | sí | sí |
| `/api/clinical/assistant/*` | sí | sí |
| `GET /api/clinical/consultations` (listado magro) | sí | sí (+ filtro por la org del vínculo) |
| `/api/clinical/exports/*` | sí | **NO** |
| `/api/clinical/devices/*` (canjear/listar/revocar vínculos) | sí | **NO** |
| Firmar | server action de Notes (hash + CAS) | **no existe en Graph** |

El corte vive en `web/server.js` (montaje partido) y `web/api/requireClinicalActor.js`:
con Bearer delega VERBATIM en `requireClinicalAuth` (el carril del navegador no cambió);
con X-API-Key resuelve el vínculo y puebla `req.clinicalUser` con la identidad del médico
— `resolveDoctorId` y todas las rutas funcionan sin enterarse. `req.clinicalDevice` solo
existe para aparatos: es lo que usan la auditoría y el refresh del espejo.

Una key de env (`MIRACLE_API_KEYS`) JAMÁS es actor clínico: solo tokens de BD con vínculo.

## Las herramientas del cerebro (`notes_*`)

Graph las declara en `mcpCatalog.notesCatalog()` **solo si el turno viene de un aparato con
vínculo activo** (`AgentTurnService.assembleTools`); el cliente las ejecuta
(`ClinicalMcpRunner` → `ClinicalApiClient`) contra este carril. Dos promesas del catálogo
que el cliente cumple:

- **El dictado no pasa por la pluma del modelo**: `notes_guardar_dictado` toma el buffer
  local del micrófono tal cual.
- `notes_generar_nota` es síncrona con rescate: si Vercel corta a los 60 s, el cliente
  sondea `GET /encounters/:id` — y ese mismo tráfico dispara el rescate oportunista que
  termina la nota. No hay cola async que duplicar.

## El espejo y las ediciones del aparato

`ConsultationMirrorService.publish()` publica el borrador al generar (sin cambios). Cuando
un APARATO edita después (`PUT /note`), `refresh()` actualiza note/resumen/motivo con tres
candados: `estado='borrador'` en el UPDATE, **CAS de contenido** (si la web divergió, razón
`web_edito` y no se escribe: el último que manda es el médico) y best-effort (la respuesta
trae `mirror: {refreshed, reason}`). Contrato completo: `docs/consultation-data-ownership.md`.

## Pruebas

| Suite | Qué cubre |
|---|---|
| `npm run test:device-enroll` | enroll, token una vez/solo hash, doble fuente de requireApiKey, revocación |
| `npm run test:device-pairing` | código (TTL/un uso/anti-oráculo), canje CAS, re-emparejar, revocar |
| `npm run test:clinical-actor` | regresión del carril Bearer, DEVICE_NOT_PAIRED, cadena completa como aparato, refresh del espejo, scoping del listado, exports rechaza aparatos |
| `npm run test:notes-tools` | catálogo condicionado al vínculo; acciones al cliente |
| `npm run test:devices` | las cuatro anteriores |

Del lado del cliente (repo U-Windows-App): `scripts/fake-graph-clinical.js` levanta ESTE
carril real (con LLM enlatado) como banco de pruebas de U.exe, y
`scripts/verify-clinical-contract-mirror.js` contrasta el espejo C# contra las respuestas
reales — un contrato copiado a mano se desincroniza en silencio.

## Pendiente (corte final, F4 del plan)

- Degradar la key embebida a solo-enrolamiento en los builds nuevos y rotar la compartida
  de `MIRACLE_API_KEYS` cuando la flota esté enrolada.
- Atar `agent_links` a la instalación y devolverle caducidad (deuda anotada en su migración).
- Card «Dispositivos Windows» en Studio (listar/uso/revocar).
- `graph_windows_devices` requiere aplicar `20260803000000_windows_device_identity.sql`
  a la base (NO aplicada automáticamente: producción).
