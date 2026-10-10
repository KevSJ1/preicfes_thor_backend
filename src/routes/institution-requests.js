import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, parseLimit, requireUuidParams, sendData } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id');
const admin = [authenticate, authorize('ADMINISTRADOR')];
const requestStates = ['PENDIENTE', 'EN_REVISION', 'CONTACTADA', 'APROBADA', 'RECHAZADA'];

const requestSchema = z.object({
  nombreInstitucion: z.string().trim().min(1).max(180),
  nombreResponsable: z.string().trim().min(1).max(120),
  cargo: z.string().trim().min(1).max(100),
  correoInstitucional: z.string().trim().email().max(254),
  telefono: z.string().trim().min(1).max(30),
  ciudad: z.string().trim().min(1).max(100),
  rangoEstudiantes: z.string().trim().min(1).max(60),
  mensaje: z.string().max(10000).optional(),
  aceptaPoliticaDatos: z.literal(true),
  servicios: z.array(z.string().uuid()).max(30).default([]),
}).strict();

const selectRequest = `
  SELECT s.id_solicitud AS id, s.nombre_institucion AS "nombreInstitucion",
         s.nombre_responsable AS "nombreResponsable", s.cargo,
         s.correo_institucional AS "correoInstitucional", s.telefono, s.ciudad,
         s.rango_estudiantes AS "rangoEstudiantes", s.mensaje, s.estado,
         s.notas_internas AS "notasInternas", s.id_revisada_por AS "revisadaPor",
         s.id_institucion_creada AS "institucionId",
         s.fecha_creacion AS "fechaCreacion", s.fecha_actualizacion AS "fechaActualizacion",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sv.id_servicio, 'codigo', sv.codigo, 'nombre', sv.nombre) ORDER BY sv.nombre)
                     FROM solicitud_servicio ss JOIN servicio sv ON sv.id_servicio = ss.id_servicio
                    WHERE ss.id_solicitud = s.id_solicitud), '[]'::jsonb) AS servicios
    FROM solicitud_acceso_institucional s`;

router.post('/', sensitiveLimiter, asyncHandler(async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Solicitud inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const data = parsed.data;
  const services = [...new Set(data.servicios)];
  const created = await transaction(async (client) => {
    if (services.length) {
      const active = await client.query('SELECT count(*)::int AS total FROM servicio WHERE id_servicio = ANY($1::uuid[]) AND activo', [services]);
      if (active.rows[0].total !== services.length) throw new HttpError(400, 'Algún servicio no existe o no está disponible', 'INVALID_REFERENCE');
    }
    const id = randomUUID();
    const saved = await client.query(
      `INSERT INTO solicitud_acceso_institucional
         (id_solicitud, nombre_institucion, nombre_responsable, cargo, correo_institucional,
          telefono, ciudad, rango_estudiantes, mensaje, acepta_politica_datos, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, lower(btrim($5)), $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       RETURNING id_solicitud, estado, fecha_creacion`,
      [id, data.nombreInstitucion, data.nombreResponsable, data.cargo, data.correoInstitucional, data.telefono, data.ciudad, data.rangoEstudiantes, data.mensaje ?? null, data.aceptaPoliticaDatos],
    );
    for (const serviceId of services) {
      await client.query('INSERT INTO solicitud_servicio (id_solicitud, id_servicio) VALUES ($1, $2)', [id, serviceId]);
    }
    return saved.rows[0];
  });
  sendData(res, { id: created.id_solicitud, estado: created.estado, fechaCreacion: created.fecha_creacion }, 201);
}));

router.get('/', ...admin, asyncHandler(async (req, res) => {
  const filter = requestStates.includes(req.query.estado) ? req.query.estado : null;
  const result = await query(
    `${selectRequest} WHERE ($1::estado_solicitud_institucional IS NULL OR s.estado = $1)
      ORDER BY s.fecha_creacion DESC LIMIT $2`,
    [filter, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.get('/:id', ...admin, asyncHandler(async (req, res) => {
  const result = await query(`${selectRequest} WHERE s.id_solicitud = $1`, [req.params.id]);
  if (!result.rowCount) throw new HttpError(404, 'Solicitud no encontrada', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

// Aprobar crea la institución en la misma transacción. Una solicitud aprobada ya no cambia de estado.
router.patch('/:id/review', ...admin, asyncHandler(async (req, res) => {
  const parsed = z.object({ estado: z.enum(['EN_REVISION', 'CONTACTADA', 'RECHAZADA', 'APROBADA']), notasInternas: z.string().max(10000).nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Revisión inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await transaction(async (client) => {
    const found = await client.query('SELECT * FROM solicitud_acceso_institucional WHERE id_solicitud = $1 FOR UPDATE', [req.params.id]);
    const request = found.rows[0];
    if (!request) throw new HttpError(404, 'Solicitud no encontrada', 'NOT_FOUND');
    if (request.estado === 'APROBADA' && parsed.data.estado !== 'APROBADA') {
      throw new HttpError(409, 'La solicitud ya fue aprobada y su institución creada', 'INVALID_STATE');
    }
    let institutionId = request.id_institucion_creada;
    if (parsed.data.estado === 'APROBADA' && !institutionId) {
      institutionId = randomUUID();
      await client.query(
        `INSERT INTO institucion (id_institucion, id_creada_por, nombre, correo, telefono, ciudad, fecha_actualizacion)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [institutionId, req.user.id, request.nombre_institucion, request.correo_institucional, request.telefono, request.ciudad],
      );
      await audit(client, req, { entidad: 'institucion', entidadId: institutionId, accion: 'CREAR_DESDE_SOLICITUD', institucionId: institutionId, despues: { solicitudId: req.params.id } });
    }
    const updated = await client.query(
      `UPDATE solicitud_acceso_institucional
          SET estado = $2, notas_internas = COALESCE($3, notas_internas),
              id_revisada_por = $4, id_institucion_creada = $5,
              fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id_solicitud = $1
        RETURNING id_solicitud AS id, estado, id_institucion_creada AS "institucionId"`,
      [req.params.id, parsed.data.estado, parsed.data.notasInternas ?? null, req.user.id, institutionId],
    );
    await audit(client, req, { entidad: 'solicitud_acceso_institucional', entidadId: req.params.id, accion: 'REVISAR', antes: { estado: request.estado }, despues: updated.rows[0] });
    return updated.rows[0];
  });
  sendData(res, result);
}));

export default router;
