// Rescate oportunista: aprovecha el tráfico real para recuperar las consultas
// que quedaron a medias, sin depender del cron.
//
// POR QUÉ EXISTE
// La cuenta de Vercel es Hobby y ahí los crons solo pueden correr UNA VEZ AL
// DÍA. Un rescate diario significaría que una consulta rota espera hasta 24
// horas, y eso no sirve: el médico la necesita en minutos, no mañana.
//
// La solución no necesita plan de pago: mientras haya médicos trabajando, hay
// peticiones llegando, y cada una es una oportunidad para procesar lo pendiente.
// Si no hay tráfico tampoco hay urgencia — nadie está esperando esa nota.
//
// POR QUÉ ES SEGURO CORTARLO A MITAD
// El trabajo se dispara SIN esperar a que termine, para no añadir ni un
// milisegundo a la respuesta del médico. En serverless eso significa que la
// función puede congelarse antes de acabar. No importa: el claim toma la
// consulta con un lease de 5 minutos, así que si el proceso muere, el lease
// vence y el siguiente ciclo la retoma. La interrupción está contemplada en el
// diseño, no es un accidente que haya que evitar.

// Throttle por instancia: sin esto, un médico con la pantalla abierta dispararía
// un ciclo por cada petición. Con esto, como mucho uno cada pocos minutos.
const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;

function createOpportunisticRescue({ noteRescueService, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  let lastRunAt = 0;
  let running = false;

  return function opportunisticRescue(req, res, next) {
    next(); // La petición del médico sigue de inmediato: esto nunca la retrasa.

    if (!noteRescueService || running) {
      return;
    }
    const now = Date.now();
    if (now - lastRunAt < intervalMs) {
      return;
    }
    lastRunAt = now;
    running = true;

    Promise.resolve()
      .then(() => noteRescueService.run())
      .then((result) => {
        if (result?.rescued > 0) {
          console.log(`[Rescate oportunista] ${result.rescued} consulta(s) recuperadas.`);
        }
      })
      .catch((error) => {
        console.error(`[Rescate oportunista] Falló: ${error.message}`);
      })
      .finally(() => {
        running = false;
      });
  };
}

createOpportunisticRescue.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;

module.exports = createOpportunisticRescue;
