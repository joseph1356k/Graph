# SurfaceLocator: la "URL de Windows"

Todo el sistema de workflows descansa sobre una pregunta: **¿dónde está parado el
usuario ahora mismo?** El `SurfaceLocator` la responde dando una **geolocalización
dentro del sistema operativo**, con la misma forma que una URL. Es el badge fijo
arriba a la derecha de la pantalla, y es la señal que alimenta el scoping, el
mismatch y la confirmación del `SurfaceNavigator`.

La idea nació del navegador: la extensión de Chrome decide qué workflows aplican por
la URL (origin + pathname). En Windows sintetizamos una URL equivalente para que un
workflow nativo sea **indistinguible de uno web** del lado del backend.

---

## El esquema

- **App nativa** → `uia://proceso.exe/titulo-de-ventana-normalizado`
- **Navegador** → `web://dominio/ruta/subruta` (la URL real leída de la barra de
  direcciones por UIA, **sin query ni fragmento**: eso es estado volátil, no ubicación)
- **SAP GUI** → `sapgui://SID/TCODE` (sistema SAP + transacción)

El ID se parte en dos ejes, y esa división es la que usa todo lo demás:

- **`origin`** — la identidad estable (la app, el sistema SAP, el dominio). Siempre
  acota.
- **`pathname`** — la ruta dentro. Acota **solo** cuando es estable (`web://` la URL,
  `sapgui://` la transacción). En `uia://` el pathname es el **título de la ventana =
  el documento abierto**: es instancia, no identidad, y por eso se ignora como
  identidad (un workflow de "escribir en Notepad" sirve en cualquier nota).

Es el mismo formato que el `source_url` con que se graban los workflows, así que sirve
tal cual para cargar workflows por superficie y decidir qué exponer por MCP.

---

## Cómo sondea (barato por diseño)

Corre un timer ligero (~800 ms) que hace solo lo barato en el hilo de UI: leer la
ventana en primer plano (handle + título). **Solo cuando algo cambió** dispara el
trabajo caro (UIA para leer la omnibox del navegador) en un hilo de fondo. Así el
badge está siempre vivo sin pesar sobre el sistema.

Detalle importante: **las ventanas de la propia app (Ü) no cuentan como superficie**.
Si el usuario abre el panel de Ü, el locator conserva el ID de la app real que estaba
usando — si no, cada interacción con Ü borraría el contexto que los workflows
necesitan.

---

## Por qué es el cimiento

- El **scoping por MCP**: Graph decide qué workflows ofrecerle al cerebro según el
  `origin`/`pathname` actual, que viajan en cada turno.
- El **mismatch** (`WorkflowPlayer.SurfaceMismatch`): compara el `origin` de aquí
  contra el `origin` donde nació el workflow.
- La **confirmación del `SurfaceNavigator`**: tras enfocar/lanzar una app, el navegador
  espera a que el locator confirme que el `origin` ya cambió al destino. Sin locator no
  hay forma de saber que se llegó.

---

## Pendiente

- **Profundidad dentro de la app**: hoy el pathname de `uia://` es solo el título de la
  ventana. Para la navegación de capa 2 (llegar a la pantalla correcta dentro de una
  app) haría falta un pathname más rico que refleje el estado interno, no solo el
  título.
