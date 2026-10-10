export class HttpError extends Error {
  constructor(status, message, code = 'HTTP_ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function sendData(res, data, status = 200) {
  return res.status(status).json({ data });
}

export function parseLimit(value, fallback = 50, max = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function parseOffset(value) {
  if (value === undefined) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, 'offset inválido', 'VALIDATION_ERROR');
  return parsed;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && uuidPattern.test(value);

// Exige que los parámetros de ruta indicados sean UUID en todas las rutas del router, antes de llegar a PostgreSQL.
export function requireUuidParams(router, ...names) {
  for (const name of names) {
    router.param(name, (_req, _res, next, value) => {
      if (!isUuid(value)) return next(new HttpError(400, 'Identificador inválido', 'VALIDATION_ERROR', { param: name }));
      next();
    });
  }
}
