# Instrumentación de diagnóstico — EMR Expanded

Scripts **de solo lectura** que se usaron para producir
[`docs/DIAGNOSTICO-EMR-EXPANDED.md`](../../../docs/DIAGNOSTICO-EMR-EXPANDED.md).

No modifican el repositorio, no tocan producción y no forman parte del build ni
del arranque de la app. Viven aquí para que cualquier hallazgo del diagnóstico se
pueda **reproducir y refutar**, no para quedarse como parte del producto.

Si el diagnóstico se cierra sin rediseño, esta carpeta se puede borrar entera sin
consecuencias: nada del código de la aplicación la referencia.

## Qué mide cada sonda

| Script | Qué verifica |
|---|---|
| `probe.js` | Estado de la página **sin** sesión de cliente: capas fijas, hit-testing de cada control, snapshot que se envía al modelo, uso de espacio vertical, errores de consola. |
| `probe2.js` | Estado **con** sesión válida: hit-testing por módulo, intercepción de clics por `clinical-review.js`, auto-bloqueo de la automatización, escritura en campos de vistas ocultas, cobertura del asistente, coste de arranque, vista móvil. |
| `probe3.js` | Identidad exacta de cada capa que bloquea un campo, controles ajenos al EMR que se reportan al modelo, `window.onload`, `moveToSelector` sobre campos invisibles, métricas visuales, CSS muerto. |
| `probe4-extension.js` | Qué ocurre cuando la **extensión de Chrome** está instalada y se abre el propio EMR de Graph (doble montaje del runtime). |
| `metrics.js` | Métricas visuales corregidas (solo elementos realmente visibles). |

## Cómo reproducirlas

```bash
npm ci

# 1. Servidor local con login de administrador local.
NEO4J_URI=bolt://127.0.0.1:7687 \
NEO4J_USER=neo4j \
NEO4J_PASSWORD=cualquiera \
PORT=4173 \
LOCAL_ADMIN_USERS=audit@miracle.local \
LOCAL_ADMIN_PASSWORD=audit1234 \
LOCAL_ADMIN_SECRET=solo-local \
node web/server.js

# 2. Token de sesión (las sondas lo leen de token.txt en esta carpeta).
curl -s -X POST http://127.0.0.1:4173/api/auth/local-admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"audit@miracle.local","password":"audit1234"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])' > token.txt

# 3. Sondas.
node probe.js && node probe2.js && node probe3.js && node metrics.js

# 4. Sonda con extensión (requiere construirla antes).
npm run build:chrome-extension
node probe4-extension.js
```

Neo4j no necesita estar arriba: el EMR no depende de él para renderizar. Las
llamadas al catálogo de workflows devuelven 503 y el diagnóstico lo registra
como tal.

En entornos donde Playwright no encuentra su Chromium, las sondas usan
`executablePath: '/opt/pw-browsers/chromium'`. Ajusta esa ruta si tu instalación
es distinta.

## Salidas

Los `.json` y `.png` de `evidencia/` son la corrida que sustenta el diagnóstico
(1440×900 y 390×844, Chromium, `main` @ `bc484ac`). Se conservan tal cual salieron.
