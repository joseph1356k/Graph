# Openclaw Orchestration

## Rol de Openclaw

Openclaw será la capa de agentes/orquestación controlada desde nuestro frontend.
Openclaw correrá como sistema upstream separado, no como código embebido dentro de nuestra app.

## Relación producto -> Openclaw

El frontend de notas captura intención.
El chat contextual la interpreta.
Openclaw ejecuta o coordina agentes usando ese contexto.

## Qué queremos evitar

- que el usuario tenga que pensar en “qué agente usar”
- que el usuario tenga que salir de la nota para operar agentes
- que Openclaw aparezca como un sistema separado mentalmente del editor

## Lo ideal

La experiencia debe sentirse así:

- escribo
- abro chat contextual
- pido ayuda o ejecución
- el sistema ya entiende qué parte del conocimiento estoy trabajando
- Openclaw actúa con contexto suficiente

## Requisito de arquitectura

La integración con Openclaw debe preservar:

- simplicidad visual
- contexto local del bloque editado
- continuidad conversacional
- capacidad de ejecutar acciones desde el conocimiento escrito
- separación clara entre producto y upstream

## Boundary

La app de notas y el chat contextual son producto.
Openclaw es infraestructura de orquestación.
La conexión futura debe pasar por adapters, no por acoplamiento directo a internals del core.

## Resultado esperado

La nota se convierte en el punto de entrada natural para pensar y para orquestar.
