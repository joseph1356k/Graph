# Visión de arquitectura: superficies agnósticas + SDK

> Documento de **visión** (norte a mediano/largo plazo). No es el plan de hoy.
> El plan de hoy es terminar y pulir la **app Windows** como primera v1. El SDK
> y la paridad total entre superficies se **extraen a partir de esa v1**, no se
> diseñan en abstracto antes.

## 1. El norte

Una sola "aplicación" conceptual expuesta en varias superficies (Windows, Android,
Web), con:

- **La misma experiencia y (donde tenga sentido) la misma interfaz.**
- **Editar un frontend y que se propague a varios**, aunque estén en tecnologías
  distintas (Windows en .NET/WPF, Android en Kotlin Multiplatform, Web en Next.js).
- **Funcionalidades agnósticas**: se desarrollan una vez en el backend central
  (Graph) y se exponen a todas las superficies por un tronco de API único, con
  **personalización por superficie** (modelo de IA distinto, feature on/off, etc.).

Regla de oro: **la lógica vive en Graph; las superficies son frontends "tontos"**
que renderizan y capturan input. Cuanto más tonta la superficie, más fácil la paridad.

## 2. Estado actual (fuente de verdad: el código, 2026-07)

| Pieza | Estado |
|---|---|
| Graph como backend HTTP central (Express + Vercel `graph-eight-pied`) | ✅ Vivo |
| Tronco de API versionado `/api/v1` + auth `X-API-Key` (`MIRACLE_API_KEYS`) | ✅ Implementado |
| Provider Studio (panel de config, cards por feature → env vars en Vercel) | ✅ Implementado |
| Endpoints agnósticos (pipeline, autofill, assistant, biopsy, workflows, learning) | ✅ Agnósticos, sirven a cualquier superficie |
| Endpoints del agente Windows (`/api/v1/agent/turn`, `/teach/*`) | ⚠️ **Escritos pero sin commitear ni montar** (ver §5) |
| Identidad de superficie en la request (saber "soy Windows/Android/Web") | ❌ No existe (el `label` de la API key viaja pero se ignora) |
| Config por superficie (mismo feature, modelo distinto por frontend) | ❌ No existe como modelo de datos. Web = global; Android = fila única distribuida; Windows = placeholder |
| SDK compartido entre superficies | ❌ No existe (se extrae de la v1 Windows) |

### Conexión de cada superficie a Graph hoy
- **Windows** (`windows-app`): apunta a `graph-eight-pied` con `X-API-Key`, pero
  contra endpoints que **aún no están desplegados**. Sin remoto de GitHub todavía.
- **Web** (`Pagina-web-clientes-final`): cliente 100% cableado al contrato de Graph;
  falta fijar la env `NEXT_PUBLIC_API_BASE_URL` al dominio del deploy.
- **Android** (`Android`): **no** usa Graph central; habla directo con Supabase +
  Gemini/OpenAI/Deepgram/Neo4j. Migración pendiente.

## 3. Arquitectura objetivo

```
                       ┌─────────────────────────────────────────┐
                       │              GRAPH (hub)                  │
                       │  Node/Express · Vercel · Neo4j · Supabase │
                       │                                           │
   Provider Studio ───▶│  Config por superficie  (surface_config) │
   (admin UI)          │  ├─ web:    feature → provider/modelo/on  │
                       │  ├─ windows:feature → provider/modelo/on  │
                       │  └─ android:feature → provider/modelo/on  │
                       │                                           │
                       │  Tronco API  /api/v1  (X-API-Key)         │
                       │  ├─ Features agnósticas (datos portables) │
                       │  │   pipeline · autofill · assistant ...   │
                       │  └─ Agente (state/actions por superficie) │
                       └──────────────┬────────────────────────────┘
                                      │  contrato único versionado
             ┌────────────────────────┼────────────────────────┐
             ▼                        ▼                        ▼
    ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
    │  SDK .NET        │     │  SDK Kotlin (KMP)│     │  SDK TS/JS       │
    │  (Windows/WPF)   │     │  (Android)       │     │  (Web/Next)      │
    └─────────────────┘     └─────────────────┘     └─────────────────┘
     Frontend "tonto"        Frontend "tonto"        Frontend "tonto"
     + capa de experiencia compartida (la "carita", estados, textos)
```

### 3.1 Identidad de superficie (la pieza barata que lo habilita todo)
Cada superficie ya manda una **API key**. El backend ya parsea un `label` de esa
key (`requireAuth.js`) y lo deja en `req.apiClient.label`, pero **nadie lo lee**.

Plan: emitir keys por superficie (`windows:…`, `android:…`, `web:…`) y en
`requireApiKey` derivar `req.surface`. A partir de ahí la superficie viaja
**implícita en la key que ya envían** — cero cambios en el payload del cliente.
(Alternativa/complemento: header `X-Client-Surface`.)

### 3.2 Config por superficie
Generalizar el patrón que **ya existe para Android** (`AndroidPanelService` sobre
la tabla única `graph_client_config`, id=1) a **una fila por superficie**:

```
surface_config(surface, feature, provider, model, enabled, keys...)
```

Las funciones de resolución de config (`resolveConsciousConfig()`,
`*ProviderConfigService.status()`) hoy no reciben argumentos; pasarían a recibir
`surface` y leer la fila correspondiente, con **fallback al global**. Eso da:
"notas en blanco con gpt-4 en Windows y gemini en Android", y "feature X apagada
solo en Web".

### 3.3 Features agnósticas
Las de `registerPublicApiRoutes.js` ya lo son: operan sobre **datos portables**
(texto, imágenes, campos, workflows), stateless, el cliente aporta el contexto.
Ese es el patrón a seguir para toda feature nueva.

El **agente** (`agent/turn`) es el caso difícil: su `state{screen, gestos, apps}`
asume escritorio con captura de pantalla. Para que sirva a Android/Web hará falta
**abstraer `state`/`actions` por superficie** (o versionar el endpoint). Aquí la
config no basta: se necesita polimorfismo de contrato. Es trabajo de la fase SDK,
no de hoy.

### 3.4 SDK + capa de experiencia compartida
- **SDK por lenguaje** (.NET, Kotlin, TS): envuelve el contrato `/api/v1`, maneja
  auth, reintentos, tipos. Se **genera/extrae desde la v1 Windows** ya probada.
- **Capa de experiencia compartida**: estados de UI, copy, y elementos como la
  "carita" descritos de forma agnóstica (p.ej. una máquina de estados en el
  backend o en un paquete compartido) que cada superficie renderiza con su
  tecnología nativa. Esto es lo que permite "editar una vez, cambiar varias".

## 4. Orden recomendado (fases)

1. **Fase 0 — Windows v1 pulida (HOY).** Terminar de montar/desplegar el backend
   del agente, cerrar el loop de iteración rápida, y pulir Windows hasta que se
   sienta v1. *No SDK, no per-surface todavía.*
2. **Fase 1 — Identidad de superficie.** `req.surface` desde el label de la key.
   Barato, no rompe nada, deja el terreno listo.
3. **Fase 2 — Config por superficie.** Tabla `surface_config` + tab real de
   Windows en Provider Studio (hoy placeholder).
4. **Fase 3 — SDK extraído de Windows.** Formalizar el contrato como SDK .NET y
   luego portar a Kotlin/TS.
5. **Fase 4 — Paridad de experiencia.** Capa compartida (la "carita", estados).
6. **Fase 5 — Migrar Android a Graph** y unificar Web.

## 5. Deuda concreta detectada (para no perderla)

- **Backend del agente Windows sin commitear en Graph**: `registerWindowsAgentRoutes.js`
  y servicios asociados están untracked, y `server.js` tiene los `require`/instancias
  pero **falta la llamada `registerWindowsAgentRoutes(app, {...})`**. Resultado: los
  endpoints core de Windows **no están desplegados**. → Terminar y desplegar (Fase 0).
- **`windows-app` sin remoto de GitHub.** Falta `git remote add` + push.
- **Backend legacy TypeScript** residual en `windows-app/backend/` (desacoplado,
  solo se reactiva con `U_BACKEND_URL`). → Eliminar cuando Graph esté estable.
- **Secretos en código/histórico**: `ClientToken` hardcodeado en `windows-client/src/Config.cs`
  y claves reales en `windows-app/backend/.env` legacy. → Rotar y sacar del código.
- **Resiliencia del cliente Windows**: sin reintentos/backoff en `BackendClient`
  ni `GraphClient`; dos URLs base desacopladas. → Endurecer en Fase 0/1.
```
