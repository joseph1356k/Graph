# Openclaw Runtime Pattern

## Regla principal

Miracle no debe usar el perfil global por defecto de Openclaw.

Debe usar un runtime aislado propio:

- perfil: `miracle`
- state dir: `~/.openclaw-miracle`
- gateway: `http://127.0.0.1:19001`
- launch agent: `ai.openclaw.miracle`

## Por qué

Cuando Miracle usó el perfil global:

- compitió con instalaciones previas del usuario
- compartió el daemon global
- compartió el puerto global `18789`
- aparecieron listeners stale
- el setup podía fallar aunque la config en disco pareciera correcta

## Patrón a mantener

### Producto

Miracle sigue siendo:

- editor
- captura de contexto
- chat contextual
- capa BFF server-side

### Upstream

Openclaw sigue siendo:

- runtime upstream
- daemon/gateway
- auth de providers
- selección de modelo
- ejecución de inferencia/orquestación

### Costura

La costura oficial es:

- setup por CLI oficial
- modelo por `openclaw models set`
- chat por adapter server-side

## Reglas para cambios futuros

- no conectar el frontend directo a Openclaw
- no usar el perfil global del usuario
- no cambiar `/api/chat` para resolver necesidades de un provider
- no inventar config propia si Openclaw ya soporta el caso oficialmente
- absorber cambios upstream en adapters y setup service

## Documento detallado

Para implementación, operación y checklist de mantenimiento:

- [docs/openclaw/06-openclaw-runtime-implementation-and-maintenance.md](/Users/felipemaldonado/Documents/Miracle/docs/openclaw/06-openclaw-runtime-implementation-and-maintenance.md)
