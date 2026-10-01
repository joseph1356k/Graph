// Para que un scripts/verify-*.js juzgue promesas NUMERADAS de una spec (docs/specs/NNN-*.md).
//
//   const { promesa, pendiente, saltar, cerrar } = require('./lib/promesas');
//
//   await promesa(1201, 'el enunciado, literal de la spec', async () => {
//     assert.strictEqual(respuesta.status, 403);
//   });
//   cerrar('verify-lo-que-sea');
//
// Cada promesa imprime UNA línea que el juez (scripts/contrato.js) cruza con la fila de la spec:
//   ✔ 1201 · enunciado            se cumple
//   ✘ 1201 · enunciado            no se cumple (el motivo va debajo)
//   ⧗ PENDIENTE 1201 · enunciado  todavía no hay código detrás: cuenta como incumplida
//   ⏭ 1201 · enunciado            no se puede juzgar en esta máquina (sin Postgres, sin navegador…)
//
// El enunciado se escribe aquí igual que en la spec, y el juez lo compara: si difieren, la spec
// miente o el juez juzga otra cosa, y ninguna de las dos puede dar verde.

class Pendiente extends Error {}
class Salto extends Error {}

let rotas = 0;
let juzgadas = 0;

// La capacidad que la promesa necesita todavía no existe. Se llama DENTRO del cuerpo de la promesa:
//   const Servicio = cargar('../src/…/Servicio') || pendiente('Servicio');
function pendiente(capacidad) {
  throw new Pendiente(capacidad);
}

// Esta máquina no puede juzgarla (falta una base real, un navegador…). No es verde ni rojo: el juez
// la cuenta aparte y la nombra en el veredicto.
function saltar(motivo) {
  throw new Salto(motivo);
}

async function promesa(numero, enunciado, cuerpo) {
  juzgadas += 1;
  try {
    await cuerpo();
    console.log(`  ✔ ${numero} · ${enunciado}`);
  } catch (error) {
    if (error instanceof Pendiente) {
      rotas += 1;
      console.log(`  ⧗ PENDIENTE ${numero} · ${enunciado}`);
      console.log(`      «${error.message}» todavía no existe`);
    } else if (error instanceof Salto) {
      console.log(`  ⏭ ${numero} · ${enunciado}`);
      console.log(`      ${error.message}`);
    } else {
      rotas += 1;
      console.log(`  ✘ ${numero} · ${enunciado}`);
      // La cadena entera: un «cause» que se pierde convierte un fallo de red en «no se sabe». El
      // mensaje va en una línea (el de assert trae saltos), y debajo, dónde ocurrió.
      for (let e = error; e; e = e.cause) {
        console.log(`      ${`${e.message || e}`.replace(/\s*\n\s*/g, ' ')}`);
        const donde = `${e.stack || ''}`.split('\n').filter((linea) => /^\s+at /.test(linea) && !linea.includes('node:internal'));
        for (const linea of donde.slice(0, 3)) console.log(`      ${linea.trim()}`);
      }
    }
  }
}

function cerrar(nombre) {
  console.log(`\n${nombre}: ${juzgadas - rotas} de ${juzgadas} promesas, ${rotas} incumplidas`);
  process.exitCode = rotas ? 1 : 0;
}

module.exports = { promesa, pendiente, saltar, cerrar };
