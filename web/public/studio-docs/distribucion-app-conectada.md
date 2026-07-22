# Distribución: el .exe llega conectado, sin config del usuario

**Objetivo:** el `Setup.exe` que se distribuye funciona de fábrica. El usuario final
**no pone ninguna API key** ni configura nada. Todo lo de por detrás se controla desde
Provider Studio (backend Graph).

## La idea clave

El cliente Windows **no necesita** las keys de los providers (OpenAI/Gemini/Deepgram):
esas viven en Graph (variables de entorno de Vercel, configuradas desde las cards de la
tab Windows del Provider Studio). Lo **único** que el `.exe` necesita para operar es una
**API key de Graph** (`miracle_…`, viaja como `X-API-Key` en `/api/v1`).

Así que "conectar el exe" = que traiga una API key de Graph válida sin intervención.

## Cómo funciona (key embebida en el build)

Mismo patrón que ya usa Android (`apikey.properties → DEFAULT_API_KEY`), que Windows no
tenía:

1. **`GraphWorkflows.csproj`** declara `AssemblyMetadata GraphDefaultApiKey`, **vacía por
   defecto** → los builds del repo NO llevan ningún secreto (nada en código ni en el
   historial de Git).
2. **El CI de distribución** (`.github/workflows/windows-release.yml`, paso *Publicar
   U.exe*) exporta la variable de entorno `GraphDefaultApiKey` desde el secreto
   `GRAPH_DEFAULT_API_KEY`. MSBuild la lee como propiedad y la **hornea** en `U.Graph.dll`.
   No hace falta tocar el script de publicación.
3. **`GraphConfig.cs`** (cliente) usa esa key embebida como último recurso. Prioridad:
   `%APPDATA%\U\graph.json` **>** env `GRAPH_API_KEY` **>** key embebida. Es
   sobreescribible en la máquina y no rompe nada si está vacía.

Resultado: descargar (Provider Studio → *Descargar App* → `/api/windows/latest-installer`)
→ instalar → funciona. Cero pasos para el usuario.

## El único paso manual (una vez)

En el repo de `windows-app` en GitHub → **Settings → Secrets and variables → Actions →
New secret**:
- Nombre: **`GRAPH_DEFAULT_API_KEY`**
- Valor: una key `miracle_…` generada en **Provider Studio → API keys**.

Sin el secreto, el build sigue funcionando pero sin key embebida (el usuario tendría que
ponerla a mano).

## Lo que controla Provider Studio

- **Modelos y providers** por feature (tab Windows: agente de escritorio, enseñanza por
  video…) → variables de entorno en Vercel + redeploy.
- **Las API keys** (`miracle_…`) → sección API keys (generar, listar, revocar).
- **Distribuir**: dispara el build en CI y sube el instalador al bucket público.

## Límite conocido (→ siguiente mejora)

La key embebida es **una sola, compartida** por todas las instalaciones, y queda en el
binario (descompilable). Mitigado: es revocable/rotable desde Provider Studio. Pero para
tener **identidad por instalación** (revocar/atribuir uso por dispositivo, y que una key
filtrada no comprometa a todos) viene la mejora de **autenticación interna** — ver
[Autenticación interna: enrolamiento por instalación](#).
