import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, isUuid, parseLimit, requireUuidParams, sendData } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id', 'assignmentId', 'invitationId', 'enrollmentId');
router.use(authenticate);

const staff = authorize('ADMINISTRADOR', 'GESTOR_INSTITUCIONAL', 'PROFESOR');

async function getClassroom(id) {
  const result = await query('SELECT id_aula, id_institucion, id_profesor, estado FROM aula WHERE id_aula = $1', [id]);
  return result.rows[0];
}

function assertCanManage(classroom, user) {
  if (!classroom) throw new HttpError(404, 'Aula no encontrada', 'NOT_FOUND');
  if (user.rol === 'ADMINISTRADOR' || classroom.id_profesor === user.id) return;
  if (user.rolInstitucional === 'GESTOR_INSTITUCIONAL' && user.idInstitucion === classroom.id_institucion) return;
  throw new HttpError(403, 'No tienes acceso a esta aula', 'FORBIDDEN');
}

// Las asignaciones solo las crea/modifica el profesor del aula (lo exige también el trigger de la base).
function assertOwner(classroom, user) {
  if (!classroom) throw new HttpError(404, 'Aula no encontrada', 'NOT_FOUND');
  if (classroom.id_profesor !== user.id) throw new HttpError(403, 'Solo el profesor del aula puede gestionar sus asignaciones', 'FORBIDDEN');
}

// Estado efectivo de una asignación según sus fechas, calculado con el reloj de la base.
const assignmentAvailability = `
  CASE WHEN aa.estado IN ('CERRADA', 'CANCELADA') THEN aa.estado::text
       WHEN aa.fecha_cierre IS NOT NULL AND aa.fecha_cierre <= CURRENT_TIMESTAMP THEN 'CERRADA'
       WHEN aa.fecha_apertura > CURRENT_TIMESTAMP THEN 'PROGRAMADA'
       ELSE 'ABIERTA' END`;

const classroomColumns = `
  a.id_aula AS id, a.id_institucion AS "institucionId", i.nombre AS institucion,
  a.id_profesor AS "profesorId", concat(p.nombres, ' ', p.apellidos) AS profesor,
  a.nombre, a.descripcion, a.estado, a.fecha_creacion AS "fechaCreacion",
  (SELECT count(*)::int FROM matricula_aula ma WHERE ma.id_aula = a.id_aula AND ma.estado = 'ACTIVA') AS "estudiantesActivos"`;
const classroomJoins = `
  FROM aula a JOIN institucion i ON i.id_institucion = a.id_institucion
  JOIN usuario p ON p.id_usuario = a.id_profesor`;

router.get('/', staff, asyncHandler(async (req, res) => {
  const params = [];
  const filters = [];
  if (req.user.rol !== 'ADMINISTRADOR') {
    if (req.user.rolInstitucional === 'GESTOR_INSTITUCIONAL') {
      params.push(req.user.idInstitucion); filters.push(`a.id_institucion = $${params.length}`);
    } else {
      params.push(req.user.id); filters.push(`a.id_profesor = $${params.length}`);
    }
  } else if (req.query.institucionId) {
    if (!isUuid(req.query.institucionId)) throw new HttpError(400, 'institucionId inválido', 'VALIDATION_ERROR');
    params.push(req.query.institucionId); filters.push(`a.id_institucion = $${params.length}`);
  }
  if (['ACTIVA', 'ARCHIVADA', 'INACTIVA'].includes(req.query.estado)) { params.push(req.query.estado); filters.push(`a.estado = $${params.length}`); }
  params.push(parseLimit(req.query.limit));
  const result = await query(
    `SELECT ${classroomColumns} ${classroomJoins}
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY a.fecha_creacion DESC LIMIT $${params.length}`,
    params,
  );
  sendData(res, result.rows);
}));

router.post('/', authorize('PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({ nombre: z.string().trim().min(1).max(150), descripcion: z.string().max(500).nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Datos de aula inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
  if (req.user.rol !== 'PROFESOR' || !req.user.idInstitucion) {
    throw new HttpError(400, 'Envía X-Institution-Id con una institución activa a la que estés vinculado como profesor', 'INSTITUTION_REQUIRED');
  }
  const result = await query(
    `INSERT INTO aula (id_aula, id_institucion, id_profesor, nombre, descripcion, fecha_actualizacion)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     RETURNING id_aula AS id, id_institucion AS "institucionId", nombre, descripcion, estado`,
    [randomUUID(), req.user.idInstitucion, req.user.id, parsed.data.nombre, parsed.data.descripcion ?? null],
  );
  sendData(res, result.rows[0], 201);
}));

// Aulas del estudiante autenticado, con sus asignaciones y los intentos usados en cada una.
router.get('/mine', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT a.id_aula AS id, a.nombre, a.descripcion, a.estado, i.nombre AS institucion,
            concat(p.nombres, ' ', p.apellidos) AS profesor, ma.fecha_ingreso AS "fechaIngreso",
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', aa.id_asignacion, 'cuestionarioId', aa.id_cuestionario, 'cuestionario', c.nombre,
                'fechaApertura', aa.fecha_apertura, 'fechaCierre', aa.fecha_cierre,
                'intentosPermitidos', aa.intentos_permitidos, 'estado', ${assignmentAvailability},
                'intentosUsados', (SELECT count(*) FROM intento_asignado ia JOIN intento it ON it.id_intento = ia.id_intento
                                    WHERE ia.id_asignacion = aa.id_asignacion AND it.id_estudiante = $1),
                'intentoEnProgreso', (SELECT it.id_intento FROM intento_asignado ia JOIN intento it ON it.id_intento = ia.id_intento
                                       WHERE ia.id_asignacion = aa.id_asignacion AND it.id_estudiante = $1
                                         AND it.estado = 'EN_PROGRESO' LIMIT 1))
                ORDER BY aa.fecha_apertura DESC)
                FROM asignacion_aula aa JOIN cuestionario c ON c.id_cuestionario = aa.id_cuestionario
               WHERE aa.id_aula = a.id_aula AND aa.estado <> 'CANCELADA'), '[]'::jsonb) AS asignaciones
       FROM matricula_aula ma
       JOIN aula a ON a.id_aula = ma.id_aula
       JOIN institucion i ON i.id_institucion = a.id_institucion
       JOIN usuario p ON p.id_usuario = a.id_profesor
      WHERE ma.id_estudiante = $1 AND ma.estado = 'ACTIVA' AND a.estado = 'ACTIVA'
      ORDER BY ma.fecha_ingreso DESC`,
    [req.user.id],
  );
  sendData(res, result.rows);
}));

router.post('/enroll', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const parsed = z.object({ codigo: z.string().trim().min(1).max(80) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Código de invitación requerido', 'VALIDATION_ERROR');
  const enrollment = await transaction(async (client) => {
    const invitationResult = await client.query(
      `SELECT iv.id_invitacion, iv.id_aula, iv.activa, iv.usos_maximos, iv.usos_realizados, a.estado AS estado_aula,
              (iv.fecha_expiracion IS NOT NULL AND iv.fecha_expiracion <= CURRENT_TIMESTAMP) AS vencida
         FROM invitacion_aula iv JOIN aula a ON a.id_aula = iv.id_aula
        WHERE iv.codigo = upper($1) FOR UPDATE OF iv`,
      [parsed.data.codigo],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation || !invitation.activa || invitation.estado_aula !== 'ACTIVA' || invitation.vencida
        || (invitation.usos_maximos !== null && invitation.usos_realizados >= invitation.usos_maximos)) {
      throw new HttpError(400, 'La invitación no es válida, está vencida o agotó sus usos', 'INVITATION_INVALID');
    }
    const existing = await client.query('SELECT estado FROM matricula_aula WHERE id_aula = $1 AND id_estudiante = $2', [invitation.id_aula, req.user.id]);
    if (existing.rowCount) {
      throw new HttpError(409, existing.rows[0].estado === 'ACTIVA' ? 'Ya estás matriculado en esta aula' : 'Tu matrícula en esta aula fue retirada o bloqueada; contacta al profesor', 'ALREADY_ENROLLED');
    }
    const inserted = await client.query(
      `INSERT INTO matricula_aula (id_matricula, id_aula, id_estudiante, id_invitacion)
       VALUES ($1, $2, $3, $4) RETURNING id_matricula AS id, id_aula AS "aulaId", estado`,
      [randomUUID(), invitation.id_aula, req.user.id, invitation.id_invitacion],
    );
    await client.query('UPDATE invitacion_aula SET usos_realizados = usos_realizados + 1 WHERE id_invitacion = $1', [invitation.id_invitacion]);
    return inserted.rows[0];
  });
  sendData(res, enrollment, 201);
}));

router.get('/:id', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const result = await query(`SELECT ${classroomColumns} ${classroomJoins} WHERE a.id_aula = $1`, [req.params.id]);
  sendData(res, result.rows[0]);
}));

router.patch('/:id', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const parsed = z.object({ nombre: z.string().trim().min(1).max(150).optional(), descripcion: z.string().max(500).nullable().optional(), estado: z.enum(['ACTIVA', 'ARCHIVADA', 'INACTIVA']).optional() }).strict().refine((v) => Object.keys(v).length > 0, 'Envía al menos un campo').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const updated = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE aula SET nombre = COALESCE($2, nombre),
                       descripcion = CASE WHEN $3 THEN $4 ELSE descripcion END,
                       estado = COALESCE($5, estado), fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_aula = $1
        RETURNING id_aula AS id, nombre, descripcion, estado, fecha_actualizacion AS "fechaActualizacion"`,
      [req.params.id, parsed.data.nombre ?? null, parsed.data.descripcion !== undefined, parsed.data.descripcion ?? null, parsed.data.estado ?? null],
    );
    await audit(client, req, { entidad: 'aula', entidadId: req.params.id, accion: 'ACTUALIZAR', institucionId: classroom.id_institucion, despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, updated);
}));

router.get('/:id/students', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const result = await query(
    `SELECT ma.id_matricula AS id, u.id_usuario AS "estudianteId", u.nombres, u.apellidos,
            u.correo, ma.estado, ma.fecha_ingreso AS "fechaIngreso", ma.fecha_retiro AS "fechaRetiro"
       FROM matricula_aula ma JOIN usuario u ON u.id_usuario = ma.id_estudiante
      WHERE ma.id_aula = $1 ORDER BY u.apellidos, u.nombres LIMIT $2`,
    [req.params.id, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.patch('/:id/students/:enrollmentId', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const parsed = z.object({ estado: z.enum(['ACTIVA', 'RETIRADA', 'BLOQUEADA']) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Estado de matrícula inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const updated = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE matricula_aula SET estado = $3::estado_matricula,
              fecha_retiro = CASE WHEN $3::estado_matricula = 'ACTIVA' THEN NULL ELSE COALESCE(fecha_retiro, CURRENT_TIMESTAMP) END
        WHERE id_matricula = $1 AND id_aula = $2
        RETURNING id_matricula AS id, id_estudiante AS "estudianteId", estado, fecha_retiro AS "fechaRetiro"`,
      [req.params.enrollmentId, req.params.id, parsed.data.estado],
    );
    if (!result.rowCount) throw new HttpError(404, 'Matrícula no encontrada en esta aula', 'NOT_FOUND');
    await audit(client, req, { entidad: 'matricula_aula', entidadId: req.params.enrollmentId, accion: 'CAMBIAR_ESTADO', institucionId: classroom.id_institucion, despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, updated);
}));

router.get('/:id/invitations', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const result = await query(
    `SELECT id_invitacion AS id, codigo, fecha_expiracion AS "fechaExpiracion", usos_maximos AS "usosMaximos",
            usos_realizados AS "usosRealizados", activa, fecha_creacion AS "fechaCreacion"
       FROM invitacion_aula WHERE id_aula = $1 ORDER BY fecha_creacion DESC`,
    [req.params.id],
  );
  sendData(res, result.rows);
}));

router.post('/:id/invitations', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  if (classroom.estado !== 'ACTIVA') throw new HttpError(409, 'El aula no está activa', 'INVALID_STATE');
  const parsed = z.object({ codigo: z.string().trim().min(6).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(), fechaExpiracion: z.string().datetime({ offset: true }).nullable().optional(), usosMaximos: z.number().int().positive().nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invitación inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  // Código aleatorio legible (sin caracteres ambiguos) cuando el profesor no define uno.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codigo = (parsed.data.codigo ?? [...randomBytes(10)].map((byte) => alphabet[byte % alphabet.length]).join('')).toUpperCase();
  const result = await query(
    `INSERT INTO invitacion_aula
       (id_invitacion, id_aula, id_creada_por, codigo, fecha_expiracion, usos_maximos)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id_invitacion AS id, codigo, fecha_expiracion AS "fechaExpiracion", usos_maximos AS "usosMaximos", activa`,
    [randomUUID(), req.params.id, req.user.id, codigo, parsed.data.fechaExpiracion ?? null, parsed.data.usosMaximos ?? null],
  );
  sendData(res, result.rows[0], 201);
}));

router.patch('/:id/invitations/:invitationId', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const parsed = z.object({ activa: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización de invitación inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await query(
    `UPDATE invitacion_aula SET activa = $3 WHERE id_invitacion = $1 AND id_aula = $2
     RETURNING id_invitacion AS id, codigo, activa, usos_realizados AS "usosRealizados"`,
    [req.params.invitationId, req.params.id, parsed.data.activa],
  );
  if (!result.rowCount) throw new HttpError(404, 'Invitación no encontrada en esta aula', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

router.post('/:id/assignments', authorize('PROFESOR'), asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertOwner(classroom, req.user);
  if (classroom.estado !== 'ACTIVA') throw new HttpError(409, 'El aula no está activa', 'INVALID_STATE');
  const parsed = z.object({ cuestionarioId: z.string().uuid(), fechaApertura: z.string().datetime({ offset: true }), fechaCierre: z.string().datetime({ offset: true }).nullable().optional(), intentosPermitidos: z.number().int().positive().max(20).default(1) })
    .strict().refine((v) => !v.fechaCierre || new Date(v.fechaCierre) > new Date(v.fechaApertura), { message: 'fechaCierre debe ser posterior a fechaApertura', path: ['fechaCierre'] })
    .safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Asignación inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const questionnaire = await query(`SELECT 1 FROM cuestionario WHERE id_cuestionario = $1 AND estado = 'PUBLICADO'`, [parsed.data.cuestionarioId]);
  if (!questionnaire.rowCount) throw new HttpError(400, 'El cuestionario no existe o no está publicado', 'INVALID_REFERENCE');
  const result = await query(
    `INSERT INTO asignacion_aula
       (id_asignacion, id_aula, id_cuestionario, id_creada_por, fecha_apertura, fecha_cierre, intentos_permitidos)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id_asignacion AS id, id_cuestionario AS "cuestionarioId", fecha_apertura AS "fechaApertura",
               fecha_cierre AS "fechaCierre", intentos_permitidos AS "intentosPermitidos", estado`,
    [randomUUID(), req.params.id, parsed.data.cuestionarioId, req.user.id, parsed.data.fechaApertura, parsed.data.fechaCierre ?? null, parsed.data.intentosPermitidos],
  );
  sendData(res, result.rows[0], 201);
}));

router.get('/:id/assignments', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const result = await query(
    `SELECT aa.id_asignacion AS id, aa.id_cuestionario AS "cuestionarioId", c.nombre AS "cuestionarioNombre",
            aa.fecha_apertura AS "fechaApertura", aa.fecha_cierre AS "fechaCierre",
            aa.intentos_permitidos AS "intentosPermitidos", aa.estado AS "estadoRegistrado",
            ${assignmentAvailability} AS estado,
            (SELECT count(DISTINCT it.id_estudiante)::int FROM intento_asignado ia JOIN intento it ON it.id_intento = ia.id_intento
              WHERE ia.id_asignacion = aa.id_asignacion) AS "estudiantesConIntento"
       FROM asignacion_aula aa JOIN cuestionario c ON c.id_cuestionario = aa.id_cuestionario
      WHERE aa.id_aula = $1 ORDER BY aa.fecha_apertura DESC`,
    [req.params.id],
  );
  sendData(res, result.rows);
}));

router.patch('/:id/assignments/:assignmentId', authorize('PROFESOR'), asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertOwner(classroom, req.user);
  const parsed = z.object({
    fechaCierre: z.string().datetime({ offset: true }).nullable().optional(),
    intentosPermitidos: z.number().int().positive().max(20).optional(),
    estado: z.enum(['CERRADA', 'CANCELADA']).optional(),
  }).strict().refine((v) => Object.keys(v).length > 0, 'Envía al menos un campo').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización de asignación inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const updated = await transaction(async (client) => {
    const found = await client.query('SELECT estado FROM asignacion_aula WHERE id_asignacion = $1 AND id_aula = $2 FOR UPDATE', [req.params.assignmentId, req.params.id]);
    if (!found.rowCount) throw new HttpError(404, 'Asignación no encontrada en esta aula', 'NOT_FOUND');
    if (['CERRADA', 'CANCELADA'].includes(found.rows[0].estado)) throw new HttpError(409, 'La asignación ya está cerrada o cancelada', 'INVALID_STATE');
    const result = await client.query(
      `UPDATE asignacion_aula SET
         fecha_cierre = CASE WHEN $3 THEN $4::timestamptz ELSE fecha_cierre END,
         intentos_permitidos = COALESCE($5, intentos_permitidos),
         estado = COALESCE($6::estado_asignacion, estado)
       WHERE id_asignacion = $1 AND id_aula = $2
       RETURNING id_asignacion AS id, fecha_apertura AS "fechaApertura", fecha_cierre AS "fechaCierre",
                 intentos_permitidos AS "intentosPermitidos", estado`,
      [req.params.assignmentId, req.params.id, parsed.data.fechaCierre !== undefined, parsed.data.fechaCierre ?? null,
        parsed.data.intentosPermitidos ?? null, parsed.data.estado ?? null],
    );
    await audit(client, req, { entidad: 'asignacion_aula', entidadId: req.params.assignmentId, accion: 'ACTUALIZAR', institucionId: classroom.id_institucion, antes: found.rows[0], despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, updated);
}));

router.get('/:id/results', staff, asyncHandler(async (req, res) => {
  const classroom = await getClassroom(req.params.id);
  assertCanManage(classroom, req.user);
  const params = [req.params.id];
  let assignmentFilter = '';
  if (req.query.asignacionId) {
    if (!isUuid(req.query.asignacionId)) throw new HttpError(400, 'asignacionId inválido', 'VALIDATION_ERROR');
    params.push(req.query.asignacionId);
    assignmentFilter = `AND id_asignacion = $${params.length}`;
  }
  params.push(parseLimit(req.query.limit));
  const result = await query(
    `SELECT id_intento AS id, id_asignacion AS "asignacionId", id_estudiante AS "estudianteId",
            nombre_estudiante AS "estudiante", estado, total_preguntas AS "totalPreguntas",
            preguntas_respondidas AS "preguntasRespondidas", respuestas_correctas AS "respuestasCorrectas",
            respuestas_incorrectas AS "respuestasIncorrectas", sin_responder AS "sinResponder",
            porcentaje, fecha_inicio AS "fechaInicio", fecha_finalizacion AS "fechaFinalizacion"
       FROM vista_resultado_aula WHERE id_aula = $1 ${assignmentFilter}
      ORDER BY fecha_inicio DESC LIMIT $${params.length}`,
    params,
  );
  sendData(res, result.rows);
}));

export default router;
