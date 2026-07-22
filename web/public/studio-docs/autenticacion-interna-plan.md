# Autenticación interna: enrolamiento por instalación (PLAN)

> Estado: **planificado, no implementado.** Es la evolución natural de la key embebida
> compartida (ver [Distribución conectada](#)). Aquí se analiza y se decide el enfoque.

## El problema que resuelve

Hoy todas las instalaciones comparten **una sola** API key embebida en el `.exe`
(descompilable). Eso significa:
- No se puede **revocar por usuario/dispositivo** (revocar afecta a todos).
- No se puede **atribuir el uso** (quién consumió qué).
- Si la key se **filtra**, compromete a toda la flota → hay que rotar y redistribuir.

Queremos **identidad por instalación** manteniendo el "cero config" para el usuario final.

## Opciones evaluadas

1. **Login de usuario (email/SSO)** — el usuario inicia sesión y recibe un JWT.
   *Rechazado por ahora:* rompe el "cero config" (el usuario tendría que autenticarse).
   Se puede añadir MÁS ADELANTE para escenarios multi-usuario/empresa, encima de lo demás.
2. **Firmar cada request (HMAC / mTLS)** — el cliente firma con un secreto embebido.
   *Rechazado:* el secreto sigue siendo compartido y descompilable; complejidad alta para
   el mismo problema.
3. **Enrolamiento por instalación (device provisioning)** — **ELEGIDO.** Ver abajo.

## Decisión: enrolamiento por instalación + tokens en base de datos

La key embebida deja de ser la credencial de acceso y pasa a ser una **key de
enrolamiento de bajo privilegio**: lo ÚNICO que puede hacer es dar de alta un dispositivo.

**Flujo:**
1. Primer arranque: el cliente genera un **device id** estable (hash de máquina, guardado
   en `graph.json`) y hace `POST /api/v1/enroll` con la **key de enrolamiento embebida**.
2. Graph valida la key de enrolamiento (rate-limited), crea/actualiza el registro del
   dispositivo y emite un **token per-install** (opaco o JWT corto), guardado en una tabla
   (`graph_windows_devices`, análoga a `graph_app_users` de Android).
3. El cliente guarda ese token y lo usa como `X-API-Key`/`Authorization` para todo
   `/api/v1`. Renueva si expira (con la key de enrolamiento).
4. Provider Studio (tab Windows) lista los **dispositivos enrolados**, su uso, y permite
   **revocar uno** sin tocar a los demás.

**Por qué encaja:**
- Sigue siendo **cero config** (el enrolamiento es automático, invisible).
- **Blast radius** de una key filtrada: mínimo — la key de enrolamiento sola no accede a
  nada, solo enrola (y se puede rate-limitar / rotar sin romper a los ya enrolados).
- Reutiliza piezas existentes: el patrón de dispositivos de Android (`graph_app_users`,
  telemetría en `AndroidPanelService`) y la sección de API keys del Studio.

## Cambio de fondo necesario: tokens en DB, no en env

Hoy las keys viven en `MIRACLE_API_KEYS` (variable de entorno de Vercel) y emitir una
**requiere un redeploy** (`ApiKeyService.generate` → `triggerRedeploy`). Eso NO sirve para
emitir un token por instalación en caliente. Por eso el enrolamiento exige:

- **Validación de `/api/v1` respaldada por base de datos** (Supabase/Neo4j) para los
  tokens per-install, no por env. Las env keys se quedan para **admin/bootstrap** (la key
  de enrolamiento y las de acceso administrativo).
- Un `requireApiKey` que acepte **dos fuentes**: env (admin/enrolamiento) + DB (per-install).

## Alcance del primer corte (cuando se implemente)

1. Tabla `graph_windows_devices` (device_id, token_hash, enrolled_at, last_seen,
   revoked, label) + servicio `WindowsDeviceService`.
2. `POST /api/v1/enroll` (gated por key de enrolamiento) → emite token per-install.
3. `requireApiKey` acepta tokens de DB además de env.
4. Cliente: device id estable + enrolamiento en primer arranque (`GraphConfig`/`GraphClient`)
   + guardado del token + renovación.
5. Provider Studio: card "Dispositivos Windows" (lista, uso, revocar) — reutilizar el patrón
   de la tab Android.
6. La key **embebida** pasa a ser de enrolamiento (scope mínimo), no de acceso.

## Lo que NO cambia para el usuario final

Nada. Sigue: descargar → instalar → funciona. La diferencia es toda interna: cada
instalación tiene su propia identidad, revocable y medible, y el sistema es robusto ante
una key filtrada.
