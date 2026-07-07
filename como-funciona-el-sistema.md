# Cómo funciona el sistema (explicación conceptual)

> Este documento explica **qué hace Graph y cómo funciona por dentro**, en términos generales y sin entrar en detalles técnicos de implementación de los workflows. Está pensado para cualquier persona del equipo, técnica o no.

---

## 1. ¿Qué problema resuelve?

Cualquier sistema clínico (un EMR, un formulario de historia médica, un portal de admisión) tiene **su propia forma de organizar los campos**: dónde va el nombre del paciente, dónde el diagnóstico, dónde las alergias, qué botones hay que apretar para guardar. Cada sistema es distinto.

Graph resuelve dos problemas que están conectados:

1. **"¿Dónde va cada dato en este sistema en particular?"** — en lugar de programar a mano un conector para cada EMR, Graph *aprende* la ubicación de los campos observando a una persona usarlo una vez.
2. **"¿Cómo paso de una conversación hablada a una nota clínica completa y bien llenada?"** — un médico dicta, el sistema transcribe, organiza esa transcripción en una nota clínica estructurada, y luego usa lo que aprendió en el punto 1 para colocar cada dato en el campo correcto del sistema que se esté usando.

En una frase: **Graph aprende cómo se ve un formulario clínico, y luego usa eso para convertir una conversación hablada en una nota ya llenada en ese formulario.**

---

## 2. La idea central, en una analogía

Imagina un asistente que puedes entrenar así:

1. Le muestras, una sola vez, cómo llenas un formulario en un sistema médico: "aquí va el nombre, aquí el motivo de consulta, aquí seleccionas el diagnóstico, aquí guardas". El asistente memoriza ese camino.
2. La próxima vez que estés frente a *ese mismo tipo de formulario*, en lugar de llenarlo tú a mano, simplemente hablas con el paciente. El asistente escucha, escribe la nota clínica organizada, y luego —usando lo que memorizó en el paso 1— coloca cada dato en el campo correcto por ti.
3. Antes de que cualquier dato entre "solo", el asistente te lo muestra y te pide confirmación. Nunca guarda algo en el sistema real sin que tú lo apruebes.

Ese ciclo —**observar una vez → recordar el mapa del formulario → escuchar → organizar → proponer → confirmar**— es el corazón de todo el sistema.

---

## 3. Las piezas principales, en lenguaje simple

| Pieza | Qué hace, en términos simples |
|---|---|
| **El "cerebro" central (backend)** | El servicio que todo el mundo consulta: recuerda los formularios aprendidos, organiza notas, decide qué dato va en qué campo, y controla quién tiene permiso de hacer qué. |
| **La memoria de formularios aprendidos** | Una base de datos donde se guarda el "mapa" de cada sistema clínico que el asistente ya conoce: qué campos tiene, en qué orden se llenan, qué opciones acepta cada uno. |
| **El traductor de voz a texto** | Un servicio externo especializado que convierte el audio de la consulta en texto, en tiempo real, mientras el médico habla. |
| **El organizador de notas** | Un modelo de lenguaje (IA) que toma ese texto crudo y lo convierte en una nota clínica bien estructurada (motivo de consulta, diagnóstico, plan, etc.), en vez de un bloque de texto desordenado. |
| **El "casador" de campos** | Otro uso de la IA: compara la nota organizada con el mapa de campos aprendido y decide qué valor va en cada campo, con un nivel de confianza. Solo propone lo que está razonablemente seguro. |
| **La capa de confirmación clínica** | Una regla de seguridad: cualquier dato que la IA proponga queda marcado como "propuesto, sin confirmar" hasta que una persona (el clínico) lo revise y confirme. Nada se da por bueno automáticamente. |
| **El asistente flotante en la página** | La pieza visual que ve el usuario final: un widget que aparece sobre cualquier página web, con un botón de "grabar", un chat, y la posibilidad de "enseñarle" un formulario nuevo. |
| **La extensión de navegador** | La misma capacidad del asistente flotante, pero empaquetada para poder instalarse en cualquier página web, no solo en las páginas de demo del propio sistema. |
| **El panel de administración** | Donde el equipo interno configura qué proveedores de IA / voz se usan, revisa el uso y costo del sistema, y administra el acceso. |

---

## 4. Cómo trabajan juntas: el recorrido completo

### A. Fase de aprendizaje (enseñarle un formulario nuevo)

Una persona interactúa normalmente con un sistema clínico —hace clic, escribe, selecciona opciones— mientras el asistente "graba" en silencio esa secuencia. Al terminar, esa secuencia se guarda como el mapa de ese formulario: qué campos existen, en qué orden, qué tipo de dato espera cada uno. Este aprendizaje se hace **una sola vez por tipo de formulario**; después el sistema ya "conoce" ese formulario cada vez que lo vuelve a ver.

### B. Fase de uso (la consulta real)

1. **El médico presiona grabar.** El sistema abre un canal de audio en tiempo real hacia el servicio de transcripción.
2. **La transcripción llega en vivo**, fragmento por fragmento, a medida que se habla.
3. **Cada fragmento se envía al organizador de notas**, que va construyendo y actualizando una nota clínica estructurada — no es un volcado de texto, sino secciones con sentido clínico.
4. **Cuando la nota está lista (o se actualiza)**, el sistema compara esa nota con el mapa de campos que ya conoce de ese formulario específico, y propone qué valor va en cada campo.
5. **Nada se llena solo.** Los datos propuestos por la IA se muestran marcados como pendientes de confirmar. El clínico revisa y aprueba (o corrige) antes de que se considere información válida.

### C. Alrededor de ese flujo

- **Todo pasa por un control de acceso**: hay una cuenta de administrador para el panel interno, y un modo de invitado limitado para páginas de demostración públicas. Nadie accede a datos ajenos.
- **El sistema no guarda pacientes ni historiales clínicos como producto propio** — funciona como un servicio de apoyo (transcribir, organizar, sugerir) para aplicaciones cliente; no es una base de datos clínica en sí misma.
- **El audio nunca pasa por el servidor central** — el navegador se conecta directamente al servicio de transcripción, y el servidor solo entrega el permiso temporal para hacerlo. Esto reduce la carga del sistema y acelera la respuesta.

---

## 5. ¿Quién usa esto y dónde aparece?

El mismo "cerebro" central atiende a distintas superficies, todas hablando el mismo idioma con el backend:

- **Páginas de demostración clínica** — donde se valida y se muestra el flujo completo hoy.
- **Un panel de administración** — para configurar proveedores de IA/voz y ver métricas de uso.
- **Una extensión de navegador** — para llevar el mismo asistente a cualquier sistema clínico externo, no solo a las páginas propias.
- **(A futuro) otras superficies** — el diseño está pensado para poder montarse sobre páginas estáticas, apps en React, sitios en WordPress o Shopify, e incluso aplicaciones de escritorio, sin rehacer la lógica central.

La idea de fondo: **la inteligencia vive en un solo lugar (el backend)**; cada superficie es solo una forma distinta de mostrarla y capturar datos, pero todas usan las mismas capacidades.

---

## 6. Por qué está diseñado así

- **Aprender en vez de programar a mano cada integración** hace que el sistema pueda adaptarse a formularios nuevos sin escribir código nuevo por cada EMR.
- **Separar "escuchar", "organizar" y "llenar campos" en pasos distintos** permite que cada uno mejore de forma independiente (por ejemplo, cambiar el proveedor de transcripción sin tocar cómo se organiza la nota).
- **Nunca confiar ciegamente en la IA** — todo dato generado automáticamente pasa por confirmación humana antes de darse por válido, lo cual es especialmente importante tratándose de información clínica.
- **Mantener el audio fuera del servidor central** reduce costos, complejidad y superficie de riesgo, ya que el dato más sensible en tiempo real (la voz) nunca transita por el backend propio.
- **Una sola base de "cerebro" para múltiples clientes** evita reconstruir la misma lógica en cada superficie (web, extensión, futuras apps), y asegura que todos los clientes se comporten igual.

---

## 7. En una sola frase

Graph observa una vez cómo se llena un formulario clínico, y desde ahí convierte cualquier conversación hablada en una nota organizada que se propone —nunca se impone— para llenar ese mismo formulario, siempre bajo revisión humana.
