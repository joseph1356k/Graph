# CLI Commands - Graph Navigator

Guia rapida para usar Graph desde sus demos actuales.

Graph ya no esta pensado solo para la demo medica. Hoy el sistema tiene:

- un core de aprendizaje y ejecucion de workflows
- una capa de plugin/widget para paginas web
- separacion de workflows por contexto de pagina
- personalidad del asistente configurable por pagina

## 1. Iniciar el servidor

```bash
node web/server.js
```

## 2. Abrir una superficie de aprendizaje

Puedes abrir cualquiera de estas paginas:

- `http://localhost:3000/`
- `http://localhost:3000/page1.html`
- `http://localhost:3000/page2.html`

## 3. Grabar un workflow

1. Abre la pagina donde quieres ensenar el flujo.
2. Usa el widget flotante del trainer.
3. Pulsa el boton de grabacion.
4. Interactua con la pagina:
   - clicks
   - inputs
   - textareas
   - selects
   - navegacion
5. Deten la grabacion.

Resultado:

- los pasos se guardan en Neo4j
- el workflow queda asociado al contexto de la pagina
- `WORKFLOWS.md` se regenera

## 4. Consultar workflows desde la CLI

```bash
node index.js
```

Luego:

```text
list
```

## 5. Ejecutar un workflow exacto por ID

```text
run wf_123
run wf_123 --input_2=test@example.com --input_3="Acme Inc"
```

Notas:

- `input_<stepOrder>` corresponde a variables inferidas desde pasos `input` o `select`
- si no envias una variable, se usa el valor grabado o el valor elegido por el sistema cuando aplica

## 6. Ejecutar con lenguaje natural

Desde el widget de chat del trainer, el usuario puede escribir una peticion en lenguaje natural.

El sistema intentara:

1. filtrar workflows por el contexto actual de la pagina
2. elegir el mejor workflow para esa pagina
3. completar variables faltantes
4. ejecutar el workflow

## 7. Contexto y personalidad

Hoy el sistema ya soporta dos ideas importantes:

- contexto de pagina
  - los workflows aprendidos en una superficie no deben mezclarse con otra
- personalidad del asistente
  - la demo medica usa un tono mas neutral y clinico

## 8. Comandos tecnicos

- `list`: muestra workflows disponibles
- `run <workflowId> --input_<stepOrder>=value`: ejecuta un workflow exacto
- `/<cypher>`: ejecuta Cypher directamente
- `exit`: cierra la CLI

## 9. Variables de entorno

- `AZURE_FOUNDRY_BASE_URL`: opcional; si se configura junto con key y modelo, tiene prioridad para matching y dynamic fill
- `AZURE_FOUNDRY_API_KEY`: opcional; activa Azure Foundry como backend LLM de Graph
- `AZURE_FOUNDRY_MODEL`: opcional; deployment/model id, por ejemplo `DeepSeek-V4-Flash`
- `OPENROUTER_API_KEY`: recomendado para resumen, matching y selects asistidos por LLM
- `OPENROUTER_MODEL`: opcional
- `OPENAI_API_KEY`: opcional como ruta alternativa
- `OPENAI_MODEL`: opcional
- `NEO4J_URI`
- `NEO4J_USER`
- `NEO4J_PASSWORD`
- `WEB_PORT`

## 10. Documentacion relacionada

- [README.md](C:/Users/User/Desktop/Graph/README.md)
- [ARCHITECTURE.md](C:/Users/User/Desktop/Graph/ARCHITECTURE.md)
- [WORKFLOWS.md](C:/Users/User/Desktop/Graph/WORKFLOWS.md)
