// Qué es «la misma línea» de log, para juntar las repeticiones (spec 001).
//
// El cliente de Windows refleja cada línea de su log, y unas pocas se repiten sin parar cambiando
// solo un número o un nombre: «ubicación cada 1300 ms…», «delante no es SAP («chrome»)…»,
// «marca: «Guardar» (Button)». Medido el 2026-10-01 sobre 408.018 líneas, juntando por usuario,
// etiqueta y hora:
//   con el texto exacto                         170.685 filas
//   sin los números                             100.343
//   sin los números ni lo que va entre comillas  40.873
// Por eso se quitan las dos cosas. La fila que se guarda lleva el texto de la primera aparición,
// con sus números y sus nombres: la plantilla solo decide si la siguiente es «otra vez lo mismo».

const ENTRE_COMILLAS = /«[^»]*»|"[^"]*"/g;
const NUMERO = /\d+(?:[.,]\d+)*/g;
// Con esto sobra para distinguir dos líneas, y una línea de 500 caracteres no hace una clave de 500.
const LARGO_MAXIMO = 160;

function plantillaDeLog(texto) {
  return `${texto == null ? '' : texto}`
    .replace(ENTRE_COMILLAS, '«»')
    .replace(NUMERO, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LARGO_MAXIMO);
}

module.exports = { plantillaDeLog };
