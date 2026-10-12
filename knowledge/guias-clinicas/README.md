# Guías clínicas del asistente (corpus del RAG)

Cada archivo `*.md` de esta carpeta es una guía resumida que el asistente
clínico puede citar. El índice (`src/application/knowledge/ClinicalGuidelineIndex.js`)
no lee estos Markdown en runtime: carga `guidelines.corpus.json`, que se
compila con `npm run build:corpus` y **se commitea**. `npm test` falla si el
JSON se quedó viejo.

## Formato

```
---
id: hta-adultos                      # kebab-case; igual al nombre del archivo
titulo: Hipertensión arterial en adultos
organismo: ESC · MinSalud Colombia
anio: 2024
fuente: ESC 2024 Guidelines…; GPC HTA Colombia 2017
especialidades: [medicina_general, medicina_interna, cardiologia]   # snake_case
cie10: [I10, I11]                    # opcional
palabras_clave: [hipertension, presion arterial, HTA]
poblacion: [adultos, adultos_mayores, gestantes]   # a quién aplica: adultos, adultos_mayores, gestantes, pediatria, neonatos
fecha_revision: 2026-10-01
revisado_por:                        # vacío hasta que un médico la revise
---
> Resumen orientativo elaborado a partir de la fuente citada. Verificar en la fuente antes de decidir.

## Definición y diagnóstico
…
## Metas y tratamiento
…
```

Reglas:

- Cada `##` es un **fragmento recuperable** por separado (≤ 2 500 caracteres). Pon en el título de la sección las palabras con las que un médico preguntaría.
- Umbrales, dosis y criterios **solo si están en la fuente**. Si no se recuerda la cifra exacta, se omite: el asistente prefiere abstenerse a inventar.
- Mínimo dos secciones. El texto es español clínico, sin markdown pesado (el asistente lo cita como texto plano).
- Nada de datos de pacientes ni de nombres propios de personas: `verify-guideline-corpus.js` pasa cada fragmento por el escudo de privacidad y exige **0 marcadores**.
- `sinonimos.json`: abreviaturas y variantes (`hta` → `hipertension`) que se expanden tanto al indexar como al buscar.

- `poblacion` es obligatoria: el índice sube la guía cuya población coincide con la del paciente (edad, embarazo) o con la que nombra la pregunta («en niños»), y baja la que no.
- Mientras redactas: `node scripts/check-guideline-drafts.js <archivo.md>` revisa formato, tamaño de cada fragmento y escudo sin tocar el JSON.

Después de editar: `npm run build:corpus && node scripts/verify-guideline-corpus.js && node scripts/verify-guideline-index.js`.
