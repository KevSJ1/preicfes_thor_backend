import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { studentQuestionContent } from '../db/fragments.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler, HttpError, parseLimit, requireUuidParams, sendData } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id', 'itemId', 'assignmentId');
router.use(authenticate);

// Margen tras el tiempo límite para absorber latencia de red al guardar la última respuesta.
const GRACE = `INTERVAL '1 minute'`;

/*
 * Estado temporal de un intento calculado con el reloj de PostgreSQL.
 * fecha_limite = inicio + suma de la duración de las sesiones del cuestionario.
 * expirado = la asignación cerró/fue cancelada o se superó el tiempo límite (más el margen).
 * No usa FOR UPDATE porque vista_origen_intento contiene UNION; el bloqueo se toma aparte sobre `intento`.
 */
const attemptState = `
  SELECT i.id_intento, i.id_estudiante, i.estado, i.fecha_inicio, i.fecha_finalizacion,
         oi.id_cuestionario, oi.id_asignacion, oi.id_aula,
         aa.fecha_apertura, aa.fecha_cierre, aa.estado AS estado_asignacion,
         i.fecha_inicio + make_interval(mins => d.minutos) AS fecha_limite,
         (aa.estado IN ('CERRADA', 'CANCELADA')
           OR (aa.fecha_cierre IS NOT NULL AND aa.fecha_cierre <= CURRENT_TIMESTAMP)
           OR (d.minutos > 0 AND CURRENT_TIMESTAMP > i.fecha_inicio + make_interval(mins => d.minutos) + ${GRACE})) AS expirado
    FROM intento i
    JOIN vista_origen_intento oi ON oi.id_intento = i.id_intento
    LEFT JOIN asignacion_aula aa ON aa.id_asignacion = oi.id_asignacion
    CROSS JOIN LATERAL (SELECT COALESCE(sum(sc.duracion_minutos), 0)::int AS minutos
                          FROM sesion_cuestionario sc WHERE sc.id_cuestionario = oi.id_cuestionario) d
   WHERE i.id_intento = $1`;

async function loadAttempt(client, attemptId, studentId) {
  const result = await client.query(`${attemptState} AND i.id_estudiante = $2`, [attemptId, studentId]);
  if (!result.rowCount) throw new HttpError(404, 'Intento no encontrado', 'NOT_FOUND');
  return result.rows[0];
}

async function expire(client, attemptId) {
  await client.query(
    `UPDATE intento SET estado = 'VENCIDO', fecha_finalizacion = CURRENT_TIMESTAMP, ultima_actividad = CURRENT_TIMESTAMP
      WHERE id_intento = $1 AND estado = 'EN_PROGRESO'`,
    [attemptId],
  );
}

const resultColumns = `
  id_intento AS id, id_cuestionario AS "cuestionarioId", id_asignacion AS "asignacionId", id_aula AS "aulaId",
  estado, total_preguntas AS "totalPreguntas", preguntas_respondidas AS "preguntasRespondidas",
  respuestas_correctas AS "respuestasCorrectas", respuestas_incorrectas AS "respuestasIncorrectas",
  sin_responder AS "sinResponder", porcentaje,
  fecha_inicio AS "fechaInicio", fecha_finalizacion AS "fechaFinalizacion"`;

router.get('/', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT vr.*, c.nombre AS cuestionario
       FROM (SELECT ${resultColumns} FROM vista_resultado_intento WHERE id_estudiante = $1) vr
       JOIN cuestionario c ON c.id_cuestionario = vr."cuestionarioId"
      ORDER BY vr."fechaInicio" DESC LIMIT $2`,
    [req.user.id, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

async function findOpenAttempt(client, sql, params) {
  const open = await client.query(sql, params);
  if (open.rowCount) {
    throw new HttpError(409, 'Ya tienes un intento en progreso para este cuestionario', 'ATTEMPT_IN_PROGRESS', { intentoId: open.rows[0].id_intento });
  }
}

router.post('/free', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const parsed = z.object({ cuestionarioId: z.string().uuid() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'cuestionarioId requerido', 'VALIDATION_ERROR');
  const result = await transaction(async (client) => {
    const questionnaire = await client.query(
      `SELECT id_cuestionario FROM cuestionario WHERE id_cuestionario = $1 AND estado = 'PUBLICADO' FOR SHARE`,
      [parsed.data.cuestionarioId],
    );
    if (!questionnaire.rowCount) throw new HttpError(404, 'Cuestionario publicado no encontrado', 'NOT_FOUND');
    // Serializa los inicios concurrentes del mismo estudiante.
    await client.query('SELECT 1 FROM usuario WHERE id_usuario = $1 FOR UPDATE', [req.user.id]);
    await findOpenAttempt(client,
      `SELECT i.id_intento FROM intento i JOIN intento_libre il ON il.id_intento = i.id_intento
        WHERE i.id_estudiante = $1 AND il.id_cuestionario = $2 AND i.estado = 'EN_PROGRESO'`,
      [req.user.id, parsed.data.cuestionarioId]);
    const id = randomUUID();
    await client.query('INSERT INTO intento (id_intento, id_estudiante) VALUES ($1, $2)', [id, req.user.id]);
    await client.query('INSERT INTO intento_libre (id_intento, id_cuestionario) VALUES ($1, $2)', [id, parsed.data.cuestionarioId]);
    return id;
  });
  sendData(res, { id: result, estado: 'EN_PROGRESO', cuestionarioId: parsed.data.cuestionarioId }, 201);
}));

router.post('/assignments/:assignmentId', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const result = await transaction(async (client) => {
    const assignmentResult = await client.query(
      `SELECT aa.id_asignacion, aa.id_aula, aa.id_cuestionario, aa.intentos_permitidos, aa.estado,
              a.estado AS estado_aula, c.estado AS estado_cuestionario,
              aa.fecha_apertura > CURRENT_TIMESTAMP AS no_abierta,
              (aa.fecha_cierre IS NOT NULL AND aa.fecha_cierre <= CURRENT_TIMESTAMP) AS cerrada
         FROM asignacion_aula aa JOIN aula a ON a.id_aula = aa.id_aula
         JOIN cuestionario c ON c.id_cuestionario = aa.id_cuestionario
        WHERE aa.id_asignacion = $1 FOR SHARE OF aa`,
      [req.params.assignmentId],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment || assignment.estado_aula !== 'ACTIVA' || assignment.estado_cuestionario !== 'PUBLICADO'
        || assignment.estado === 'CANCELADA' || assignment.estado === 'CERRADA') {
      throw new HttpError(404, 'Asignación disponible no encontrada', 'NOT_FOUND');
    }
    if (assignment.no_abierta || assignment.cerrada) {
      throw new HttpError(403, 'La asignación está fuera de su ventana de disponibilidad', 'ASSIGNMENT_CLOSED');
    }
    const enrolled = await client.query(
      `SELECT id_matricula FROM matricula_aula WHERE id_aula = $1 AND id_estudiante = $2 AND estado = 'ACTIVA'`,
      [assignment.id_aula, req.user.id],
    );
    if (!enrolled.rowCount) throw new HttpError(403, 'No tienes matrícula activa en el aula', 'FORBIDDEN');
    await client.query('SELECT 1 FROM usuario WHERE id_usuario = $1 FOR UPDATE', [req.user.id]);
    await findOpenAttempt(client,
      `SELECT i.id_intento FROM intento i JOIN intento_asignado ia ON ia.id_intento = i.id_intento
        WHERE i.id_estudiante = $1 AND ia.id_asignacion = $2 AND i.estado = 'EN_PROGRESO'`,
      [req.user.id, assignment.id_asignacion]);
    const attempts = await client.query(
      `SELECT count(*)::int AS total FROM intento_asignado ia JOIN intento i ON i.id_intento = ia.id_intento
        WHERE ia.id_asignacion = $1 AND i.id_estudiante = $2`,
      [assignment.id_asignacion, req.user.id],
    );
    if (attempts.rows[0].total >= assignment.intentos_permitidos) throw new HttpError(409, 'Ya utilizaste todos los intentos permitidos', 'ATTEMPTS_EXHAUSTED');
    const id = randomUUID();
    await client.query('INSERT INTO intento (id_intento, id_estudiante) VALUES ($1, $2)', [id, req.user.id]);
    await client.query('INSERT INTO intento_asignado (id_intento, id_asignacion) VALUES ($1, $2)', [id, assignment.id_asignacion]);
    if (assignment.estado === 'PROGRAMADA') {
      await client.query(`UPDATE asignacion_aula SET estado = 'ABIERTA' WHERE id_asignacion = $1 AND estado = 'PROGRAMADA'`, [assignment.id_asignacion]);
    }
    return { id, cuestionarioId: assignment.id_cuestionario, asignacionId: assignment.id_asignacion };
  });
  sendData(res, { ...result, estado: 'EN_PROGRESO' }, 201);
}));

function groupItems(rows, mapItem) {
  const sessions = new Map();
  for (const row of rows) {
    if (!sessions.has(row.sesionId)) {
      sessions.set(row.sesionId, { id: row.sesionId, numero: row.numeroSesion, nombre: row.sesionNombre, duracionMinutos: row.duracionMinutos, items: [] });
    }
    sessions.get(row.sesionId).items.push(mapItem(row));
  }
  return [...sessions.values()];
}

const itemColumns = `
  ic.id_item AS id, ic.orden, ic.valor, sc.id_sesion_cuestionario AS "sesionId",
  sc.nombre AS "sesionNombre", sc.numero_sesion AS "numeroSesion", sc.duracion_minutos AS "duracionMinutos",
  vp.id_version_pregunta AS "preguntaId", vp.enunciado, tp.codigo AS "tipoPregunta", ${studentQuestionContent},
  ri.id_opcion AS "opcionSeleccionada", ri.respuesta_texto AS "respuestaTexto",
  ri.tiempo_segundos AS "tiempoSegundos", ri.fecha_actualizacion AS "fechaRespuesta"`;
const itemJoins = `
  FROM sesion_cuestionario sc JOIN item_cuestionario ic ON ic.id_sesion_cuestionario = sc.id_sesion_cuestionario
  JOIN version_pregunta vp ON vp.id_version_pregunta = ic.id_version_pregunta
  JOIN tipo_pregunta tp ON tp.id_tipo_pregunta = vp.id_tipo_pregunta
  LEFT JOIN respuesta_intento ri ON ri.id_intento = $2 AND ri.id_item = ic.id_item`;

const mapAnswer = (row) => (row.opcionSeleccionada || row.respuestaTexto
  ? { opcionId: row.opcionSeleccionada, texto: row.respuestaTexto, tiempoSegundos: row.tiempoSegundos, fechaActualizacion: row.fechaRespuesta }
  : null);

router.get('/:id', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  let attempt = await loadAttempt({ query }, req.params.id, req.user.id);
  if (attempt.estado === 'EN_PROGRESO' && attempt.expirado) {
    await expire({ query }, attempt.id_intento);
    attempt = await loadAttempt({ query }, req.params.id, req.user.id);
  }
  const result = await query(
    `SELECT ${itemColumns} ${itemJoins} WHERE sc.id_cuestionario = $1 ORDER BY sc.orden, ic.orden`,
    [attempt.id_cuestionario, attempt.id_intento],
  );
  sendData(res, {
    id: attempt.id_intento, estado: attempt.estado, cuestionarioId: attempt.id_cuestionario,
    asignacionId: attempt.id_asignacion, fechaInicio: attempt.fecha_inicio,
    fechaLimite: attempt.fecha_limite, fechaCierreAsignacion: attempt.fecha_cierre,
    fechaFinalizacion: attempt.fecha_finalizacion,
    sesiones: groupItems(result.rows, (row) => ({
      id: row.id, orden: row.orden, valor: row.valor, preguntaId: row.preguntaId,
      enunciado: row.enunciado, tipoPregunta: row.tipoPregunta, estimulo: row.estimulo,
      recursos: row.recursos, opciones: row.opciones, respuesta: mapAnswer(row),
    })),
  });
}));

router.put('/:id/answers/:itemId', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const parsed = z.object({ opcionId: z.string().uuid().nullable().optional(), texto: z.string().max(20000).nullable().optional(), tiempoSegundos: z.number().int().nonnegative().nullable().optional() })
    .strict().refine((data) => data.opcionId || data.texto?.trim(), 'Incluye opción o texto').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Respuesta inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const outcome = await transaction(async (client) => {
    await client.query('SELECT 1 FROM intento WHERE id_intento = $1 FOR UPDATE', [req.params.id]);
    const attempt = await loadAttempt(client, req.params.id, req.user.id);
    if (attempt.estado !== 'EN_PROGRESO') throw new HttpError(409, 'El intento no está en progreso', 'ATTEMPT_FINISHED');
    // El vencimiento debe confirmarse, por eso se devuelve en lugar de lanzar dentro de la transacción.
    if (attempt.expirado) { await expire(client, attempt.id_intento); return { expired: true }; }

    const item = await client.query(
      `SELECT ic.id_item,
              ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM opcion_respuesta op
                 WHERE op.id_opcion = $3 AND op.id_conjunto_opciones = vp.id_conjunto_opciones)) AS opcion_valida
         FROM item_cuestionario ic
         JOIN sesion_cuestionario sc ON sc.id_sesion_cuestionario = ic.id_sesion_cuestionario
         JOIN version_pregunta vp ON vp.id_version_pregunta = ic.id_version_pregunta
        WHERE ic.id_item = $1 AND sc.id_cuestionario = $2`,
      [req.params.itemId, attempt.id_cuestionario, parsed.data.opcionId ?? null],
    );
    if (!item.rowCount) throw new HttpError(404, 'El ítem no pertenece al cuestionario del intento', 'NOT_FOUND');
    if (!item.rows[0].opcion_valida) throw new HttpError(400, 'La opción no pertenece a esta pregunta', 'INVALID_OPTION');

    const saved = await client.query(
      `INSERT INTO respuesta_intento
         (id_respuesta, id_intento, id_item, id_opcion, respuesta_texto, tiempo_segundos, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (id_intento, id_item) DO UPDATE SET
         id_opcion = EXCLUDED.id_opcion, respuesta_texto = EXCLUDED.respuesta_texto,
         tiempo_segundos = EXCLUDED.tiempo_segundos, fecha_actualizacion = CURRENT_TIMESTAMP
       RETURNING id_respuesta AS id, id_item AS "itemId", id_opcion AS "opcionId", respuesta_texto AS texto,
                 tiempo_segundos AS "tiempoSegundos", fecha_actualizacion AS "fechaActualizacion"`,
      [randomUUID(), req.params.id, req.params.itemId, parsed.data.opcionId ?? null, parsed.data.texto?.trim() || null, parsed.data.tiempoSegundos ?? null],
    );
    await client.query('UPDATE intento SET ultima_actividad = CURRENT_TIMESTAMP WHERE id_intento = $1', [req.params.id]);
    return { answer: saved.rows[0] };
  });
  if (outcome.expired) throw new HttpError(403, 'El tiempo del intento terminó o la asignación ya cerró', 'ATTEMPT_EXPIRED');
  sendData(res, outcome.answer);
}));

// Entregar el intento. Si ya expiró se registra como VENCIDO; las respuestas guardadas se califican igual.
router.post('/:id/finish', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const finished = await transaction(async (client) => {
    await client.query('SELECT 1 FROM intento WHERE id_intento = $1 FOR UPDATE', [req.params.id]);
    const attempt = await loadAttempt(client, req.params.id, req.user.id);
    if (attempt.estado !== 'EN_PROGRESO') throw new HttpError(409, 'El intento ya fue finalizado', 'ATTEMPT_FINISHED');
    const updated = await client.query(
      `UPDATE intento SET estado = $2, fecha_finalizacion = CURRENT_TIMESTAMP, ultima_actividad = CURRENT_TIMESTAMP
        WHERE id_intento = $1
        RETURNING id_intento AS id, estado, fecha_finalizacion AS "fechaFinalizacion"`,
      [req.params.id, attempt.expirado ? 'VENCIDO' : 'FINALIZADO'],
    );
    return updated.rows[0];
  });
  const score = await query(
    `SELECT respuestas_correctas AS "respuestasCorrectas", respuestas_incorrectas AS "respuestasIncorrectas",
            preguntas_respondidas AS "preguntasRespondidas", sin_responder AS "sinResponder",
            total_preguntas AS "totalPreguntas", porcentaje
       FROM vista_resultado_intento WHERE id_intento = $1`,
    [req.params.id],
  );
  sendData(res, { ...finished, resultado: score.rows[0] ?? null });
}));

router.get('/:id/result', authorize('ESTUDIANTE'), asyncHandler(async (req, res) => {
  const result = await query(`SELECT ${resultColumns} FROM vista_resultado_intento WHERE id_intento = $1 AND id_estudiante = $2`, [req.params.id, req.user.id]);
  if (!result.rowCount) throw new HttpError(404, 'Resultado no encontrado', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

/*
 * Revisión detallada con clave de respuesta, solo para docentes y administración:
 * administrador (cualquier intento), profesor del aula de la asignación, o gestor de la institución del aula.
 */
router.get('/:id/review', authorize('ADMINISTRADOR', 'PROFESOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  const found = await query(
    `SELECT vr.*, concat(u.nombres, ' ', u.apellidos) AS nombre_estudiante, a.id_profesor, a.id_institucion
       FROM vista_resultado_intento vr JOIN usuario u ON u.id_usuario = vr.id_estudiante
       LEFT JOIN aula a ON a.id_aula = vr.id_aula
      WHERE vr.id_intento = $1`,
    [req.params.id],
  );
  const attempt = found.rows[0];
  const allowed = attempt && (req.user.rol === 'ADMINISTRADOR'
    || (attempt.id_profesor && attempt.id_profesor === req.user.id)
    || (attempt.id_institucion && req.user.rolInstitucional === 'GESTOR_INSTITUCIONAL' && req.user.idInstitucion === attempt.id_institucion));
  if (!allowed) throw new HttpError(404, 'Intento no encontrado', 'NOT_FOUND');
  const items = await query(
    `SELECT ${itemColumns}, vp.explicacion, cr.id_opcion AS "opcionCorrecta", cr.justificacion
       ${itemJoins}
       LEFT JOIN clave_respuesta cr ON cr.id_version_pregunta = vp.id_version_pregunta
      WHERE sc.id_cuestionario = $1 ORDER BY sc.orden, ic.orden`,
    [attempt.id_cuestionario, attempt.id_intento],
  );
  sendData(res, {
    id: attempt.id_intento, estudianteId: attempt.id_estudiante, estudiante: attempt.nombre_estudiante,
    cuestionarioId: attempt.id_cuestionario, asignacionId: attempt.id_asignacion, aulaId: attempt.id_aula,
    estado: attempt.estado, fechaInicio: attempt.fecha_inicio, fechaFinalizacion: attempt.fecha_finalizacion,
    resultado: {
      totalPreguntas: attempt.total_preguntas, preguntasRespondidas: attempt.preguntas_respondidas,
      respuestasCorrectas: attempt.respuestas_correctas, respuestasIncorrectas: attempt.respuestas_incorrectas,
      sinResponder: attempt.sin_responder, porcentaje: attempt.porcentaje,
    },
    sesiones: groupItems(items.rows, (row) => ({
      id: row.id, orden: row.orden, valor: row.valor, preguntaId: row.preguntaId,
      enunciado: row.enunciado, tipoPregunta: row.tipoPregunta, estimulo: row.estimulo, recursos: row.recursos,
      opciones: row.opciones, respuesta: mapAnswer(row),
      clave: { opcionId: row.opcionCorrecta, justificacion: row.justificacion, explicacion: row.explicacion },
      correcta: row.opcionSeleccionada ? row.opcionSeleccionada === row.opcionCorrecta : null,
    })),
  });
}));

export default router;
