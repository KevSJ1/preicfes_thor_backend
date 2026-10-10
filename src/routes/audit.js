import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler, HttpError, isUuid, parseLimit, parseOffset, sendData } from '../utils/http.js';

const router = Router();
router.use(authenticate, authorize('ADMINISTRADOR'));

router.get('/', asyncHandler(async (req, res) => {
  for (const name of ['institutionId', 'userId']) {
    if (req.query[name] && !isUuid(req.query[name])) throw new HttpError(400, `${name} inválido`, 'VALIDATION_ERROR');
  }
  const result = await query(
    `SELECT a.id_auditoria AS id, a.id_usuario AS "usuarioId", u.correo AS "usuarioCorreo",
            a.id_institucion AS "institucionId", a.entidad, a.id_entidad AS "entidadId", a.accion,
            a.datos_anteriores AS "datosAnteriores", a.datos_nuevos AS "datosNuevos",
            a.direccion_ip AS "direccionIp", a.fecha
       FROM auditoria a LEFT JOIN usuario u ON u.id_usuario = a.id_usuario
      WHERE ($1::uuid IS NULL OR a.id_institucion = $1)
        AND ($2::text IS NULL OR a.entidad = $2)
        AND ($3::uuid IS NULL OR a.id_usuario = $3)
        AND ($4::text IS NULL OR a.id_entidad = $4)
      ORDER BY a.fecha DESC LIMIT $5 OFFSET $6`,
    [req.query.institutionId ?? null, req.query.entity ?? null, req.query.userId ?? null,
      req.query.entityId ? String(req.query.entityId) : null, parseLimit(req.query.limit), parseOffset(req.query.offset)],
  );
  sendData(res, result.rows);
}));

export default router;
