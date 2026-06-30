# Dynamic Chat

## Idea principal

El chat debe ser contextual, dinámico y activable desde cualquier parte de la nota.

## Trigger deseado

Mientras el usuario escribe, existe un icono omnipresente asociado al bloque o zona actual.
Cuando el usuario hace hover sobre ese icono, el chat se despliega horizontalmente.

## Comportamiento esperado

- el usuario escribe
- el sistema detecta el bloque actual o el fragmento recién editado
- el usuario hace hover sobre el icono de chat
- el chat se abre con contexto precargado
- la conversación se enfoca en lo último que acaba de escribir

## Qué debe entender el chat

No solo el documento completo.
Debe entender especialmente:

- el bloque actual
- el texto recién agregado o modificado
- la posición del cursor
- el bloque anterior y siguiente cuando aporte contexto
- la intención local del usuario

## Meta

Que hablar con el asistente no se sienta como cambiar de modo.
Debe sentirse como extender el pensamiento que ya está ocurriendo en la nota.

## Regla UX

El chat aparece por contexto.
No secuestra la pantalla.
