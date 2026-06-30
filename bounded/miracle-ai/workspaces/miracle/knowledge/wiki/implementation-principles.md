# Implementation Principles

## Principios del producto

### 1. Writing first

La escritura es la interfaz principal.
Todo lo demás es secundario.

### 2. Context before commands

El sistema debe inferir contexto antes de pedir comandos explícitos.

### 3. Locality matters

El bloque actual importa más que el documento entero en muchas interacciones.

### 4. Auto-save over manual friction

El sistema debe guardar y detectar cambios de forma automática cuando sea razonable.

### 5. Product simplicity, technical depth underneath

La complejidad técnica puede existir por debajo.
La experiencia no debe mostrarla.

### 6. Chat is an overlay, not the main canvas

El chat complementa la escritura.
No reemplaza la nota.

### 7. Knowledge becomes action

Lo escrito por el usuario debe poder transformarse en contexto operativo para agentes.

## Implicaciones técnicas

- editor centrado en bloques o segmentos detectables
- tracking de cambios recientes
- autosave
- apertura contextual de chat
- envío de contexto enriquecido a Openclaw
- separación clara entre UI simple y capa de orquestación
