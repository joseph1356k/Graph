# Quién manda sobre cada dato de una consulta

Una consulta clínica vive en **dos tablas** con esquemas distintos. Esto no es un accidente que se pueda deshacer en una tarde, así que la regla es explícita: para cada dato hay **un solo dueño**, y el otro lado no lo pisa.

| Tabla | Qué es | Dónde vive |
|---|---|---|
| `clinical_encounters` | El taller: audio, transcripción, nota de la IA | Backend Graph |
| `consultations` | El historial: lo que el médico ve, firma y exporta | App web (Next.js) |

Comparten el **mismo `id`**: el puente es 1:1 y navegable (`/app/consultas/<encounter_id>`).

## El reparto

| Dato | Dueño | Quién escribe |
|---|---|---|
| `transcript` | Taller | Backend (al guardar la transcripción) |
| `note_json` | Taller | Backend (generación) y `PUT /note` (edición del médico) |
| `note_json_ai` | Taller | **Solo** la generación. Congelada: mide cuánto corrige el médico |
| `note`, `resumen`, `plantilla`, `especialidad`, `motivo` en el historial | Taller | El servidor los publica; la web los refresca al editar |
| `estado` (borrador → aprobada → exportada) | Historial | **Solo** la web |
| `firma` | Historial | **Solo** la web |
| `patient_id` | Historial | **Solo** la web (el taller guarda un texto libre, no la FK) |
| `codigos` (CIE-10 / CUPS) | Historial | **Solo** la web |
| `organization_id` | Historial | El servidor lo deriva del perfil del médico al publicar |

## Publicar es del servidor

Hasta el 2026-08-01 el puente vivía **solo en el navegador** (`providers.tsx`). Si el médico cerraba la pestaña o se le caía el internet antes de que terminara la copia, la nota quedaba huérfana: existía en el taller pero no aparecía en su historial, **sin error ni aviso**. Así se acumularon 24 consultas invisibles.

Ahora [ConsultationMirrorService](../src/application/use-cases/ConsultationMirrorService.js) publica la fila **dentro de `generate-note`**, en el servidor. Reglas:

- **Solo crea.** Si la fila ya existe, no escribe nada — una nota firmada nunca se degrada desde aquí.
- **Nunca escribe** `estado`, `firma`, `codigos` ni `patient_id`: son de la web.
- **Sin organización no escribe.** Una fila sin `organization_id` sería invisible por RLS; mejor no crearla y decirlo que dejar un registro roto.
- **Best-effort.** Si el espejo falla, la nota ya está guardada y el médico no recibe un error falso sobre su trabajo. El fallo queda en el log y lo delata la alerta diaria.

## El navegador sigue escribiendo, y está bien

La web conserva su `upsertConsultation`. **No es duplicación inútil: es la red de seguridad.** Si el servidor no pudo publicar (por ejemplo, un médico sin organización asignada), el cliente crea la fila igual y la consulta no se pierde.

Cuando la fila ya existe —el caso normal ahora— la web hace una **actualización parcial**: refresca nota, resumen, transcripción y paciente, y **nunca toca estado ni firma**.

## Si vuelve a fallar, se sabe el mismo día

[SystemHealthAlertService](../src/application/use-cases/SystemHealthAlertService.js) cuenta las notas generadas en los últimos 30 días que no tienen fila en el historial y lo reporta como **crítico** en el correo diario. El fallo silencioso que costó 24 consultas ya no puede repetirse en silencio.

## Vocabulario de estados

No son el mismo idioma y no hay que confundirlos:

| Taller (`status`) | Historial (`estado`) |
|---|---|
| `created`, `transcript_ready`, `note_generating` | *(todavía no existe la fila)* |
| `note_generated` | `borrador` |
| `completed` | `revisada` / `aprobada` según la firma |
| `failed` | *(no se publica)* |

## Lo que queda pendiente

`clinical_encounters` **no tiene `organization_id`**: su seguridad es solo por médico. Por eso el espejo tiene que leer `profiles` para saber a qué organización pertenece la consulta, y por eso un administrador de hospital no puede ver el taller de su propia institución — solo lo que ya cruzó al historial.

Añadir esa columna es el siguiente paso natural para que las dos tablas hablen el mismo idioma de permisos. No se hizo aquí porque toca la política RLS de una tabla con datos clínicos en producción y merece su propio cambio, verificado aparte.
