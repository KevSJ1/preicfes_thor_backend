import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, isUuid, parseLimit, sendData, requireUuidParams } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id');
router.use(authenticate);

const questionBody = z.object({
  tipoPreguntaId: z.string().uuid(),
  dificultadId: z.string().uuid(),
  tareaId: z.string().uuid().nullable().optional(),
  estimuloVersionId: z.string().uuid().nullable().optional(),
  fuenteId: z.string().uuid().nullable().optional(),
  enunciado: z.string().trim().min(1),
  explicacion: z.string().nullable().optional(),
  opciones: z.array(z.object({ letra: z.string().trim().min(1).max(5), contenido: z.string().min(1), orden: z.number().int().positive() }).strict()).min(2).max(10),
  respuestaCorrecta: z.string().trim().min(1).max(5),
  justificacion: z.string().nullable().optional(),
  temas: z.array(z.string().uuid()).max(30).default([]),
  recursos: z.array(z.string().uuid()).max(20).default([]),
}).strict().superRefine((data, ctx) => {
  const letters = data.opciones.map((option) => option.letra);
  if (new Set(letters).size !== letters.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['opciones'], message: 'Las letras de las opciones deben ser únicas' });
  const orders = data.opciones.map((option) => option.orden);
  if (new Set(orders).size !== orders.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['opciones'], message: 'El orden de las opciones debe ser único' });
  if (!letters.includes(data.respuestaCorrecta)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['respuestaCorrecta'], message: 'Debe coincidir con la letra de una opción' });
});

async function insertVersion(client, user, questionId, version, data, batchId = null) {
  if (data.estimuloVersionId) {
    const stimulus = await client.query(
      `SELECT 1 FROM version_estimulo ve JOIN estimulo e ON e.id_estimulo = ve.id_estimulo
        WHERE ve.id_version_estimulo = $1 AND ve.estado <> 'ARCHIVADA'
          AND (ve.estado = 'PUBLICADA' OR e.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')`,
      [data.estimuloVersionId, user.id, user.rol],
    );
    if (!stimulus.rowCount) throw new HttpError(400, 'El estímulo no existe, está archivado o no es accesible', 'INVALID_REFERENCE');
  }
  const resources = [...new Set(data.recursos)];
  if (resources.length) {
    const visible = await client.query(
      'SELECT count(*)::int AS total FROM recurso_multimedia WHERE id_recurso = ANY($1::uuid[]) AND (id_subido_por = $2 OR $3 = \'ADMINISTRADOR\')',
      [resources, user.id, user.rol],
    );
    if (visible.rows[0].total !== resources.length) throw new HttpError(400, 'Algún recurso no existe o no es tuyo', 'INVALID_REFERENCE');
  }

  const optionsId = randomUUID();
  await client.query(
    `INSERT INTO conjunto_opciones (id_conjunto_opciones, id_creada_por, nombre, reutilizable)
     VALUES ($1, $2, $3, false)`,
    [optionsId, user.id, `Opciones pregunta ${questionId} v${version}`],
  );
  const optionIds = new Map();
  for (const option of data.opciones) {
    const optionId = randomUUID();
    optionIds.set(option.letra, optionId);
    await client.query(
      `INSERT INTO opcion_respuesta (id_opcion, id_conjunto_opciones, letra, contenido, orden)
       VALUES ($1, $2, $3, $4, $5)`,
      [optionId, optionsId, option.letra, option.contenido, option.orden],
    );
  }

  const versionId = randomUUID();
  await client.query(
    `INSERT INTO version_pregunta
       (id_version_pregunta, id_pregunta, id_tipo_pregunta, id_dificultad, id_tarea,
        id_version_estimulo, id_conjunto_opciones, id_fuente, id_lote_importacion, id_creada_por,
        numero_version, enunciado, explicacion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [versionId, questionId, data.tipoPreguntaId, data.dificultadId, data.tareaId ?? null,
      data.estimuloVersionId ?? null, optionsId, data.fuenteId ?? null, batchId, user.id,
      version, data.enunciado, data.explicacion ?? null],
  );
  await client.query(
    `INSERT INTO clave_respuesta (id_version_pregunta, id_opcion, justificacion) VALUES ($1, $2, $3)`,
    [versionId, optionIds.get(data.respuestaCorrecta), data.justificacion ?? null],
  );
  for (const temaId of new Set(data.temas)) {
    await client.query('INSERT INTO version_pregunta_tema (id_version_pregunta, id_tema) VALUES ($1, $2)', [versionId, temaId]);
  }
  for (const [index, resourceId] of resources.entries()) {
    await client.query('INSERT INTO version_pregunta_recurso (id_version_pregunta, id_recurso, orden) VALUES ($1, $2, $3)', [versionId, resourceId, index + 1]);
  }
  return versionId;
}

async function createQuestion(client, user, data, batchId = null) {
  const questionId = randomUUID();
  await client.query('INSERT INTO pregunta (id_pregunta, id_creada_por, codigo) VALUES ($1, $2, $3)', [questionId, user.id, `Q-${questionId}`]);
  const versionId = await insertVersion(client, user, questionId, 1, data, batchId);
  return { preguntaId: questionId, versionId };
}

function mapQuestion(row, includeAnswer = false) {
  const value = {
    id: row.id_version_pregunta,
    preguntaId: row.id_pregunta,
    version: row.numero_version,
    codigo: row.codigo,
    enunciado: row.enunciado,
    explicacion: row.explicacion,
    estado: row.estado,
    creadaPor: row.id_creada_por,
    fuenteId: row.id_fuente,
    fechaCreacion: row.fecha_creacion,
    fechaPublicacion: row.fecha_publicacion,
    tipoPregunta: { codigo: row.tipo_codigo, nombre: row.tipo_nombre },
    dificultad: { codigo: row.dificultad_codigo, nombre: row.dificultad_nombre },
    tarea: row.tarea_codigo ? { id: row.id_tarea, codigo: row.tarea_codigo, descripcion: row.tarea_descripcion } : null,
    estimulo: row.estimulo ? { id: row.id_version_estimulo, titulo: row.estimulo_titulo, contenido: row.estimulo } : null,
    opciones: row.opciones ?? [],
    temas: row.temas ?? [],
    recursos: row.recursos ?? [],
  };
  if (includeAnswer && row.respuesta_correcta) value.clave = { letra: row.respuesta_correcta, justificacion: row.justificacion };
  return value;
}

const selectQuestion = `
  SELECT vp.id_version_pregunta, vp.id_pregunta, vp.id_creada_por, p.codigo, vp.numero_version, vp.enunciado,
         vp.explicacion, vp.estado, vp.id_fuente, vp.fecha_creacion, vp.fecha_publicacion,
         tp.codigo AS tipo_codigo, tp.nombre AS tipo_nombre,
         nd.codigo AS dificultad_codigo, nd.nombre AS dificultad_nombre,
         t.id_tarea, t.codigo AS tarea_codigo, t.descripcion AS tarea_descripcion,
         ve.id_version_estimulo, ve.titulo AS estimulo_titulo, ve.contenido AS estimulo,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', op.id_opcion, 'letra', op.letra, 'contenido', op.contenido)
                      ORDER BY op.orden)
                     FROM opcion_respuesta op WHERE op.id_conjunto_opciones = vp.id_conjunto_opciones), '[]'::jsonb) AS opciones,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', tm.id_tema, 'nombre', tm.nombre) ORDER BY tm.nombre)
                     FROM version_pregunta_tema vpt JOIN tema tm ON tm.id_tema = vpt.id_tema
                    WHERE vpt.id_version_pregunta = vp.id_version_pregunta), '[]'::jsonb) AS temas,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rm.id_recurso, 'tipo', rm.tipo, 'url', rm.url,
                      'textoAlternativo', rm.texto_alternativo, 'mimeType', rm.mime_type) ORDER BY vpr.orden)
                     FROM version_pregunta_recurso vpr JOIN recurso_multimedia rm ON rm.id_recurso = vpr.id_recurso
                    WHERE vpr.id_version_pregunta = vp.id_version_pregunta), '[]'::jsonb) AS recursos,
         op.letra AS respuesta_correcta, cr.justificacion
    FROM version_pregunta vp
    JOIN pregunta p ON p.id_pregunta = vp.id_pregunta
    JOIN tipo_pregunta tp ON tp.id_tipo_pregunta = vp.id_tipo_pregunta
    JOIN nivel_dificultad nd ON nd.id_dificultad = vp.id_dificultad
    LEFT JOIN tarea t ON t.id_tarea = vp.id_tarea
    LEFT JOIN version_estimulo ve ON ve.id_version_estimulo = vp.id_version_estimulo
    LEFT JOIN clave_respuesta cr ON cr.id_version_pregunta = vp.id_version_pregunta
    LEFT JOIN opcion_respuesta op ON op.id_opcion = cr.id_opcion`;

router.get('/', authorize('ADMINISTRADOR', 'PROFESOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  const uuidFilter = (value, condition) => {
    if (!value) return;
    if (!isUuid(value)) throw new HttpError(400, 'Filtro inválido', 'VALIDATION_ERROR');
    params.push(value); where.push(condition(`$${params.length}`));
  };
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 100)}%`); where.push(`(vp.enunciado ILIKE $${params.length} OR p.codigo ILIKE $${params.length})`); }
  if (['BORRADOR', 'PUBLICADA', 'ARCHIVADA'].includes(req.query.estado)) { params.push(req.query.estado); where.push(`vp.estado = $${params.length}`); }
  uuidFilter(req.query.preguntaId, (param) => `vp.id_pregunta = ${param}`);
  uuidFilter(req.query.dificultadId, (param) => `vp.id_dificultad = ${param}`);
  uuidFilter(req.query.tareaId, (param) => `vp.id_tarea = ${param}`);
  uuidFilter(req.query.temaId, (param) => `EXISTS (SELECT 1 FROM version_pregunta_tema f WHERE f.id_version_pregunta = vp.id_version_pregunta AND f.id_tema = ${param})`);
  if (req.user.rol !== 'ADMINISTRADOR') {
    params.push(req.user.id);
    where.push(`(vp.estado = 'PUBLICADA' OR vp.id_creada_por = $${params.length})`);
  }
  params.push(parseLimit(req.query.limit));
  const result = await query(`${selectQuestion} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY vp.fecha_creacion DESC LIMIT $${params.length}`, params);
  sendData(res, result.rows.map((row) => mapQuestion(row, req.user.rol === 'ADMINISTRADOR' || row.id_creada_por === req.user.id)));
}));

router.post('/', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = questionBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Pregunta inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const created = await transaction((client) => createQuestion(client, req.user, parsed.data));
  sendData(res, { ...created, version: 1, estado: 'BORRADOR' }, 201);
}));

// Importación masiva: cada fila se procesa en un SAVEPOINT; las filas inválidas quedan en error_importacion.
router.post('/import', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({
    nombreArchivo: z.string().trim().min(1).max(255),
    archivoUrl: z.string().url().max(1000).nullable().optional(),
    preguntas: z.array(z.unknown()).min(1).max(200),
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Importación inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const rows = parsed.data.preguntas;
  const batchId = randomUUID();

  const summary = await transaction(async (client) => {
    await client.query(
      `INSERT INTO lote_importacion (id_lote_importacion, id_usuario, nombre_archivo, archivo_url, estado, total_filas, fecha_inicio)
       VALUES ($1, $2, $3, $4, 'PROCESANDO', $5, CURRENT_TIMESTAMP)`,
      [batchId, req.user.id, parsed.data.nombreArchivo, parsed.data.archivoUrl ?? null, rows.length],
    );
    const recordError = (rowNumber, error) => client.query(
      `INSERT INTO error_importacion (id_error, id_lote_importacion, numero_fila, columna, codigo_error, mensaje, valor_recibido, fila_original)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), batchId, rowNumber, error.columna ?? null, error.codigo, error.mensaje,
        error.valor === undefined ? null : JSON.stringify(error.valor).slice(0, 2000), JSON.stringify(rows[rowNumber - 1] ?? null)],
    );
    let ok = 0;
    let failed = 0;
    const created = [];
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      const result = questionBody.safeParse(row);
      if (!result.success) {
        failed += 1;
        for (const issue of result.error.issues.slice(0, 20)) {
          const column = issue.path.join('.') || null;
          const value = issue.path.reduce((current, key) => current?.[key], row);
          await recordError(rowNumber, { columna: column, codigo: 'VALIDATION_ERROR', mensaje: issue.message, valor: value });
        }
        continue;
      }
      await client.query('SAVEPOINT fila_importacion');
      try {
        created.push({ fila: rowNumber, ...await createQuestion(client, req.user, result.data, batchId) });
        await client.query('RELEASE SAVEPOINT fila_importacion');
        ok += 1;
      } catch (error) {
        // Errores que no son de validación ni de PostgreSQL abortan todo el lote.
        if (!(error instanceof HttpError) && !error.code) throw error;
        await client.query('ROLLBACK TO SAVEPOINT fila_importacion');
        failed += 1;
        await recordError(rowNumber, error instanceof HttpError ? { codigo: error.code, mensaje: error.message }
          : error.code === '23503' ? { codigo: 'INVALID_REFERENCE', mensaje: 'Una referencia (tipo, dificultad, tarea, tema, fuente…) no existe' }
            : { codigo: 'DATABASE_ERROR', mensaje: 'La fila no cumple las reglas del modelo' });
      }
    }
    const estado = ok === 0 ? 'FALLIDA' : failed ? 'COMPLETADA_CON_ERRORES' : 'COMPLETADA';
    await client.query(
      `UPDATE lote_importacion SET estado = $2, filas_exitosas = $3, filas_fallidas = $4, fecha_finalizacion = CURRENT_TIMESTAMP
        WHERE id_lote_importacion = $1`,
      [batchId, estado, ok, failed],
    );
    await audit(client, req, { entidad: 'lote_importacion', entidadId: batchId, accion: 'IMPORTAR_PREGUNTAS', despues: { estado, ok, failed } });
    return { id: batchId, estado, totalFilas: rows.length, filasExitosas: ok, filasFallidas: failed, preguntas: created };
  });
  sendData(res, summary, 201);
}));

router.get('/imports', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id_lote_importacion AS id, id_usuario AS "usuarioId", nombre_archivo AS "nombreArchivo",
            archivo_url AS "archivoUrl", estado, total_filas AS "totalFilas", filas_exitosas AS "filasExitosas",
            filas_fallidas AS "filasFallidas", fecha_inicio AS "fechaInicio",
            fecha_finalizacion AS "fechaFinalizacion", fecha_creacion AS "fechaCreacion"
       FROM lote_importacion WHERE id_usuario = $1 OR $2 = 'ADMINISTRADOR'
      ORDER BY fecha_creacion DESC LIMIT $3`,
    [req.user.id, req.user.rol, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.get('/imports/:id', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const batch = await query(
    `SELECT id_lote_importacion AS id, id_usuario AS "usuarioId", nombre_archivo AS "nombreArchivo", estado,
            total_filas AS "totalFilas", filas_exitosas AS "filasExitosas", filas_fallidas AS "filasFallidas",
            fecha_inicio AS "fechaInicio", fecha_finalizacion AS "fechaFinalizacion"
       FROM lote_importacion WHERE id_lote_importacion = $1 AND (id_usuario = $2 OR $3 = 'ADMINISTRADOR')`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!batch.rowCount) throw new HttpError(404, 'Lote de importación no encontrado', 'NOT_FOUND');
  const errors = await query(
    `SELECT numero_fila AS fila, columna, codigo_error AS codigo, mensaje, valor_recibido AS "valorRecibido"
       FROM error_importacion WHERE id_lote_importacion = $1 ORDER BY numero_fila, columna`,
    [req.params.id],
  );
  sendData(res, { ...batch.rows[0], errores: errors.rows });
}));

router.get('/:id', authorize('ADMINISTRADOR', 'PROFESOR', 'GESTOR_INSTITUCIONAL'), asyncHandler(async (req, res) => {
  const result = await query(`${selectQuestion}
    WHERE vp.id_version_pregunta = $1 AND (vp.estado = 'PUBLICADA' OR vp.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')`,
  [req.params.id, req.user.id, req.user.rol]);
  if (!result.rowCount) throw new HttpError(404, 'Pregunta no encontrada', 'NOT_FOUND');
  sendData(res, mapQuestion(result.rows[0], req.user.rol === 'ADMINISTRADOR' || result.rows[0].id_creada_por === req.user.id));
}));

router.post('/:id/versions', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = questionBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Versión inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await transaction(async (client) => {
    const question = await client.query('SELECT id_pregunta, id_creada_por FROM pregunta WHERE id_pregunta = $1 FOR UPDATE', [req.params.id]);
    if (!question.rowCount) throw new HttpError(404, 'Pregunta no encontrada', 'NOT_FOUND');
    if (question.rows[0].id_creada_por !== req.user.id && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'No puedes versionar esta pregunta', 'FORBIDDEN');
    const max = await client.query('SELECT COALESCE(max(numero_version), 0)::int AS version FROM version_pregunta WHERE id_pregunta = $1', [req.params.id]);
    const version = max.rows[0].version + 1;
    const versionId = await insertVersion(client, req.user, req.params.id, version, parsed.data);
    return { versionId, version };
  });
  sendData(res, { preguntaId: req.params.id, ...result, estado: 'BORRADOR' }, 201);
}));

// Publicar una versión archiva la versión publicada anterior de la misma pregunta.
// Los cuestionarios ya publicados conservan la versión que referencian.
router.post('/:id/publish', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const published = await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE version_pregunta vp SET estado = 'PUBLICADA', fecha_publicacion = CURRENT_TIMESTAMP
         WHERE vp.id_version_pregunta = $1 AND vp.estado = 'BORRADOR'
           AND (vp.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')
           AND EXISTS (SELECT 1 FROM clave_respuesta cr WHERE cr.id_version_pregunta = vp.id_version_pregunta)
           AND (SELECT count(*) FROM opcion_respuesta op WHERE op.id_conjunto_opciones = vp.id_conjunto_opciones) >= 2
           AND (vp.id_version_estimulo IS NULL OR EXISTS (
                 SELECT 1 FROM version_estimulo ve WHERE ve.id_version_estimulo = vp.id_version_estimulo AND ve.estado = 'PUBLICADA'))
         RETURNING vp.id_version_pregunta AS id, vp.id_pregunta AS "preguntaId", vp.numero_version AS version, vp.estado`,
      [req.params.id, req.user.id, req.user.rol],
    );
    if (!updated.rowCount) return null;
    const archived = await client.query(
      `UPDATE version_pregunta SET estado = 'ARCHIVADA'
        WHERE id_pregunta = $1 AND estado = 'PUBLICADA' AND id_version_pregunta <> $2
        RETURNING id_version_pregunta`,
      [updated.rows[0].preguntaId, req.params.id],
    );
    await audit(client, req, { entidad: 'version_pregunta', entidadId: req.params.id, accion: 'PUBLICAR', despues: { archivadas: archived.rows.map((row) => row.id_version_pregunta) } });
    return updated.rows[0];
  });
  if (!published) throw new HttpError(400, 'La versión no existe, no es editable o está incompleta (clave, opciones o estímulo sin publicar)', 'QUESTION_INCOMPLETE');
  sendData(res, published);
}));

router.post('/:id/archive', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const archived = await transaction(async (client) => {
    const updated = await client.query(
      `UPDATE version_pregunta SET estado = 'ARCHIVADA'
        WHERE id_version_pregunta = $1 AND estado <> 'ARCHIVADA' AND (id_creada_por = $2 OR $3 = 'ADMINISTRADOR')
        RETURNING id_version_pregunta AS id, id_pregunta AS "preguntaId", numero_version AS version, estado`,
      [req.params.id, req.user.id, req.user.rol],
    );
    if (updated.rowCount) await audit(client, req, { entidad: 'version_pregunta', entidadId: req.params.id, accion: 'ARCHIVAR' });
    return updated.rows[0];
  });
  if (!archived) throw new HttpError(409, 'La versión no existe, no es tuya o ya está archivada', 'INVALID_STATE');
  sendData(res, archived);
}));

export default router;
