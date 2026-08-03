const requireClinicalAuth = require('./requireClinicalAuth');

// Actor clínico: médico por JWT O aparato vinculado por token per-install.
//
// El carril del navegador NO se toca: si la request trae Authorization: Bearer
// (o no trae credencial ninguna), este middleware DELEGA en requireClinicalAuth
// tal cual — mismo archivo, mismas decisiones, incluido su escape de dev. Lo
// nuevo es solo la rama X-API-Key: un token per-install con vínculo médico
// aprobado se convierte en req.clinicalUser CON LA IDENTIDAD DEL MÉDICO
// vinculado, y las rutas clínicas funcionan sin enterarse (resolveDoctorId lee
// req.clinicalUser.id, que aquí es el uuid del médico).
//
// Lo que un aparato NUNCA es:
//   · actor institucional (canManageInstitutional siempre false);
//   · actor de /api/clinical/exports ni /api/clinical/devices — esas rutas se
//     montan con requireClinicalAuth directo en server.js (solo JWT);
//   · firmante — firmar ni siquiera existe en Graph (es una server action de
//     Notes con hash + CAS).
//
// req.clinicalDevice solo existe cuando actúa un aparato: es lo que usan la
// auditoría (atribución «Equipo <label>») y el refresh del espejo.
function createRequireClinicalActor({ windowsDeviceService } = {}) {
  return function requireClinicalActor(req, res, next) {
    const bearer = `${req.get('authorization') || ''}`.trim();
    const deviceToken = `${req.get('x-api-key') || ''}`.trim();

    if (bearer || !deviceToken) {
      return requireClinicalAuth(req, res, next);
    }

    if (!windowsDeviceService) {
      return res.status(503).json({
        error: {
          code: 'SUPABASE_NOT_CONFIGURED',
          message: 'El carril de aparatos no está configurado en este entorno.'
        }
      });
    }

    return windowsDeviceService
      .resolveClinicalActor(deviceToken)
      .then((actor) => {
        if (!actor.device) {
          return res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Token de dispositivo inválido o revocado.' }
          });
        }
        if (!actor.link) {
          // El cliente Windows usa este código para mostrar la pantalla del
          // código de emparejamiento: enrolado sí, pero sin médico que lo avale.
          return res.status(403).json({
            error: {
              code: 'DEVICE_NOT_PAIRED',
              message: 'Este equipo no está vinculado a ningún médico. Genera un código y canjéalo en Miracle Notes.'
            }
          });
        }
        req.clinicalUser = {
          id: actor.doctor.id,
          email: actor.doctor.email,
          role: 'device',
          canManageInstitutional: false
        };
        req.clinicalDevice = {
          deviceId: actor.device.device_id,
          deviceRowId: actor.device.id,
          label: actor.device.label,
          linkId: actor.link.id,
          organizationId: actor.organizationId,
          doctorName: actor.doctor.fullName
        };
        return next();
      })
      .catch((error) => {
        // La base no contestó: 503 reintentable, no 401 — un 401 le diría al
        // aparato que lo revocaron y no es verdad.
        console.error(`[ActorClinico] Validación de aparato falló: ${error.message}`);
        return res.status(503).json({
          error: { code: 'SUPABASE_NOT_CONFIGURED', message: 'No se pudo validar la credencial. Reintenta.' }
        });
      });
  };
}

module.exports = createRequireClinicalActor;
