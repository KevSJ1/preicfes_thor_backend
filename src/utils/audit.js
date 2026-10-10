import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { query } from '../db/pool.js';

/**
 * Registra una entrada en la bitácora `auditoria`.
 * Recibe el cliente de la transacción en curso para que la entrada se confirme o revierta junto con el cambio.
 */
export async function audit(client, req, { entidad, entidadId, accion, antes = null, despues = null, institucionId = null }) {
  const ip = isIP(req.ip ?? '') ? req.ip : null;
  await (client ?? { query }).query(
    `INSERT INTO auditoria
       (id_auditoria, id_usuario, id_institucion, entidad, id_entidad, accion, datos_anteriores, datos_nuevos, direccion_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), req.user?.id ?? null, institucionId ?? req.user?.idInstitucion ?? null, entidad,
      entidadId ? String(entidadId) : null, accion,
      antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null, ip],
  );
}
