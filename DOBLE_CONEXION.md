# Doble conexión — login + nota por paciente en tiempo real

Permite iniciar sesión con Google y que la **hoja clínica se sincronice en vivo**
entre todos los dispositivos conectados con la misma cuenta. El médico llena la
nota en el PC (tecleando o por voz) y se refleja al instante en otro dispositivo;
la nota queda guardada por paciente/encuentro.

## Cómo funciona (resumen)

- **Identidad:** Supabase Auth con Google (login del lado del navegador).
- **Nota durable:** tabla `encounters` en Postgres; la nota es la columna `note`
  (`jsonb`), un mapa plano `{ idDelCampo: valor }`. RLS: cada usuario solo ve lo suyo.
- **Tiempo real:** canal *Broadcast* de Supabase por encuentro (`encounter:<id>`)
  para reflejar campo‑a‑campo al instante + un *upsert* con debounce de la nota
  completa para durabilidad.
- **Integración:** todo cuelga de `web/public/page-state.js` (el único punto por
  donde pasa el estado del formulario). Como los llenados por voz también disparan
  `input`/`change`, **se reflejan automáticamente**, sin tocar la lógica de voz.

El pipeline de voz/teléfono‑como‑micrófono **no cambia**.

## Archivos

- `web/public/supabase-client.js` — carga el SDK y crea el cliente (`window.MiracleSupabase`).
- `web/public/auth-gate.js` — muro de login con Google (`window.MiracleAuth`).
- `web/public/note-sync.js` — espejo en tiempo real sobre `PageState` (`window.MiracleNoteSync`).
- `web/public/page-state.js` — hooks añadidos: `applyRemoteField`, `applyRemoteState`, `getState`, `onFieldChange`.
- `web/server.js` — endpoint `GET /api/public-config` (sirve la config pública de Supabase desde `.env`).
- Cableado por ahora solo en `web/public/emr-workspace.html`.

## Puesta en marcha

### 1. Variables de entorno
Configura en `.env` (gitignored) los valores del proyecto activo:
```
SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sb_publishable_TU_CLAVE_PUBLICA
```
El proyecto anterior `nzccbfccuvyfxujymizr` ya no resuelve por DNS y no debe
reutilizarse. Reemplaza también `NEO4J_*` y `OPENAI_API_KEY` con valores reales.

### 2. Configurar Google como proveedor (manual — solo tú puedes)
1. **Google Cloud Console** → *APIs & Services* → *Credentials* → *Create
   credentials* → *OAuth client ID* → tipo **Web application**.
   - *Authorized redirect URI*:
     `https://TU_PROJECT_REF.supabase.co/auth/v1/callback`
   - Copia el **Client ID** y el **Client Secret**.
2. **Supabase dashboard** (proyecto *miracle*) → *Authentication* → *Sign In /
   Providers* → **Google** → activar y pegar Client ID + Secret → guardar.
3. **Supabase dashboard** → *Authentication* → *URL Configuration*:
   - *Site URL*: la URL HTTPS de producción.
   - *Redirect URLs*: `http://localhost:3000/**`, la URL HTTPS de producción y,
     solo durante pruebas, la URL concreta de red local.
   - En producción usa rutas exactas y evita comodines amplios.

### 2.b Activar sesión anónima (para el demo público sin login)
Las páginas de demo (`index.html`, `page1.html`, `page2.html`) usan voz sin pedir
Google. Para que sus llamadas pasen la autenticación del backend, obtienen una
**sesión anónima** de Supabase. Actívalo una vez:
- **Supabase dashboard** → *Authentication* → *Sign In / Providers* → **Anonymous
  sign-ins** → activar.

Sin esto, el demo público mostrará un aviso en consola y la voz no conectará (la hoja
clínica con Google en `emr-workspace.html` no se ve afectada).

### 2.c Invitado local temporal

Mientras Supabase no este disponible, se puede habilitar en `.env`:
```
ALLOW_LOCAL_ANONYMOUS=true
```
Esto agrega **Entrar como invitado** al login. La sesion se firma temporalmente por
el servidor, solo funciona fuera de produccion y no permite administrar, grabar ni
persistir workflows. La nota permanece en el navegador y no se sincroniza.

### 3. Levantar
```
npm start
```
Abre `http://localhost:3000/emr-workspace.html`.

## Probar el espejo en vivo

1. En el **dispositivo A** abre `emr-workspace.html` → inicia sesión con Google.
   Se crea un encuentro y la URL pasa a `...emr-workspace.html?encounter=<id>`.
   Abajo a la izquierda aparece un chip “🟢 Sincronizado” con **Copiar enlace**.
2. Copia ese enlace y ábrelo en el **dispositivo B** (mismo Google). Verás el
   mismo `?encounter=<id>`.
3. Escribe en un campo en A → aparece en B en ~1 s. Prueba también por **voz**
   (teléfono como micrófono apuntando a A): la nota se llena y B la refleja.
4. Recarga B → la nota se rehidrata desde Supabase (durabilidad).
5. Con **otra** cuenta de Google, ese encuentro no es visible (RLS).

## Notas de seguridad
- Los canales de encuentro son privados y se autorizan con políticas sobre
  `realtime.messages`. Desactiva **Allow public access** en Realtime Settings.
- En el cliente solo va la **publishable key**, nunca la service key.
- Las políticas clínicas rechazan usuarios anónimos aunque Supabase les asigne
  el rol Postgres `authenticated`.
- Para uso clínico real: revisar región de datos, retención y cifrado. Esto es un
  prototipo en la rama `feature/doble-conexion`.

## Añadido después (seguridad, clínico, móvil)
- **Seguridad backend**: los endpoints que gastan OpenAI/LLM exigen sesión Supabase
  (`web/api/requireAuth.js`, JWT vía JWKS) + rate-limit + CORS allowlist. El demo
  público usa sesión anónima (`demo-auth.js`).
- **Seguridad clínica**: la IA *propone* (campos "sin confirmar" con evidencia y
  confianza); el médico confirma; se bloquea finalizar si quedan pendientes
  (`clinical-review.js`). Cada cambio se audita en `encounter_events` (RLS).
- **Pacientes**: `patients.js` (elegir/crear paciente, reabrir encuentros);
  tabla `patients` + `encounters.patient_id`.
- **PWA/móvil**: `manifest.webmanifest` + `service-worker.js` (instalable + offline);
  EMR responsive; `note-sync` reintenta escrituras al reconectar.

## Pendiente (seguimiento)
- Iconos PNG 192/512 para la PWA (hoy un SVG).
- Crear o restaurar un proyecto Supabase activo, enlazarlo y ejecutar `supabase db push`.
- Activar **Google** y, solo si se necesita para demos remotos, **Anonymous sign-ins**.
- Desactivar **Allow public access** en Realtime y probar las políticas privadas.
- Ejecutar Security Advisor, Performance Advisor y el RLS tester del dashboard.
- Proteger el formulario público de leads con Turnstile/hCaptcha o mover la
  escritura a un endpoint servidor; el honeypot actual no sustituye rate limiting.
- Prueba en teléfono real: permisos de micrófono iOS para la voz autónoma.
- Tests/CI y partir `trainer-plugin.js` (descartado por ahora).
