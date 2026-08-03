const crypto = require('crypto');
const { isClinicalError } = require('../../src/application/use-cases/ClinicalErrors');

// Enrolamiento por instalación y vínculo médico↔equipo.
//
// TRES carriles, deliberadamente separados:
//
//   POST /api/v1/enroll              → key de ENROLAMIENTO (GRAPH_ENROLL_KEYS, la
//                                      embebida en el .exe). Lo ÚNICO que puede
//                                      hacer esa key es dar de alta un dispositivo.
//   POST /api/v1/devices/pair-code   → token per-install (el del enroll). Solo un
//                                      dispositivo real pide códigos: las keys de
//                                      env de MIRACLE_API_KEYS NO sirven aquí.
//   /api/clinical/devices/*          → JWT del médico (requireClinicalAuth, lo
//                                      monta server.js). Canjear el código,
//                                      listar y revocar vínculos son actos del
//                                      médico; un aparato jamás se auto-vincula.

function respondDeviceError(res, error, logPrefix) {
  if (isClinicalError(error)) {
    return res.status(error.statusCode || 500).json({
      error: { code: error.code, message: error.message }
    });
  }
  console.error(`${logPrefix} ${error.message}`);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' }
  });
}

// GRAPH_ENROLL_KEYS = "key1,key2" (rotación: se aceptan varias a la vez).
function parseEnrollKeys(raw) {
  return `${raw || ''}`
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function timingSafeMatch(candidate, keys) {
  const candidateBuffer = Buffer.from(`${candidate || ''}`, 'utf8');
  let matched = false;
  for (const key of keys) {
    const keyBuffer = Buffer.from(key, 'utf8');
    if (keyBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(keyBuffer, candidateBuffer)) {
      matched = true;
    }
  }
  return matched;
}

function registerDeviceRoutes(app, deps = {}) {
  const windowsDeviceService = deps.windowsDeviceService;
  const enrollKeys = parseEnrollKeys(deps.enrollKeys ?? process.env.GRAPH_ENROLL_KEYS);

  function requireService(res) {
    if (!windowsDeviceService) {
      res.status(503).json({
        error: {
          code: 'SUPABASE_NOT_CONFIGURED',
          message: 'El registro de dispositivos no está configurado en este entorno.'
        }
      });
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Carril de enrolamiento (key embebida, bajo privilegio)
  // -------------------------------------------------------------------------

  // Da de alta la instalación y devuelve el token per-install UNA sola vez.
  // Re-enrolar el mismo device_id rota el token (el viejo muere al instante).
  app.post('/api/v1/enroll', async (req, res) => {
    if (!requireService(res)) return;
    try {
      if (!enrollKeys.length) {
        return res.status(503).json({
          error: {
            code: 'SUPABASE_NOT_CONFIGURED',
            message: 'El enrolamiento no está habilitado en este entorno (GRAPH_ENROLL_KEYS).'
          }
        });
      }
      const candidate = `${req.get('x-api-key') || ''}`.trim();
      if (!timingSafeMatch(candidate, enrollKeys)) {
        return res.status(401).json({
          error: { code: 'ENROLL_FORBIDDEN', message: 'Key de enrolamiento inválida.' }
        });
      }
      const result = await windowsDeviceService.enroll({
        deviceId: req.body?.device_id,
        label: req.body?.label
      });
      return res.status(201).json({
        ok: true,
        token: result.token,
        device: { device_id: result.device.deviceId, label: result.device.label }
      });
    } catch (error) {
      return respondDeviceError(res, error, '[Enroll]');
    }
  });

  // -------------------------------------------------------------------------
  // Carril del dispositivo (token per-install)
  // -------------------------------------------------------------------------

  // El equipo pide un código para mostrarlo en pantalla. Deliberadamente NO
  // pasa por requireApiKey: una key admin de env no es un dispositivo.
  app.post('/api/v1/devices/pair-code', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const token = `${req.get('x-api-key') || ''}`.trim();
      const device = await windowsDeviceService.deviceByToken(token);
      if (!device) {
        return res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Token de dispositivo inválido o revocado.' }
        });
      }
      const result = await windowsDeviceService.createPairingCode(device);
      return res.status(201).json({ ok: true, code: result.code, expires_at: result.expiresAt });
    } catch (error) {
      return respondDeviceError(res, error, '[PairCode]');
    }
  });

  // -------------------------------------------------------------------------
  // Carril del médico (JWT — requireClinicalAuth montado en server.js)
  // -------------------------------------------------------------------------

  // Canjea el código que muestra el equipo. Un solo uso, atómico; respuesta
  // única 'invalid' para todo lo que no sea un canje limpio.
  app.post('/api/clinical/devices/claim-pairing', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const result = await windowsDeviceService.claimPairing({
        code: req.body?.code,
        doctor: { id: `${req.clinicalUser?.id || ''}` }
      });
      return res.status(200).json({
        ok: true,
        link_id: result.linkId,
        device: { device_id: result.device.deviceId, label: result.device.label }
      });
    } catch (error) {
      return respondDeviceError(res, error, '[ClaimPairing]');
    }
  });

  // Los equipos vinculados del médico (para el panel de Notes).
  app.get('/api/clinical/devices', async (req, res) => {
    if (!requireService(res)) return;
    try {
      const links = await windowsDeviceService.listLinks(`${req.clinicalUser?.id || ''}`);
      return res.status(200).json({
        ok: true,
        devices: links.map((link) => ({
          link_id: link.linkId,
          device_id: link.deviceId,
          label: link.label,
          approved_at: link.approvedAt,
          last_seen: link.lastSeen
        }))
      });
    } catch (error) {
      return respondDeviceError(res, error, '[ListDevices]');
    }
  });

  // Desvincular un equipo propio. La credencial del equipo sigue viva (puede
  // seguir exportando a SAP); lo que muere es la delegación clínica.
  app.post('/api/clinical/devices/:linkId/revoke', async (req, res) => {
    if (!requireService(res)) return;
    try {
      await windowsDeviceService.revokeLink(req.params.linkId, `${req.clinicalUser?.id || ''}`);
      return res.status(200).json({ ok: true });
    } catch (error) {
      return respondDeviceError(res, error, '[RevokeLink]');
    }
  });
}

module.exports = registerDeviceRoutes;
