import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, parseLimit, sendData, requireUuidParams } from '../utils/http.js';

// Estímulos (textos, gráficos, situaciones) compartidos por varias preguntas. Se versionan igual que las preguntas:
// las rutas de lectura y publicación usan el id de la versión; crear versión usa el id del estímulo.
const router = Router();
requireUuidParams(router, 'id');
router.use(authenticate, authorize('ADMINISTRADOR', 'PROFESOR', 'GESTOR_INSTITUCIONAL'));

const stimulusBody = z.object({
  titulo: z.string().trim().max(250).nullable().optional(),
  contenido: z.string().trim().min(1).max(100000),
  fuenteId: z.string().uuid().nullable().optional(),
  recursos: z.array(z.string().uuid()).max(20).default([]),
}).strict();

const selectStimulus = `
  SELECT ve.id_version_estimulo AS id, ve.id_estimulo AS "estimuloId", e.codigo, ve.numero_version AS version,
         ve.titulo, ve.contenido, ve.estado, ve.id_fuente AS "fuenteId", e.id_creada_por AS "creadaPor",
         ve.fecha_creacion AS "fechaCreacion", ve.fecha_publicacion AS "fechaPublicacion",
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rm.id_recurso, 'tipo', rm.tipo, 'url', rm.url,
                     'textoAlternativo', rm.texto_alternativo, 'mimeType', rm.mime_type) ORDER BY ver.orden)
                     FROM version_estimulo_recurso ver JOIN recurso_multimedia rm ON rm.id_recurso = ver.id_recurso
                    WHERE ver.id_version_estimulo = ve.id_version_estimulo), '[]'::jsonb) AS recursos
    FROM version_estimulo ve JOIN estimulo e ON e.id_estimulo = ve.id_estimulo`;

async function insertVersion(client, stimulusId, version, data) {
  const versionId = randomUUID();
  await client.query(
    `INSERT INTO version_estimulo (id_version_estimulo, id_estimulo, id_fuente, numero_version, titulo, contenido)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [versionId, stimulusId, data.fuenteId ?? null, version, data.titulo ?? null, data.contenido],
  );
  for (const [index, resourceId] of [...new Set(data.recursos)].entries()) {
    await client.query('INSERT INTO version_estimulo_recurso (id_version_estimulo, id_recurso, orden) VALUES ($1, $2, $3)', [versionId, resourceId, index + 1]);
  }
  return versionId;
}

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 100)}%`); where.push(`(ve.titulo ILIKE $${params.length} OR e.codigo ILIKE $${params.length})`); }
  if (['BORRADOR', 'PUBLICADA', 'ARCHIVADA'].includes(req.query.estado)) { params.push(req.query.estado); where.push(`ve.estado = $${params.length}`); }
  if (req.user.rol !== 'ADMINISTRADOR') { params.push(req.user.id); where.push(`(ve.estado = 'PUBLICADA' OR e.id_creada_por = $${params.length})`); }
  params.push(parseLimit(req.query.limit));
  const result = await query(
    `${selectStimulus} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ve.fecha_creacion DESC LIMIT $${params.length}`,
    params,
  );
  sendData(res, result.rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const result = await query(
    `${selectStimulus} WHERE ve.id_version_estimulo = $1 AND (ve.estado = 'PUBLICADA' OR e.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')`,
    [req.params.id, req.user.id, req.user.rol],
  );
  if (!result.rowCount) throw new HttpError(404, 'Estímulo no encontrado', 'NOT_FOUND');
  sendData(res, result.rows[0]);
}));

router.post('/', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = stimulusBody.extend({ codigo: z.string().trim().min(1).max(80).optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Estímulo inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const stimulusId = randomUUID();
  const versionId = await transaction(async (client) => {
    await client.query('INSERT INTO estimulo (id_estimulo, id_creada_por, codigo) VALUES ($1, $2, $3)', [stimulusId, req.user.id, parsed.data.codigo ?? `E-${stimulusId}`]);
    return insertVersion(client, stimulusId, 1, parsed.data);
  });
  sendData(res, { estimuloId: stimulusId, id: versionId, version: 1, estado: 'BORRADOR' }, 201);
}));

router.post('/:id/versions', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const parsed = stimulusBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Versión de estímulo inválida', 'VALIDATION_ERROR', parsed.error.flatten());
  const result = await transaction(async (client) => {
    const stimulus = await client.query('SELECT id_creada_por FROM estimulo WHERE id_estimulo = $1 FOR UPDATE', [req.params.id]);
    if (!stimulus.rowCount) throw new HttpError(404, 'Estímulo no encontrado', 'NOT_FOUND');
    if (stimulus.rows[0].id_creada_por !== req.user.id && req.user.rol !== 'ADMINISTRADOR') throw new HttpError(403, 'No puedes versionar este estímulo', 'FORBIDDEN');
    const max = await client.query('SELECT COALESCE(max(numero_version), 0)::int AS version FROM version_estimulo WHERE id_estimulo = $1', [req.params.id]);
    const version = max.rows[0].version + 1;
    return { id: await insertVersion(client, req.params.id, version, parsed.data), version };
  });
  sendData(res, { estimuloId: req.params.id, ...result, estado: 'BORRADOR' }, 201);
}));

async function changeState(req, from, to, extraSet = '') {
  return transaction(async (client) => {
    const updated = await client.query(
      `UPDATE version_estimulo ve SET estado = $4 ${extraSet}
         FROM estimulo e
        WHERE e.id_estimulo = ve.id_estimulo AND ve.id_version_estimulo = $1 AND ve.estado = ANY($5::estado_pregunta[])
          AND (e.id_creada_por = $2 OR $3 = 'ADMINISTRADOR')
        RETURNING ve.id_version_estimulo AS id, ve.id_estimulo AS "estimuloId", ve.numero_version AS version, ve.estado`,
      [req.params.id, req.user.id, req.user.rol, to, from],
    );
    if (!updated.rowCount) return null;
    await audit(client, req, { entidad: 'version_estimulo', entidadId: req.params.id, accion: to === 'PUBLICADA' ? 'PUBLICAR' : 'ARCHIVAR' });
    return updated.rows[0];
  });
}

router.post('/:id/publish', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const updated = await changeState(req, ['BORRADOR'], 'PUBLICADA', ', fecha_publicacion = CURRENT_TIMESTAMP');
  if (!updated) throw new HttpError(409, 'La versión no existe, no es tuya o no está en borrador', 'INVALID_STATE');
  sendData(res, updated);
}));

router.post('/:id/archive', authorize('ADMINISTRADOR', 'PROFESOR'), asyncHandler(async (req, res) => {
  const updated = await changeState(req, ['BORRADOR', 'PUBLICADA'], 'ARCHIVADA');
  if (!updated) throw new HttpError(409, 'La versión no existe, no es tuya o ya está archivada', 'INVALID_STATE');
  sendData(res, updated);
}));

export default router;
