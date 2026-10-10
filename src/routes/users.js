import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, parseLimit, parseOffset, sendData, requireUuidParams } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id');
router.use(authenticate);

const userStates = ['PENDIENTE', 'ACTIVO', 'BLOQUEADO', 'INACTIVO'];
const roles = ['ADMINISTRADOR', 'GESTOR_INSTITUCIONAL', 'PROFESOR', 'ESTUDIANTE'];
const selectUser = `
  SELECT u.id_usuario AS id, u.nombres, u.apellidos, u.correo, u.estado,
         u.correo_verificado AS "correoVerificado", r.codigo AS rol, u.foto_perfil_url AS "fotoPerfilUrl",
         (u.google_sub IS NOT NULL) AS "vinculadoGoogle",
         u.fecha_registro AS "fechaRegistro", u.fecha_actualizacion AS "fechaActualizacion"
    FROM usuario u LEFT JOIN rol r ON r.id_rol = u.id_rol`;

router.get('/me/institutions', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT i.id_institucion AS id, i.nombre, i.estado, r.codigo AS rol,
            ui.estado AS vinculacion
       FROM usuario_institucion ui
       JOIN institucion i ON i.id_institucion = ui.id_institucion
       JOIN rol r ON r.id_rol = ui.id_rol_institucional
      WHERE ui.id_usuario = $1 ORDER BY i.nombre`,
    [req.user.id],
  );
  sendData(res, result.rows);
}));

// Perfil propio: nombre y foto. La foto es una URL http(s) (p. ej. la de un recurso de /media); null la quita.
router.patch('/me', asyncHandler(async (req, res) => {
  const parsed = z.object({
    nombres: z.string().trim().min(1).max(100).optional(),
    apellidos: z.string().trim().min(1).max(100).optional(),
    fotoPerfilUrl: z.string().url().max(1000).refine((value) => /^https?:\/\//i.test(value), 'La URL debe ser http(s)').nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Perfil inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const fields = parsed.data;
  await query(
    `UPDATE usuario SET
       nombres = COALESCE($2, nombres),
       apellidos = COALESCE($3, apellidos),
       foto_perfil_url = CASE WHEN $4 THEN $5 ELSE foto_perfil_url END,
       fecha_actualizacion = CURRENT_TIMESTAMP
     WHERE id_usuario = $1`,
    [req.user.id, fields.nombres ?? null, fields.apellidos ?? null, 'fotoPerfilUrl' in fields, fields.fotoPerfilUrl ?? null],
  );
  const result = await query(`${selectUser} WHERE u.id_usuario = $1`, [req.user.id]);
  sendData(res, result.rows[0]);
}));

router.get('/', authorize('ADMINISTRADOR'), asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(u.correo ILIKE $${params.length} OR concat(u.nombres, ' ', u.apellidos) ILIKE $${params.length})`);
  }
  if (userStates.includes(req.query.estado)) { params.push(req.query.estado); where.push(`u.estado = $${params.length}`); }
  if (roles.includes(req.query.rol)) { params.push(req.query.rol); where.push(`r.codigo = $${params.length}`); }
  params.push(parseLimit(req.query.limit), parseOffset(req.query.offset));
  const result = await query(
    `${selectUser} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.fecha_registro DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  sendData(res, result.rows);
}));

router.get('/:id', authorize('ADMINISTRADOR'), asyncHandler(async (req, res) => {
  const result = await query(`${selectUser} WHERE u.id_usuario = $1`, [req.params.id]);
  if (!result.rowCount) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
  const institutions = await query(
    `SELECT ui.id_usuario_institucion AS id, i.id_institucion AS "institucionId", i.nombre,
            r.codigo AS rol, ui.estado
       FROM usuario_institucion ui JOIN institucion i ON i.id_institucion = ui.id_institucion
       JOIN rol r ON r.id_rol = ui.id_rol_institucional
      WHERE ui.id_usuario = $1 ORDER BY i.nombre`,
    [req.params.id],
  );
  sendData(res, { ...result.rows[0], instituciones: institutions.rows });
}));

router.patch('/:id', authorize('ADMINISTRADOR'), asyncHandler(async (req, res) => {
  const schema = z.object({
    estado: z.enum(userStates).optional(),
    rol: z.enum(roles).optional(),
    correoVerificado: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo');
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const fields = parsed.data;
  if (req.params.id === req.user.id && ((fields.estado && fields.estado !== 'ACTIVO') || (fields.rol && fields.rol !== 'ADMINISTRADOR'))) {
    throw new HttpError(409, 'No puedes desactivarte ni quitarte el rol de administrador', 'SELF_LOCKOUT');
  }
  const roleId = fields.rol ? (await query('SELECT id_rol FROM rol WHERE codigo = $1', [fields.rol])).rows[0]?.id_rol : undefined;
  if (fields.rol && !roleId) throw new HttpError(400, 'Rol no configurado', 'INVALID_ROLE');

  const updated = await transaction(async (client) => {
    const before = await client.query(`${selectUser} WHERE u.id_usuario = $1 FOR UPDATE OF u`, [req.params.id]);
    if (!before.rowCount) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
    await client.query(
      `UPDATE usuario SET
         estado = COALESCE($2, estado),
         id_rol = COALESCE($3, id_rol),
         correo_verificado = COALESCE($4, correo_verificado),
         fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id_usuario = $1`,
      [req.params.id, fields.estado ?? null, roleId ?? null, fields.correoVerificado ?? null],
    );
    const after = await client.query(`${selectUser} WHERE u.id_usuario = $1`, [req.params.id]);
    // Una cuenta que deja de estar activa o cambia de rol pierde sus sesiones de refresco.
    if ((fields.estado && fields.estado !== 'ACTIVO') || (fields.rol && fields.rol !== before.rows[0].rol)) {
      await client.query('UPDATE sesion_refresco SET fecha_revocacion = CURRENT_TIMESTAMP WHERE id_usuario = $1 AND fecha_revocacion IS NULL', [req.params.id]);
    }
    await audit(client, req, { entidad: 'usuario', entidadId: req.params.id, accion: 'ACTUALIZAR', antes: before.rows[0], despues: after.rows[0] });
    return after.rows[0];
  });
  sendData(res, updated);
}));

export default router;
