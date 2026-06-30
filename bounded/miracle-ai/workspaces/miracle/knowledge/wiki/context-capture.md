# Context Capture

## Problema a resolver

El sistema debe saber exactamente qué escribió el usuario recientemente, incluso si está insertando texto nuevo dentro de bloques viejos.

## Necesidad principal

Tener trazabilidad fina del cambio más reciente dentro del documento.

## Modelo mental

Queremos algo parecido a Git, pero orientado a edición en tiempo real:


Pacioajsconacon
jhcbksncskjnjkdn
kjsdnvkjndvk/ 




- detectar lo nuevo
- detectar qué cambió
- detectar dónde cambió
- detectar en qué bloque ocurrió

## Señales que el frontend debe capturar

- documento actual
- bloque activo
- rango editado
- texto previo
- texto nuevo
- timestamp del cambio
- cambio de foco
- posición del cursor

## Heurística deseada

Cuando el usuario abre el chat contextual, el sistema debe poder responder:

1. qué acaba de escribir
2. dónde lo escribió
3. cómo cambió respecto al estado anterior
4. cuál es el contexto local relevante

## Guardado

El guardado puede ocurrir automáticamente en eventos como:

- cambio de foco
- pausa corta después de escribir
- cambio de bloque

## Propósito

Pasar a Openclaw un contexto mucho más rico que “el documento completo”.

La unidad importante no es solo la nota.
También es el cambio reciente.





FUNCIONALIDAD DE RECONOCIMIENTO DE VOZ
