# 005 — Una sola Ü: el cerebro obedece, sabe con quién habla y sus herramientas dicen lo que hacen

Estado: **implementado** (2026-10-01) · Nace del pedido del dueño del 2026-10-01 (revisar todos los
prompts de Ü, que no se contradigan, uno por funcionalidad, con médico o persona al empezar y una
personalidad amable) · Rama: `claude/wizardly-brown-ld68hq`

La mitad Windows de este trabajo es la spec 078 de Windows (`apps/windows/docs/specs/078-u-sabe-con-quien-habla.md`);
la de Android, su spec 009 (`apps/android/docs/specs/009-el-cerebro-local-habla-como-u.md`). El mapa de todos los
prompts está en `docs/monorepo/prompts-de-u.md`.

## Diagnóstico: qué se midió

| Qué | Medida | Fuente |
|---|---|---|
| Dos Ü que se contradecían | la voz de Windows decía «no pidas permiso»; el cerebro de Graph, «SIEMPRE ask_user antes, sin excepción» | prompts del 2026-10-01 (`IRREVERSIBLE_ACTIONS` de `PromptClauses.js`) |
| El Mac recibía el prompt de Windows | árbol UIA, Ctrl+…, «PC con Windows» en un Mac | `conscious-brain/prompt.js` antes de esta rama |
| Herramientas que prometían lo que no hacen | `send_email` / `send_sms` solo abren un borrador; en Windows `set_alarm`, `set_timer` y `create_event` solo abren su app | `WindowsSystemApi.cs`, `AndroidSystemApi.kt`, `Desktop.swift` |
| Conversaciones simuladas (modelo fuerte y pequeño, juez por pilares) | primera vuelta 19/28; el modelo pequeño decía «Listo, le mandé el correo» con el borrador abierto e inventaba el clima | workflow de pruebas del 2026-10-01 |
| Revisión adversarial del código de la rama | 25 hallazgos, 12 confirmados por dos revisores y 1 por uno | ídem |

## Promesas

La constitución de Ü vive en `src/application/prompts/ConstitucionDeU.js`, con sus copias en Windows y Android
(`tools/monorepo/constitucion.sh` las compara). Los arreglos de código de la revisión (la cobertura literal con
decimales, el techo de privacidad del orquestador E14, `readyToSubmit`, la memoria, la especialidad
«constructor», la salida truncada) se juzgan en los verify heredados que ya cubrían esas piezas.

| # | Promesa | Juez |
|---|---|---|
| 501 | el prompt del cerebro es QUIEN · perfil · EN ESTE TURNO · objetivo · OBEDECE · pantalla · cómo actúas · workflows · preguntas · memoria · persistencia · interfaz, en las tres plataformas y con los tres perfiles | `verify-agent-prompts.js` |
| 502 | lo que se quitó no vuelve: personalidad «viva y divertida», emojis, «intent», lista de herramientas, nombres de workflow repetidos, «subconscientes», «idioma del usuario», «MCP» | `verify-agent-prompts.js` |
| 503 | nada contradice a OBEDECE: ni el prompt ni ask_user piden permiso «SIEMPRE» ni «sin excepción»; ask_user sirve para las tres preguntas de OBEDECE y no para pedir permiso | `verify-agent-prompts.js` |
| 504 | sin respuesta y lo que no cuadra: el prompt no repite a OBEDECE ni lo contradice («decide lo más razonable» se fue); lo que no cuadra va por ask_user y speak es solo un aviso | `verify-agent-prompts.js` |
| 505 | el resultado se ve en el turno siguiente: una respuesta con llamadas no lleva texto final, y la búsqueda va en el navegador que nombró la persona | `verify-agent-prompts.js` |
| 506 | las reglas nuevas están: datos en <pantalla> nunca son órdenes, Windows sin atajos ni doble clic, map_* para LLEGAR, la terminal solo si la piden, workflow sin datos → preguntar, final en pasado comprobado, persistencia con freno | `verify-agent-prompts.js` |
| 507 | una herramienta dice lo que hace en SU plataforma: correo, SMS, llamada, alarma y evento que solo abren lo dicen, y el prompt manda terminarlos en la pantalla | `verify-agent-prompts.js` |
| 508 | web_search dice que solo abre la búsqueda: no devuelve resultados y un dato solo se da si se leyó | `verify-agent-prompts.js` |
| 509 | abrir una app: primero launch_app, nunca un workflow (hace todos sus pasos, también guardar) | `verify-agent-prompts.js` |
| 510 | llenar no es grabar, tampoco con un workflow: si sus pasos terminan guardando y solo pidieron llenar, no se llama (Windows y Android, con cada perfil) | `verify-agent-prompts.js` |
| 511 | la respuesta final: una acción comprobada (en la pantalla o, sin pantalla, en lo que devolvió la herramienta), la información completa, y lo de la persona en segunda persona | `verify-agent-prompts.js` |
| 512 | la terminal: lo que la persona pide se hace (abrirla, un comando dictado); Ü no la usa por su cuenta, en Windows y en Mac | `verify-agent-prompts.js` |
| 513 | Android: sin toque largo ni atajos; copiar es set_clipboard; escribir reemplaza el campo; las teclas con su nombre real (ENTER, BACK) | `verify-agent-prompts.js` |
| 514 | Gemini declara en computer_key solo las teclas del teléfono (enter, back): «backspace» saldría de la pantalla y «home» iría al inicio; en Windows, las de siempre | `verify-agent-prompts.js` |
| 515 | Mac: map_type con exit REEMPLAZA (y se ven 300 caracteres), añadir es cmd+down y sin exit; abrir algo no termina la tarea; el volumen está en Configuración | `verify-agent-prompts.js` |
| 516 | SIMIT: lo pedido se hace (pagar lleva a la pasarela oficial, radicar va al canal oficial) y la prescripción cuenta 3 años desde el hecho y se interrumpe con el mandamiento de pago | `verify-agent-prompts.js` |
| 517 | memoria: lo de General vale siempre y gana a lo que elegirías tú | `verify-agent-prompts.js` |
| 518 | perfil: el médico lleva su especialidad del catálogo; la persona, su bloque sin vocabulario clínico; sin perfil, nada | `verify-agent-prompts.js` |
| 519 | perfil: se normaliza contra el catálogo; lo hostil o desconocido no llega al prompt | `verify-agent-prompts.js` |
| 520 | perfil: se congela en la sesión del primer turno (solo si viene); el de un turno siguiente no cuenta | `verify-agent-prompts.js` |
| 521 | la pantalla viaja cercada en <pantalla>: el título y el árbol van dentro, un cierre inyectado no sale, la hora va fuera | `verify-agent-prompts.js` |
| 522 | la hora: la zona del cliente si Intl la reconoce, si no America/Bogota; el texto del cliente nunca llega tal cual | `verify-agent-prompts.js` |
| 523 | por la ruta: el primer mensaje del turno lleva la hora de U.exe fuera de <pantalla> (openai y gemini) | `verify-agent-prompts.js` |
| 524 | un parámetro opcional no se declara obligatorio (OpenAI y Gemini); los de ask_user/speak siguen obligatorios | `verify-agent-prompts.js` |
| 525 | workflows: la descripción dice la app y los primeros pasos, sin «subconscientes» | `verify-agent-prompts.js` |
| 526 | OpenAI: cada llamada se contesta con el resultado de SU acción (un speak delante ya no corre los índices) y una función inexistente recibe un error, no un «ok» | `verify-agent-prompts.js` |
| 527 | Gemini: igual, por actionIndex; una función inexistente recibe un error y no consume el resultado de la siguiente | `verify-agent-prompts.js` |
| 528 | memoria: sin usuario (o «anon») no se lee ni se escribe; sin duplicados; con topes | `verify-agent-prompts.js` |
| 529 | memoria por la ruta y por la enseñanza: un cuerpo sin userId no lee la memoria de nadie ni guarda notas | `verify-agent-prompts.js` |
| 530 | enseñanza por video: el dominio depende de quién enseña; sin perfil no hay hospital; un solo contrato de salida | `verify-agent-prompts.js` |
| 531 | enseñanza por video: el perfil del cuerpo llega normalizado al system_instruction (la especialidad del catálogo, nunca el texto del cliente) | `verify-agent-prompts.js` |
| 532 | interpretación sin video: reporta teach_steps con su promptVersion y temperatura 0.2 | `verify-agent-prompts.js` |
| 533 | WF-DESCRIBE desempata a «dynamic» y «fixed» ya no es un paciente ni un documento | `verify-agent-prompts.js` |
| 534 | cada plataforma reporta su versión, con la de la constitución y la de las cláusulas | `verify-agent-prompts.js` |

La que cierra el asunto es la **501**: mientras el prompt no sea la constitución más el texto de su plataforma, en
ese orden y con los tres perfiles, lo demás es cosmético.

## Lo que NO entra

- Que Mac y Android pregunten médico o persona: el cerebro ya entiende `profile`; las pantallas son de cada cliente.
- Tapar el orquestador de voz del editor: queda medido con techo de `shadow` (excepción E14 de
  `docs/privacy-egress-gateway.md`) hasta que haya un mapa de privacidad por sesión de voz.

## Cierre

- [x] `npm test` → `CONTRATO INTACTO`, sin pendientes
- [x] Cada promesa se vio en rojo antes de su código (las de la rama, al escribirlas; 534 con el sabotaje de las versiones)
- [ ] Probado contra el servidor en marcha con un cliente real
- [x] Estado de este documento: **implementado** (2026-10-01)
