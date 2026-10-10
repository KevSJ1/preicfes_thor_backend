import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, parseLimit, requireUuidParams, sendData } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id', 'memberId');
router.use(authenticate);

const institutionFields = {
  nit: z.string().trim().max(30).nullable().optional(),
  correo: z.string().trim().email().max(254).nullable().optional(),
  telefono: z.string().trim().max(30).nullable().optional(),
  direccion: z.string().trim().max(255).nullable().optional(),
  ciudad: z.string().trim().max(100).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
};
const columnOf = { nombre: 'nombre', nit: 'nit', correo: 'correo', telefono: 'telefono', direccion: 'direccion', ciudad: 'ciudad', logoUrl: 'logo_url', estado: 'estado' };
const institutionColumns = `id_institucion AS id, nombre, nit, correo, telefono, direccion, ciudad, logo_url AS "logoUrl", estado`;

const isAdmin = (user) => user.rol === 'ADMINISTRADOR';
const isManagerOf = (user, institutionId) => user.rolInstitucional === 'GESTOR_INSTITUCIONAL' && user.idInstitucion === institutionId;

router.get('/', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT i.id_institucion AS id, i.nombre, i.nit, i.correo, i.telefono, i.ciudad, i.estado,
            ui.estado AS vinculacion, r.codigo AS rol
       FROM institucion i
       LEFT JOIN usuario_institucion ui ON ui.id_institucion = i.id_institucion AND ui.id_usuario = $1
       LEFT JOIN rol r ON r.id_rol = ui.id_rol_institucional
      WHERE (ui.id_usuario IS NOT NULL AND ui.estado = 'ACTIVA') OR $2 = 'ADMINISTRADOR'
      ORDER BY i.nombre LIMIT $3`,
    [req.user.id, req.user.rol, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.post('/', authorize('ADMINISTRADOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({ nombre: z.string().trim().min(1).max(180), ...institutionFields }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Institución inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const data = parsed.data;
  const created = await transaction(async (client) => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO institucion (id_institucion, id_creada_por, nombre, nit, correo, telefono, direccion, ciudad, logo_url, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, lower($5), $6, $7, $8, $9, CURRENT_TIMESTAMP)
       RETURNING ${institutionColumns}`,
      [id, req.user.id, data.nombre, data.nit ?? null, data.correo ?? null, data.telefono ?? null, data.direccion ?? null, data.ciudad ?? null, data.logoUrl ?? null],
    );
    await audit(client, req, { entidad: 'institucion', entidadId: id, accion: 'CREAR', institucionId: id, despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, created, 201);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT i.id_institucion AS id, i.nombre, i.nit, i.correo, i.telefono, i.direccion, i.ciudad,
            i.logo_url AS "logoUrl", i.estado,
            ui.estado AS vinculacion, r.codigo AS rol
       FROM institucion i
       LEFT JOIN usuario_institucion ui ON ui.id_institucion = i.id_institucion AND ui.id_usuario = $2
       LEFT JOIN rol r ON r.id_rol = ui.id_rol_institucional
      WHERE i.id_institucion = $1 AND ((ui.id_usuario IS NOT NULL AND ui.estado = 'ACTIVA') OR $3 = 'ADMINISTRADOR')`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!result.rowCount) throw new HttpError(404, 'Institución no encontrada', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

// Administrador y gestor ven todas las aulas de la institución; un profesor solo las suyas.
router.get('/:id/progress', asyncHandler(async (req, res) => {
  const membership = await query(
    `SELECT r.codigo FROM usuario_institucion ui JOIN rol r ON r.id_rol = ui.id_rol_institucional
      WHERE ui.id_institucion = $1 AND ui.id_usuario = $2 AND ui.estado = 'ACTIVA'`,
    [req.params.id, req.user.id],
  );
  const role = membership.rows[0]?.codigo;
  if (!isAdmin(req.user) && !role) throw new HttpError(404, 'Institución no encontrada', 'NOT_FOUND');
  const onlyOwn = !isAdmin(req.user) && role !== 'GESTOR_INSTITUCIONAL';
  const result = await query(
    `SELECT id_institucion AS "institucionId", nombre_institucion AS "institucion",
            id_profesor AS "profesorId", nombre_profesor AS "profesor",
            id_aula AS "aulaId", nombre_aula AS aula,
            total_estudiantes_evaluados AS "estudiantesEvaluados",
            intentos_finalizados AS "intentosFinalizados", promedio_porcentaje AS "promedioPorcentaje",
            fecha_ultimo_intento AS "ultimoIntento"
       FROM vista_progreso_institucion
      WHERE id_institucion = $1 AND (NOT $2 OR id_profesor = $3)
      ORDER BY nombre_profesor, nombre_aula`,
    [req.params.id, onlyOwn, req.user.id],
  );
  sendData(res, result.rows);
}));

router.patch('/:id', authorize('ADMINISTRADOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user) && !isManagerOf(req.user, req.params.id)) throw new HttpError(403, 'No puedes modificar esta institución', 'FORBIDDEN');
  const parsed = z.object({ nombre: z.string().trim().min(1).max(180).optional(), ...institutionFields, estado: z.enum(['ACTIVA', 'INACTIVA', 'BLOQUEADA']).optional() })
    .strict().refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización de institución inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  if (parsed.data.estado && !isAdmin(req.user)) throw new HttpError(403, 'Solo un administrador puede cambiar el estado de la institución', 'FORBIDDEN');
  // Los campos enviados explícitamente como null se vacían; los omitidos se conservan.
  const params = [req.params.id];
  const sets = Object.entries(parsed.data).map(([field, value]) => {
    params.push(field === 'correo' && value ? value.toLowerCase() : value);
    return `${columnOf[field]} = $${params.length}`;
  });
  const updated = await transaction(async (client) => {
    const before = await client.query(`SELECT ${institutionColumns} FROM institucion WHERE id_institucion = $1 FOR UPDATE`, [req.params.id]);
    if (!before.rowCount) throw new HttpError(404, 'Institución no encontrada', 'NOT_FOUND');
    const result = await client.query(
      `UPDATE institucion SET ${sets.join(', ')}, fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_institucion = $1 RETURNING ${institutionColumns}`,
      params,
    );
    await audit(client, req, { entidad: 'institucion', entidadId: req.params.id, accion: 'ACTUALIZAR', institucionId: req.params.id, antes: before.rows[0], despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, updated);
}));

const memberColumns = `
  ui.id_usuario_institucion AS id, u.id_usuario AS "usuarioId", u.nombres, u.apellidos,
  u.correo, u.estado AS "estadoUsuario", r.codigo AS rol, ui.estado,
  ui.fecha_vinculacion AS "fechaVinculacion", ui.fecha_desvinculacion AS "fechaDesvinculacion"`;
const memberJoins = `
  FROM usuario_institucion ui JOIN usuario u ON u.id_usuario = ui.id_usuario
  JOIN rol r ON r.id_rol = ui.id_rol_institucional`;

function assertCanManageMembers(req) {
  if (!isAdmin(req.user) && !isManagerOf(req.user, req.params.id)) {
    throw new HttpError(403, 'Acceso denegado a los miembros de esta institución', 'FORBIDDEN');
  }
}

router.get('/:id/members', authorize('ADMINISTRADOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  assertCanManageMembers(req);
  const result = await query(
    `SELECT ${memberColumns} ${memberJoins}
      WHERE ui.id_institucion = $1 ORDER BY u.apellidos, u.nombres LIMIT $2`,
    [req.params.id, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

/*
 * Vincula (o reactiva) a un usuario existente. Su rol global debe ser PROFESOR o GESTOR_INSTITUCIONAL
 * (lo asigna un administrador en PATCH /users/:id); el trigger de la base también lo exige.
 * Un gestor solo puede vincular profesores; los gestores los vincula un administrador.
 */
router.post('/:id/members', authorize('ADMINISTRADOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  assertCanManageMembers(req);
  const parsed = z.object({ correo: z.string().trim().email().max(254), rol: z.enum(['PROFESOR', 'GESTOR_INSTITUCIONAL']) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Vinculación inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  if (parsed.data.rol === 'GESTOR_INSTITUCIONAL' && !isAdmin(req.user)) throw new HttpError(403, 'Solo un administrador puede vincular gestores', 'FORBIDDEN');

  const member = await transaction(async (client) => {
    const institution = await client.query('SELECT estado FROM institucion WHERE id_institucion = $1', [req.params.id]);
    if (!institution.rowCount) throw new HttpError(404, 'Institución no encontrada', 'NOT_FOUND');
    const userResult = await client.query(
      `SELECT u.id_usuario, u.estado, r.codigo AS rol FROM usuario u LEFT JOIN rol r ON r.id_rol = u.id_rol
        WHERE lower(u.correo) = lower($1)`,
      [parsed.data.correo],
    );
    const user = userResult.rows[0];
    if (!user) throw new HttpError(404, 'No existe un usuario con ese correo', 'USER_NOT_FOUND');
    if (user.rol !== parsed.data.rol) {
      throw new HttpError(400, `El usuario debe tener rol global ${parsed.data.rol}; un administrador debe asignarlo primero`, 'ROLE_MISMATCH');
    }
    const roleId = (await client.query('SELECT id_rol FROM rol WHERE codigo = $1', [parsed.data.rol])).rows[0].id_rol;
    const result = await client.query(
      `INSERT INTO usuario_institucion (id_usuario_institucion, id_institucion, id_usuario, id_rol_institucional)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_institucion, id_usuario) DO UPDATE SET
         estado = 'ACTIVA', id_rol_institucional = EXCLUDED.id_rol_institucional, fecha_desvinculacion = NULL
       RETURNING id_usuario_institucion`,
      [randomUUID(), req.params.id, user.id_usuario, roleId],
    );
    const id = result.rows[0].id_usuario_institucion;
    await audit(client, req, { entidad: 'usuario_institucion', entidadId: id, accion: 'VINCULAR', institucionId: req.params.id, despues: { usuarioId: user.id_usuario, rol: parsed.data.rol } });
    return (await client.query(`SELECT ${memberColumns} ${memberJoins} WHERE ui.id_usuario_institucion = $1`, [id])).rows[0];
  });
  sendData(res, member, 201);
}));

router.patch('/:id/members/:memberId', authorize('ADMINISTRADOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  assertCanManageMembers(req);
  const parsed = z.object({ estado: z.enum(['ACTIVA', 'INACTIVA', 'RETIRADA']) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización de miembro inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const updated = await transaction(async (client) => {
    const found = await client.query(
      `SELECT ui.id_usuario, ui.estado, r.codigo AS rol ${memberJoins}
        WHERE ui.id_usuario_institucion = $1 AND ui.id_institucion = $2 FOR UPDATE OF ui`,
      [req.params.memberId, req.params.id],
    );
    const member = found.rows[0];
    if (!member) throw new HttpError(404, 'Miembro no encontrado en esta institución', 'NOT_FOUND');
    if (!isAdmin(req.user) && (member.rol === 'GESTOR_INSTITUCIONAL' || member.id_usuario === req.user.id)) {
      throw new HttpError(403, 'Un gestor solo puede cambiar la vinculación de profesores', 'FORBIDDEN');
    }
    await client.query(
      `UPDATE usuario_institucion SET estado = $2::estado_vinculacion,
              fecha_desvinculacion = CASE WHEN $2::estado_vinculacion = 'ACTIVA' THEN NULL ELSE COALESCE(fecha_desvinculacion, CURRENT_TIMESTAMP) END
        WHERE id_usuario_institucion = $1`,
      [req.params.memberId, parsed.data.estado],
    );
    await audit(client, req, { entidad: 'usuario_institucion', entidadId: req.params.memberId, accion: 'CAMBIAR_ESTADO', institucionId: req.params.id, antes: { estado: member.estado }, despues: { estado: parsed.data.estado } });
    return (await client.query(`SELECT ${memberColumns} ${memberJoins} WHERE ui.id_usuario_institucion = $1`, [req.params.memberId])).rows[0];
  });
  sendData(res, updated);
}));

export default router;
