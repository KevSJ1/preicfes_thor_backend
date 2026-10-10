import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, parseLimit, sendData, requireUuidParams } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id');
router.use(authenticate);

const selectTemplate = `
  SELECT p.id_plantilla AS id, p.nombre, p.descripcion, p.oficial, p.activa, p.version,
         p.id_creada_por AS "creadaPor", m.codigo AS modalidad,
         COALESCE(jsonb_agg(jsonb_build_object('id', dp.id_detalle, 'pruebaId', dp.id_prueba,
           'prueba', pr.nombre, 'numeroSesion', dp.numero_sesion,
           'cantidadPreguntas', dp.cantidad_preguntas, 'duracionMinutos', dp.duracion_minutos, 'orden', dp.orden)
           ORDER BY dp.orden)
           FILTER (WHERE dp.id_detalle IS NOT NULL), '[]'::jsonb) AS sesiones
    FROM plantilla_evaluacion p JOIN modalidad_evaluacion m ON m.id_modalidad = p.id_modalidad
    LEFT JOIN detalle_plantilla dp ON dp.id_plantilla = p.id_plantilla
    LEFT JOIN prueba pr ON pr.id_prueba = dp.id_prueba`;

router.get('/modalities', asyncHandler(async (_req, res) => {
  const result = await query('SELECT id_modalidad AS id, codigo, nombre, descripcion FROM modalidad_evaluacion WHERE activa ORDER BY nombre');
  sendData(res, result.rows);
}));

router.get('/', asyncHandler(async (req, res) => {
  const result = await query(
    `${selectTemplate}
      WHERE p.activa AND (p.oficial OR p.id_creada_por = $1 OR $2 = 'ADMINISTRADOR')
      GROUP BY p.id_plantilla, m.codigo ORDER BY p.oficial DESC, p.nombre LIMIT $3`,
    [req.user.id, req.user.rol, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const result = await query(
    `${selectTemplate}
      WHERE p.id_plantilla = $1 AND ((p.activa AND p.oficial) OR p.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')
      GROUP BY p.id_plantilla, m.codigo`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!result.rowCount) throw new HttpError(404, 'Plantilla no encontrada', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

router.post('/', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({
    modalidadId: z.string().uuid(),
    nombre: z.string().trim().min(1).max(180),
    descripcion: z.string().max(500).nullable().optional(),
    oficial: z.boolean().optional(),
    sesiones: z.array(z.object({ pruebaId: z.string().uuid(), numeroSesion: z.number().int().positive(), cantidadPreguntas: z.number().int().positive(), duracionMinutos: z.number().int().positive(), orden: z.number().int().positive() }).strict()).min(1).max(50),
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Plantilla inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const data = parsed.data;
  if (data.oficial && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'Solo un administrador puede crear plantillas oficiales', 'FORBIDDEN');
  const result = await transaction(async (client) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO plantilla_evaluacion (id_plantilla, id_modalidad, id_creada_por, nombre, descripcion, oficial, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [id, data.modalidadId, req.user.id, data.nombre, data.descripcion ?? null, data.oficial ?? false],
    );
    for (const session of data.sesiones) {
      await client.query(
        `INSERT INTO detalle_plantilla (id_detalle, id_plantilla, id_prueba, numero_sesion, cantidad_preguntas, duracion_minutos, orden)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), id, session.pruebaId, session.numeroSesion, session.cantidadPreguntas, session.duracionMinutos, session.orden],
      );
    }
    return id;
  });
  sendData(res, { id: result, nombre: data.nombre }, 201);
}));

router.patch('/:id', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = z.object({
    nombre: z.string().trim().min(1).max(180).optional(),
    descripcion: z.string().max(500).nullable().optional(),
    activa: z.boolean().optional(),
    oficial: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo').safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Actualización de plantilla inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const data = parsed.data;
  if (data.oficial !== undefined && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'Solo un administrador puede cambiar si una plantilla es oficial', 'FORBIDDEN');
  const updated = await transaction(async (client) => {
    const found = await client.query('SELECT id_creada_por FROM plantilla_evaluacion WHERE id_plantilla = $1 FOR UPDATE', [req.params.id]);
    if (!found.rowCount) throw new HttpError(404, 'Plantilla no encontrada', 'NOT_FOUND');
    if (found.rows[0].id_creada_por !== req.user.id && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'No puedes modificar esta plantilla', 'FORBIDDEN');
    const result = await client.query(
      `UPDATE plantilla_evaluacion SET
         nombre = COALESCE($2, nombre),
         descripcion = CASE WHEN $3 THEN $4 ELSE descripcion END,
         activa = COALESCE($5, activa), oficial = COALESCE($6, oficial),
         fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id_plantilla = $1
       RETURNING id_plantilla AS id, nombre, descripcion, activa, oficial, version`,
      [req.params.id, data.nombre ?? null, data.descripcion !== undefined, data.descripcion ?? null, data.activa ?? null, data.oficial ?? null],
    );
    await audit(client, req, { entidad: 'plantilla_evaluacion', entidadId: req.params.id, accion: 'ACTUALIZAR', despues: result.rows[0] });
    return result.rows[0];
  });
  sendData(res, updated);
}));

export default router;
