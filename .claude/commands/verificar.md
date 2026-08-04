---
description: Corre lint + typecheck + tests y reporta el resultado con evidencia
allowed-tools: Bash(npm run verify), Bash(npm run lint), Bash(npm run typecheck), Bash(npm test), Read, Edit, Grep
---

Corre la verificación completa del repo:

```bash
npm run verify
```

Eso es `lint` → `typecheck` → `test` en cadena. Reglas al reportar:

- Si pasa todo: dilo con la salida real pegada (conteo de verificaciones OK, 0 errores de lint, 0 de tsc). No lo declares listo sin la salida.
- Si falla: identifica la causa raíz leyendo el archivo señalado, arréglala y vuelve a correr. No silencies una regla ni añadas `// eslint-disable` para que pase.
- Los **avisos** de ESLint son deuda conocida del repo y no bloquean. Pero si un aviso está en un archivo que tocaste en esta sesión, déjalo en cero.
- Recuerda que `npm test` cubre solo el camino clínico. Si el cambio toca el motor de workflows, `web/public/`, o el runtime Python, la suite pasando **no prueba** que tu cambio funcione: dilo explícitamente y verifica a mano levantando la app.
