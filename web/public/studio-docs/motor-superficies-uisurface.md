# Superficies (IUiSurface): el CÓMO de cada mundo

`IUiSurface` es **la única abstracción que separa "hablar con Graph" de "tocar
Windows"**. El grabador y el ejecutor trabajan contra esta interfaz y les da igual si
debajo hay SAP GUI Scripting o UIA. Es donde vive el CÓMO: cómo se lee la pantalla y
cómo se ejecuta cada acción en cada mundo.

Cada superficie sabe: si está disponible (`Check`), qué pantalla está delante
(`Identity`), qué campos accionables hay (`ReadFields`), cómo ejecutar un paso
(`Execute`) y cómo observar al usuario mientras graba (`StepObserved`).

Regla de hilos: `ReadFields` y `Execute` **bloquean** (UIA y el COM de SAP lo hacen);
se llaman FUERA del hilo de UI.

---

## Dos implementaciones hoy

**`UiaSurface`** — cualquier app de Windows, por UI Automation. Es la **red de
seguridad**: funciona en todas partes, pero entiende menos que SAP cuando la app de
abajo es SAP. Considera "campo" solo lo interactivo (Edit, ComboBox, Button, CheckBox,
List, MenuItem, Tab…); el texto decorativo queda fuera.

**`SapGuiSurface`** — SAP, por la Scripting API (COM). UIA se queda en un `Pane` y no ve
nada dentro de SAP, así que para SAP es esto o nada. Dos decisiones clave:

- **Enlace tardío a propósito**: todo el COM se llama por reflexión, sin referencia a
  `sapfewse.ocx`. Así el proyecto **compila en máquinas sin SAP GUI** (CI, el portátil
  de un dev) y la ausencia de SAP es un estado que se reporta, no un fallo de build.
  Además sobrevive mejor a los cambios de versión del interop (roto entre 7.40 → 7.70 →
  8.0).
- **`Check` distingue los modos de fallo**: el scripting depende de que el Basis del
  cliente ponga `sapgui/user_scripting = TRUE` (por defecto FALSE). En la máquina de un
  cliente "no funciona" es inútil; "tu Basis no ha habilitado el scripting" es
  accionable.

---

## Los selectores: un "CSS" re-resoluble

Graph guarda el selector como un string opaco y lo devuelve intacto en el plan, así que
el formato lo elegimos nosotros — pero tiene que **re-resolver en otra ejecución, otra
sesión y quizá otra máquina**.

UIA usa `uia:clave=valor;clave=valor`, y emite los tres cuando puede:

- `uia:aid=txtUsuario;ct=Edit` — AutomationId, el único de verdad estable.
- `uia:name=Aceptar;ct=Button` — Name visible, estable si no está traducido/duplicado.
- `uia:path=0/3/1/2;ct=Edit` — índices desde la ventana, frágil, último recurso.

El mejor va como selector; los demás como `surfaceHints.alternativeTargets`, la
convención que Graph ya entiende. Si la app cambia y el AutomationId desaparece, el
ejecutor **cae al name y luego al path**. Ni el AutomationId es garantía (Microsoft
avisa del "catastrophic change in the UI"), por eso los alternativos no son un lujo:
son el plan de contingencia. SAP usa el prefijo `sap:` con el id normalizado del control.

---

## Modo flexible en ejecución

Cuando un step es `flexible` (ver los 3 escenarios), la superficie intenta la resolución
**exacta → aproximada → saltar sin romper**: el valor concreto no importa y no debe
frenar el workflow.

---

## Pendiente

- **Más superficies detrás de la misma interfaz**: web nativa, Office, etc. La interfaz
  ya está lista; agregar un mundo es implementar `IUiSurface`, no tocar el player ni el
  grabador.
- **Resolución aproximada más rica** para `flexible` (matching semántico de campos).
