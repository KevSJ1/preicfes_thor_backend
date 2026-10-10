import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { studentQuestionContent } from '../db/fragments.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, parseLimit, requireUuidParams, sendData } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id', 'sessionId', 'itemId');
router.use(authenticate);

async function assertQuestionnaireOwner(id, userId, role) {
  const result = await query('SELECT id_cuestionario, id_creada_por, estado FROM cuestionario WHERE id_cuestionario = $1', [id]);
  const questionnaire = result.rows[0];
  if (!questionnaire) throw new HttpError(404, 'Cuestionario no encontrado', 'NOT_FOUND');
  if (questionnaire.id_creada_por !== userId && role !== 'ADMINISTRADOR') throw new HttpError(403, 'No puedes modificar este cuestionario', 'FORBIDDEN');
  if (questionnaire.estado !== 'BORRADOR') throw new HttpError(409, 'Solo se puede modificar un cuestionario en borrador', 'IMMUTABLE_RESOURCE');
  return questionnaire;
}

router.get('/', authorize('ADMINISTRADOR', 'PROFESOR', 'GESTOR_INSTITUCIONAL', 'ESTUDIANTE'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.id_cuestionario AS id, c.nombre, c.estado, c.id_creada_por AS "creadaPor",
            c.fecha_creacion AS "fechaCreacion", c.fecha_publicacion AS "fechaPublicacion",
            m.codigo AS modalidad,
            (SELECT count(*)::int FROM sesion_cuestionario sc WHERE sc.id_cuestionario = c.id_cuestionario) AS "totalSesiones",
            (SELECT count(*)::int FROM sesion_cuestionario sc JOIN item_cuestionario ic USING (id_sesion_cuestionario)
              WHERE sc.id_cuestionario = c.id_cuestionario) AS "totalPreguntas"
       FROM cuestionario c JOIN plantilla_evaluacion p ON p.id_plantilla = c.id_plantilla
       JOIN modalidad_evaluacion m ON m.id_modalidad = p.id_modalidad
      WHERE c.estado = 'PUBLICADO' OR c.id_creada_por = $1 OR $2 = 'ADMINISTRADOR'
      ORDER BY c.fecha_creacion DESC LIMIT $3`,
    [req.user.id, req.user.rol, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.post('/', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({ plantillaId: z.string().uuid(), nombre: z.string().trim().min(1).max(180) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Cuestionario inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const template = await query(
    `SELECT 1 FROM plantilla_evaluacion WHERE id_plantilla = $1 AND activa AND (oficial OR id_creada_por = $2 OR $3 = 'ADMINISTRADOR')`,
    [parsed.data.plantillaId, req.user.id, req.user.rol],
  );
  if (!template.rowCount) throw new HttpError(400, 'La plantilla no existe, está inactiva o no es accesible', 'INVALID_REFERENCE');
  const result = await query(
    `INSERT INTO cuestionario (id_cuestionario, id_plantilla, id_creada_por, nombre)
     VALUES ($1, $2, $3, $4)
     RETURNING id_cuestionario AS id, nombre, estado, fecha_creacion AS "fechaCreacion"`,
    [randomUUID(), parsed.data.plantillaId, req.user.id, parsed.data.nombre],
  );
  sendData(res, result.rows[0], 201);
}));

router.get('/:id', authorize('ADMINISTRADOR', 'PROFESOR', 'GESTOR_INSTITUCIONAL', 'ESTUDIANTE'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.id_cuestionario AS id, c.nombre, c.estado, c.fecha_publicacion AS "fechaPublicacion",
            sc.id_sesion_cuestionario AS "sesionId", sc.numero_sesion AS "numeroSesion",
            sc.nombre AS "sesionNombre", sc.duracion_minutos AS "duracionMinutos", sc.orden AS "sesionOrden",
            ic.id_item AS "itemId", ic.orden AS "itemOrden", ic.valor,
            vp.id_version_pregunta AS "versionPreguntaId", vp.enunciado,
            tp.codigo AS "tipoPregunta", nd.codigo AS dificultad, ${studentQuestionContent}
       FROM cuestionario c
       LEFT JOIN sesion_cuestionario sc ON sc.id_cuestionario = c.id_cuestionario
       LEFT JOIN item_cuestionario ic ON ic.id_sesion_cuestionario = sc.id_sesion_cuestionario
       LEFT JOIN version_pregunta vp ON vp.id_version_pregunta = ic.id_version_pregunta
       LEFT JOIN tipo_pregunta tp ON tp.id_tipo_pregunta = vp.id_tipo_pregunta
       LEFT JOIN nivel_dificultad nd ON nd.id_dificultad = vp.id_dificultad
      WHERE c.id_cuestionario = $1 AND (c.estado = 'PUBLICADO' OR c.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')
      ORDER BY sc.orden, ic.orden`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!result.rowCount) throw new HttpError(404, 'Cuestionario no encontrado', 'NOT_FOUND');
  const header = result.rows[0];
  const sessions = new Map();
  for (const row of result.rows) {
    if (!row.sesionId) continue;
    if (!sessions.has(row.sesionId)) sessions.set(row.sesionId, {
      id: row.sesionId, numero: row.numeroSesion, nombre: row.sesionNombre,
      duracionMinutos: row.duracionMinutos, orden: row.sesionOrden, items: [],
    });
    if (row.itemId) sessions.get(row.sesionId).items.push({
      id: row.itemId, orden: row.itemOrden, valor: row.valor,
      versionPreguntaId: row.versionPreguntaId, enunciado: row.enunciado,
      tipoPregunta: row.tipoPregunta, dificultad: row.dificultad, opciones: row.opciones,
      estimulo: row.estimulo, recursos: row.recursos,
    });
  }
  sendData(res, { id: header.id, nombre: header.nombre, estado: header.estado, fechaPublicacion: header.fechaPublicacion, sesiones: [...sessions.values()] });
}));

router.post('/:id/sessions', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  await assertQuestionnaireOwner(req.params.id, req.user.id, req.user.rol);
  const parsed = z.object({ numeroSesion: z.number().int().positive(), nombre: z.string().trim().min(1).max(150), duracionMinutos: z.number().int().positive(), orden: z.number().int().positive() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Sesión inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await query(
    `INSERT INTO sesion_cuestionario (id_sesion_cuestionario, id_cuestionario, numero_sesion, nombre, duracion_minutos, orden)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id_sesion_cuestionario AS id, numero_sesion AS numero, nombre, duracion_minutos AS "duracionMinutos", orden`,
    [randomUUID(), req.params.id, parsed.data.numeroSesion, parsed.data.nombre, parsed.data.duracionMinutos, parsed.data.orden],
  );
  sendData(res, result.rows[0], 201);
}));

router.post('/:id/sessions/:sessionId/items', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  await assertQuestionnaireOwner(req.params.id, req.user.id, req.user.rol);
  const parsed = z.object({ versionPreguntaId: z.string().uuid(), orden: z.number().int().positive(), valor: z.number().positive().default(1) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Ítem inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await query(
    `INSERT INTO item_cuestionario (id_item, id_sesion_cuestionario, id_version_pregunta, orden, valor)
     SELECT $1, sc.id_sesion_cuestionario, vp.id_version_pregunta, $4, $5
       FROM sesion_cuestionario sc CROSS JOIN version_pregunta vp
      WHERE sc.id_sesion_cuestionario = $2 AND sc.id_cuestionario = $3
        AND vp.id_version_pregunta = $6 AND vp.estado = 'PUBLICADA'
        AND EXISTS (SELECT 1 FROM clave_respuesta cr WHERE cr.id_version_pregunta = vp.id_version_pregunta)
     RETURNING id_item AS id, orden, valor, id_version_pregunta AS "versionPreguntaId"`,
    [randomUUID(), req.params.sessionId, req.params.id, parsed.data.orden, parsed.data.valor, parsed.data.versionPreguntaId],
  );
  if (!result.rowCount) throw new HttpError(400, 'La sesión no pertenece al cuestionario o la pregunta no está publicada/configurada', 'INVALID_ITEM');
  sendData(res, result.rows[0], 201);
}));

router.post('/:id/publish', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  await transaction(async (client) => {
    const found = await client.query('SELECT id_cuestionario, id_creada_por, estado FROM cuestionario WHERE id_cuestionario = $1 FOR UPDATE', [req.params.id]);
    const questionnaire = found.rows[0];
    if (!questionnaire) throw new HttpError(404, 'Cuestionario no encontrado', 'NOT_FOUND');
    if (questionnaire.id_creada_por !== req.user.id && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'No puedes publicar este cuestionario', 'FORBIDDEN');
    if (questionnaire.estado !== 'BORRADOR') throw new HttpError(409, 'El cuestionario no está en borrador', 'IMMUTABLE_RESOURCE');
    const ready = await client.query(
      `SELECT count(DISTINCT sc.id_sesion_cuestionario)::int AS sesiones,
              count(ic.id_item)::int AS items,
              count(ic.id_item) FILTER (WHERE vp.estado = 'PUBLICADA' AND cr.id_version_pregunta IS NOT NULL)::int AS validos
         FROM sesion_cuestionario sc
         LEFT JOIN item_cuestionario ic ON ic.id_sesion_cuestionario = sc.id_sesion_cuestionario
         LEFT JOIN version_pregunta vp ON vp.id_version_pregunta = ic.id_version_pregunta
         LEFT JOIN clave_respuesta cr ON cr.id_version_pregunta = vp.id_version_pregunta
        WHERE sc.id_cuestionario = $1`,
      [req.params.id],
    );
    const counts = ready.rows[0];
    if (counts.sesiones < 1 || counts.items < 1 || counts.items !== counts.validos) throw new HttpError(400, 'Agrega sesiones e ítems con preguntas publicadas y clave de respuesta', 'QUESTIONNAIRE_INCOMPLETE');
    await client.query(`UPDATE cuestionario SET estado = 'PUBLICADO', fecha_publicacion = CURRENT_TIMESTAMP WHERE id_cuestionario = $1`, [req.params.id]);
    await audit(client, req, { entidad: 'cuestionario', entidadId: req.params.id, accion: 'PUBLICAR', despues: counts });
  });
  sendData(res, { id: req.params.id, estado: 'PUBLICADO' });
}));

router.patch('/:id', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({ nombre: z.string().trim().min(1).max(180).optional(), estado: z.literal('ARCHIVADO').optional() })
    .strict().refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización de cuestionario inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const updated = await transaction(async (client) => {
    const found = await client.query('SELECT id_creada_por, estado FROM cuestionario WHERE id_cuestionario = $1 FOR UPDATE', [req.params.id]);
    const questionnaire = found.rows[0];
    if (!questionnaire) throw new HttpError(404, 'Cuestionario no encontrado', 'NOT_FOUND');
    if (questionnaire.id_creada_por !== req.user.id && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'No puedes modificar este cuestionario', 'FORBIDDEN');
    if (parsed.data.nombre && questionnaire.estado !== 'BORRADOR') throw new HttpError(409, 'Solo se puede renombrar un cuestionario en borrador', 'IMMUTABLE_RESOURCE');
    if (parsed.data.estado && questionnaire.estado === 'ARCHIVADO') throw new HttpError(409, 'El cuestionario ya está archivado', 'INVALID_STATE');
    const result = await client.query(
      `UPDATE cuestionario SET nombre = COALESCE($2, nombre), estado = COALESCE($3::estado_cuestionario, estado)
        WHERE id_cuestionario = $1
        RETURNING id_cuestionario AS id, nombre, estado, fecha_publicacion AS "fechaPublicacion"`,
      [req.params.id, parsed.data.nombre ?? null, parsed.data.estado ?? null],
    );
    if (parsed.data.estado) {
      // Archivar cierra las asignaciones pendientes o abiertas que lo usan.
      await client.query(`UPDATE asignacion_aula SET estado = 'CERRADA' WHERE id_cuestionario = $1 AND estado IN ('PROGRAMADA', 'ABIERTA')`, [req.params.id]);
    }
    await audit(client, req, { entidad: 'cuestionario', entidadId: req.params.id, accion: 'ACTUALIZAR', antes: questionnaire, despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, updated);
}));

router.delete('/:id/sessions/:sessionId', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  await assertQuestionnaireOwner(req.params.id, req.user.id, req.user.rol);
  const deleted = await transaction(async (client) => {
    const session = await client.query('SELECT 1 FROM sesion_cuestionario WHERE id_sesion_cuestionario = $1 AND id_cuestionario = $2 FOR UPDATE', [req.params.sessionId, req.params.id]);
    if (!session.rowCount) return false;
    await client.query('DELETE FROM item_cuestionario WHERE id_sesion_cuestionario = $1', [req.params.sessionId]);
    await client.query('DELETE FROM sesion_cuestionario WHERE id_sesion_cuestionario = $1', [req.params.sessionId]);
    return true;
  });
  if (!deleted) throw new HttpError(404, 'Sesión no encontrada en este cuestionario', 'NOT_FOUND');
  res.status(204).end();
}));

router.delete('/:id/sessions/:sessionId/items/:itemId', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  await assertQuestionnaireOwner(req.params.id, req.user.id, req.user.rol);
  const deleted = await query(
    `DELETE FROM item_cuestionario ic USING sesion_cuestionario sc
      WHERE ic.id_item = $1 AND ic.id_sesion_cuestionario = $2
        AND sc.id_sesion_cuestionario = ic.id_sesion_cuestionario AND sc.id_cuestionario = $3`,
    [req.params.itemId, req.params.sessionId, req.params.id],
  );
  if (!deleted.rowCount) throw new HttpError(404, 'Ítem no encontrado en esta sesión', 'NOT_FOUND');
  res.status(204).end();
}));

export default router;