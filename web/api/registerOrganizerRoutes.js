// API pública del organizador para NO médicos (/api/v1/organizer/*).
//
// Mismo movimiento que el lado clínico — audio ya transcrito → reporte
// organizado — pero con un system prompt que se generó para ESTE usuario a
// partir de lo que contó por voz y de las capturas de cómo organiza hoy su
// información. Consumido por la app Android; queda disponible igual para el
// cliente Windows y la web.
//
// Va bajo /api/v1, así que hereda el gate de X-API-Key (requireApiKey) y el
// contexto de atribución de consumo montado en server.js.

const { withFeature } = require('../../src/infrastructure/usage/UsageContext');
const { FEATURES } = require('../../src/domain/usage/vocabulary');

function registerOrganizerRoutes(app, deps = {}) {
  const organizerProfileService = deps.organizerProfileService;

  if (!app || !organizerProfileService) {
    throw new Error('registerOrganizerRoutes requires app and organizerProfileService');
  }

  function fail(res, error, fallback) {
    const status = error?.statusCode || 500;
    if (status >= 500) {
      // El mensaje del proveedor puede traer detalles del prompt: se registra
      // el código, nunca el cuerpo.
      console.error(`[Organizer] ${error?.code || 'INTERNAL_ERROR'}: ${error?.message}`);
    }
    return res.status(status).json({
      error: { code: error?.code || 'INTERNAL_ERROR', message: error?.message || fallback }
    });
  }

  function deviceIdOf(req) {
    return req.body?.device_id || req.body?.deviceId || req.get('X-Miracle-Device-Id') || '';
  }

  // Configuración inicial: la persona contó su oficio en voz alta (Live API) y,
  // si quiso, adjuntó capturas de sus reportes actuales.
  app.post('/api/v1/organizer/profiles', async (req, res) => {
    try {
      const result = await withFeature(FEATURES.ORGANIZER_SETUP, () => organizerProfileService.createProfile({
        deviceId: deviceIdOf(req),
        authUserId: req.body?.auth_user_id || req.body?.authUserId,
        profession: req.body?.profession,
        description: req.body?.description,
        screenshots: req.body?.screenshots
      }));
      return res.status(201).json({
        profile: publicProfile(result.profile),
        summary: result.summary,
        confirmation: result.confirmation,
        warnings: result.warnings
      });
    } catch (error) {
      return fail(res, error, 'No fue posible generar tu configuración.');
    }
  });

  // ¿Ya está configurado este teléfono? La app lo consulta al arrancar para
  // saber si muestra la configuración por voz o va directo a grabar.
  app.get('/api/v1/organizer/profiles/:deviceId', async (req, res) => {
    try {
      const profile = await organizerProfileService.getProfile(req.params.deviceId);
      if (!profile) {
        return res.status(404).json({
          error: { code: 'ORGANIZER_PROFILE_NOT_FOUND', message: 'Este dispositivo aún no está configurado.' }
        });
      }
      return res.json({ profile: publicProfile(profile) });
    } catch (error) {
      return fail(res, error, 'No fue posible leer la configuración.');
    }
  });

  // Ejemplos añadidos después: reescriben el system prompt con el formato real.
  app.post('/api/v1/organizer/profiles/:deviceId/samples', async (req, res) => {
    try {
      const result = await withFeature(FEATURES.ORGANIZER_SETUP, () => organizerProfileService.addSamples({
        deviceId: req.params.deviceId,
        screenshots: req.body?.screenshots
      }));
      return res.json({
        profile: publicProfile(result.profile),
        summary: result.summary,
        confirmation: result.confirmation,
        warnings: result.warnings
      });
    } catch (error) {
      return fail(res, error, 'No fue posible aprender de las capturas.');
    }
  });

  // El movimiento de todos los días: transcripción → reporte organizado.
  app.post('/api/v1/organizer/organize', async (req, res) => {
    try {
      const result = await withFeature(FEATURES.ORGANIZER_STRUCTURING, () => organizerProfileService.organize({
        deviceId: deviceIdOf(req),
        transcript: req.body?.transcript,
        context: req.body?.context
      }));
      return res.json(result);
    } catch (error) {
      return fail(res, error, 'No fue posible organizar el reporte.');
    }
  });
}

// El system prompt generado y las notas de las capturas se quedan en el
// servidor: el cliente solo necesita saber qué se configuró y con qué secciones
// va a pintar el reporte.
function publicProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    id: profile.id,
    device_id: profile.device_id,
    profession: profile.profession,
    occupation: profile.occupation,
    description: profile.description,
    sections: profile.sections,
    sample_count: profile.sample_count,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

registerOrganizerRoutes.publicProfile = publicProfile;

module.exports = registerOrganizerRoutes;
