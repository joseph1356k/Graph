# Despliegue de Miracle en Vercel y Supabase

## Arquitectura

- Vercel sirve los archivos de `web/public` desde su CDN y ejecuta la API HTTP Express.
- El micrófono local usa WebRTC con OpenAI Realtime y es compatible con Vercel.
- El emparejamiento de micrófono por teléfono no usa Render ni WebSocket persistente. El teléfono abre WebRTC directo contra OpenAI Realtime usando `/api/voice/openai/session`, y el escritorio recibe eventos/transcripciones por HTTP con sesiones cortas guardadas en Supabase.
- Neo4j sigue siendo el almacén de workflows. Si no está configurado, la aplicación arranca, pero las rutas de workflows responden como almacenamiento no disponible.
- Supabase gestiona identidad, pacientes, encuentros, notas, eventos y leads. Las migraciones versionadas están en `supabase/migrations`.

## Configuración de Vercel

El repositorio utiliza:

- Install command: `npm ci`
- Build command: `npm run build:vercel`
- Output: `public/`, generado durante el build
- Runtime: `api/index.js` recibe `/api/*` mediante una rewrite y entrega la ruta original al servidor Express

Variables necesarias:

```text
NODE_ENV=production
PUBLIC_BASE_URL=https://miracle-zeta.vercel.app
ALLOWED_ORIGINS=https://miracle-zeta.vercel.app
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
NEO4J_URI=<neo4j-aura-uri>
NEO4J_USER=<neo4j-user>
NEO4J_PASSWORD=<neo4j-password>
NEO4J_DATABASE=<optional-database>
OPENAI_API_KEY=<server-secret>
GLOBAL_WORKFLOW_ADMIN_EMAILS=<comma-separated-emails>
```

Opcionales:

```text
OPENAI_MODEL=gpt-4o
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_REALTIME_VOICE=marin
MIRACLE_MEDICAL_ENGINE_URL=<optional-http-medical-engine-url>
```

Nunca se debe agregar `SUPABASE_SERVICE_ROLE_KEY`, el secreto OAuth de Google ni claves de IA al frontend o al repositorio. `SUPABASE_SERVICE_ROLE_KEY` solo puede existir como variable server-only en Vercel/local backend.

## Supabase

1. Crear o seleccionar el proyecto de producción.
2. Ejecutar:

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

3. En Realtime Settings, desactivar `Allow public access`.
4. Ejecutar Security Advisor y validar que usuarios anónimos no puedan leer tablas clínicas.
5. Copiar la URL, la clave publishable/anon y la service role key server-only a Vercel para Production, Preview y Development.

## Google OAuth

El secreto enviado por chat se considera expuesto y debe revocarse antes de usar Google Login.

En Google Cloud, el cliente OAuth debe ser de tipo `Web application`:

- Authorized JavaScript origins:
  - `https://miracle-zeta.vercel.app`
  - `http://localhost:3000`
- Authorized redirect URI:
  - `https://<project-ref>.supabase.co/auth/v1/callback`

La URL de Vercel no se agrega como redirect URI de Google cuando Supabase actúa como intermediario; se agrega como origen y como Site URL/Redirect URL en Supabase.

En Supabase:

1. Authentication > Sign In / Providers > Google.
2. Habilitar Google.
3. Introducir el Client ID y un Client Secret nuevo directamente en el Dashboard.
4. Authentication > URL Configuration:
   - Site URL: `https://miracle-zeta.vercel.app`
   - Redirect URLs: `https://miracle-zeta.vercel.app/**` y `http://localhost:3000/**`

No publicar el nuevo secreto en chat, GitHub, `.env` ni Vercel.
