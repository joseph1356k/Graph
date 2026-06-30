# Openclaw Core Strategy

## Rol de Openclaw

Openclaw sera el core upstream del sistema.
No sera la experiencia de producto final.

## La decision mas importante

No vamos a embeber Openclaw dentro de nuestro producto.
Lo vamos a correr como sistema upstream independiente y construiremos Miracle alrededor de el.

## Que significa eso

- Openclaw corre con su instalacion normal
- el `Gateway` es la superficie principal de control
- nuestro frontend y backend hablan con Openclaw desde afuera
- si hace falta extender capacidades, se hace por `plugins` o `skills`

## Que no haremos

- no forkar Openclaw como base del producto
- no crear un binario mezclado producto + core
- no usar el frontend oficial como plantilla principal
- no acoplar la UI a objetos internos del upstream

## Que si haremos

- construir una capa de producto propia
- usar adapters entre nuestro dominio y el dominio de Openclaw
- mantener `ContextPacket` como contrato central
- dejar que Openclaw sea infraestructura, no UI

## Boundary

Openclaw = runtime upstream

Miracle = producto

## Regla para futuros asistentes

`Do not embed Openclaw into our product. Run it upstream and build around it.`

## Referencias

Los documentos profundos viven en:

- `docs/openclaw/01-openclaw-research.md`
- `docs/openclaw/02-openclaw-product-architecture.md`
- `docs/openclaw/03-openclaw-boundaries-and-contracts.md`
- `docs/openclaw/04-openclaw-brief-for-coding-agent.md`
