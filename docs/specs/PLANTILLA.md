# NNN — <el resultado, no el área>

Estado: **propuesto** · Nace del diagnóstico del <AAAA-MM-DD> · Rama: `<persona>/<que-hace>`

<!-- Copiar a docs/specs/NNN-<slug>.md. NNN es el siguiente número libre, y sus promesas se numeran
     desde NNN×100+1 (la spec 012 usa 1201, 1202…): dos ramas paralelas no chocan de número. -->

## Diagnóstico: qué se midió

<!-- Lo MEDIDO, con fecha y con fuente: los logs de Vercel, una llamada real a la ruta, la salida de
     un verify. Una spec que describe un futuro sin haber medido el presente inventa el problema. -->

| Qué | Medida | Fuente |
|---|---|---|
| | | |

## Promesas

<!-- Una frase en presente, falsa hoy y verdadera después, que no nombre la implementación. El
     enunciado va LITERAL en el verify (scripts/lib/promesas.js): el juez los compara.
     «Juez» es el scripts/verify-*.js que la juzga. Varias promesas pueden tener el mismo juez.
     Las que ya se cumplen entran igual, para congelarlas. Una promesa retirada se tacha (~~así~~)
     y su número no se recicla. -->

| # | Promesa | Juez |
|---|---|---|
| NNN01 | | `verify-<slug>.js` |
| NNN02 | | `verify-<slug>.js` |

<!-- Cuál es la promesa que cierra el asunto: la que, mientras no exista, deja que lo demás sea
     cosmético. -->

## Las fases

<!-- Una fase = un commit que pone verde UNA promesa sin romper las anteriores. Toda la spec vive
     en una rama; no se mergea fase a fase. -->

| Fase | Promesa que pone verde | Qué toca | Sitios con esta clase de error |
|---|---|---|---|
| 1 | NNN01 | `src/…` | N, contados con grep |

## Lo que NO entra

<!-- Y por qué. Si la feature cruza a un cliente (Windows, Android, Mac, el portal), su mitad vive
     en la spec de ese proyecto y va en la misma rama: aquí se cita. -->

## Hallazgos

<!-- Se rellena DURANTE la implementación, con fecha. El plan se corrige con lo que se mide. -->

## Cierre

- [ ] `npm test` → `CONTRATO INTACTO`, sin pendientes
- [ ] Cada promesa se vio en rojo antes de su código, y otra vez al romper el código a propósito
- [ ] Probado contra el servidor en marcha (`npm start`), con la llamada y la respuesta pegadas en el PR
- [ ] Estado de este documento: **implementado** (AAAA-MM-DD)
