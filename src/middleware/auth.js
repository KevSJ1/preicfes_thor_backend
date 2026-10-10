import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { HttpError, isUuid } from '../utils/http.js';

export async function authenticate(req, _res, next) {
  try {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Autenticación requerida', 'UNAUTHORIZED');
    let payload;
    try { payload = jwt.verify(token, env.JWT_ACCESS_SECRET); }
    catch { throw new HttpError(401, 'Token inválido o expirado', 'UNAUTHORIZED'); }
    if (!isUuid(payload.sub)) throw new HttpError(401, 'Token inválido o expirado', 'UNAUTHORIZED');

    const institutionId = req.get('x-institution-id') || null;
    if (institutionId && !isUuid(institutionId)) throw new HttpError(400, 'X-Institution-Id debe ser un UUID', 'VALIDATION_ERROR');

    const result = await query(
      `SELECT u.id_usuario, u.nombres, u.apellidos, u.correo, u.estado, u.foto_perfil_url,
              r.codigo AS rol_global
         FROM usuario u LEFT JOIN rol r ON r.id_rol = u.id_rol
        WHERE u.id_usuario = $1`,
      [payload.sub],
    );
    const user = result.rows[0];
    if (!user || user.estado !== 'ACTIVO') throw new HttpError(401, 'La sesión no es válida', 'UNAUTHORIZED');

    let rolInstitucional = null;
    if (institutionId) {
      const membership = await query(
        `SELECT r.codigo
           FROM usuario_institucion ui
           JOIN rol r ON r.id_rol = ui.id_rol_institucional
           JOIN institucion i ON i.id_institucion = ui.id_institucion
          WHERE ui.id_usuario = $1 AND ui.id_institucion = $2 AND ui.estado = 'ACTIVA' AND i.estado = 'ACTIVA'`,
        [user.id_usuario, institutionId],
      );
      rolInstitucional = membership.rows[0]?.codigo ?? null;
    }

    req.user = {
      id: user.id_usuario,
      nombres: user.nombres,
      apellidos: user.apellidos,
      correo: user.correo,
      fotoPerfilUrl: user.foto_perfil_url,
      rol: user.rol_global,
      rolInstitucional,
      // Solo se expone la institución si la vinculación activa fue verificada.
      idInstitucion: rolInstitucional ? institutionId : null,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function authorize(...roles) {
  return (req, _res, next) => {
    const granted = [req.user?.rol, req.user?.rolInstitucional].filter(Boolean);
    if (!granted.some((role) => roles.includes(role))) {
      return next(new HttpError(403, 'No tienes permisos para esta operación', 'FORBIDDEN'));
    }
    next();
  };
}

export function signAccessToken(userId) {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: env.ACCESS_TOKEN_TTL });
}
