---
description: Mete un archivo al chequeo de tipos (@ts-check + JSDoc) y lo deja en cero errores
argument-hint: [ruta/al/archivo.js]
allowed-tools: Bash(npx tsc:*), Bash(npm run typecheck), Bash(npm run lint), Read, Edit, Grep, Glob
---

Objetivo: incorporar `$1` al chequeo de tipos gradual del repo (ver `tsconfig.json`: `checkJs` está apagado y cada archivo entra con `// @ts-check`).

Pasos:

1. Lee el archivo completo antes de tocarlo.
2. Añade `// @ts-check` como primera línea.
3. Corre `npm run typecheck` y lee los errores de ese archivo.
4. Resuélvelos **documentando el contrato real, no silenciándolo**:
   - La causa más común aquí es JSDoc con `@param {object}`, que es opaco: reemplázalo por la forma concreta (`@param {{ memoryRepository: object, learningStore?: object }} deps`) o por un `@typedef` si se reutiliza.
   - Si el valor de verdad puede ser de varios tipos, exprésalo (`string|null`), no lo tapes.
   - `// @ts-ignore` y `/** @type {any} */` son último recurso, y van con un comentario que explique por qué.
5. No cambies el comportamiento en runtime. Esto es una tarea de documentación de tipos, no un refactor. Si encuentras un bug real de paso, repórtalo aparte en vez de mezclarlo.
6. Cierra con `npm run typecheck && npm run lint` en cero y pega la salida.

Si `$1` está vacío, lista los archivos de `src/` y `web/api/` que aún no tienen `// @ts-check` y propón el más pequeño para empezar.
