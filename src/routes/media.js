import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler, HttpError, parseLimit, requireUuidParams, sendData } from '../utils/http.js';

// Solo metadatos: el binario vive en un almacenamiento de objetos privado que entrega la URL.
const router = Router();
requireUuidParams(router, 'id');
router.use(authenticate, authorize('ADMINISTRADOR', 'PROFESOR'));

const mediaColumns = `id_recurso AS id, tipo, url, nombre_archivo AS "nombreArchivo",
  texto_alternativo AS "textoAlternativo", mime_type AS "mimeType", tamano_bytes AS "tamanoBytes",
  fecha_creacion AS "fechaCreacion"`;
const sourceColumns = 'id_fuente AS id, nombre, tipo, referencia, anio';
const mimeByType = { IMAGEN: /^image\//, AUDIO: /^audio\//, VIDEO: /^video\//, DOCUMENTO: /^(application|text)\// };

router.get('/', asyncHandler(async (req, res) => {
  const type = ['IMAGEN', 'AUDIO', 'VIDEO', 'DOCUMENTO'].includes(req.query.tipo) ? req.query.tipo : null;
  const result = await query(
    `SELECT ${mediaColumns} FROM recurso_multimedia
      WHERE (id_subido_por = $1 OR $2 = 'ADMINISTRADOR') AND ($3::tipo_recurso IS NULL OR tipo = $3)
      ORDER BY fecha_creacion DESC LIMIT $4`,
    [req.user.id, req.user.rol, type, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const parsed = z.object({
    tipo: z.enum(['IMAGEN', 'AUDIO', 'VIDEO', 'DOCUMENTO']),
    url: z.string().url().max(1000).refine((value) => /^https?:\/\//i.test(value), 'La URL debe ser http(s)'),
    nombreArchivo: z.string().trim().min(1).max(255),
    textoAlternativo: z.string().max(500).nullable().optional(),
    mimeType: z.string().trim().toLowerCase().min(1).max(120),
    tamanoBytes: z.number().int().nonnegative().nullable().optional(),
  }).strict().refine((value) => mimeByType[value.tipo].test(value.mimeType), { message: 'mimeType no corresponde al tipo', path: ['mimeType'] })
    .safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Recurso inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const data = parsed.data;
  const result = await query(
    `INSERT INTO recurso_multimedia
       (id_recurso, id_subido_por, tipo, url, nombre_archivo, texto_alternativo, mime_type, tamano_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${mediaColumns}`,
    [randomUUID(), req.user.id, data.tipo, data.url, data.nombreArchivo, data.textoAlternativo ?? null, data.mimeType, data.tamanoBytes ?? null],
  );
  sendData(res, result.rows[0], 201);
}));

router.get('/sources', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ${sourceColumns} FROM fuente_contenido
      WHERE ($1::text IS NULL OR nombre ILIKE $1) ORDER BY nombre LIMIT $2`,
    [req.query.q ? `%${String(req.query.q).slice(0, 100)}%` : null, parseLimit(req.query.limit)],
  );
  sendData(res, result.rows);
}));

router.post('/sources', asyncHandler(async (req, res) => {
  const parsed = z.object({ nombre: z.string().trim().min(1).max(180), tipo: z.enum(['PROPIA', 'ICFES', 'LIBRO', 'OTRO']), referencia: z.string().max(500).nullable().optional(), anio: z.number().int().min(1900).max(2200).nullable().optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Fuente inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const data = parsed.data;
  const result = await query(
    `INSERT INTO fuente_contenido (id_fuente, nombre, tipo, referencia, anio)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${sourceColumns}`,
    [randomUUID(), data.nombre, data.tipo, data.referencia ?? null, data.anio ?? null],
  );
  sendData(res, result.rows[0], 201);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ${mediaColumns} FROM recurso_multimedia WHERE id_recurso = $1 AND (id_subido_por = $2 OR $3 = 'ADMINISTRADOR')`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!result.rowCount) throw new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

// Solo se eliminan recursos que no estén enlazados a preguntas, estímulos u opciones.
router.delete('/:id', asyncHandler(async (req, res) => {
  const result = await query(
    `DELETE FROM recurso_multimedia rm
      WHERE rm.id_recurso = $1 AND (rm.id_subido_por = $2 OR $3 = 'ADMINISTRADOR')
        AND NOT EXISTS (SELECT 1 FROM version_pregunta_recurso x WHERE x.id_recurso = rm.id_recurso)
        AND NOT EXISTS (SELECT 1 FROM version_estimulo_recurso x WHERE x.id_recurso = rm.id_recurso)
        AND NOT EXISTS (SELECT 1 FROM opcion_recurso x WHERE x.id_recurso = rm.id_recurso)`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!result.rowCount) throw new HttpError(409, 'El recurso no existe, no es tuyo o está en uso', 'RESOURCE_IN_USE');
  res.status(204).end();
}));

export default router;
