import { HttpError } from '../utils/http.js';

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Recurso no encontrado', 'NOT_FOUND'));
}

// Códigos SQLSTATE de PostgreSQL que se traducen a errores de cliente sin exponer el mensaje original.
const pgErrors = {
  23505: [409, 'CONFLICT', 'El registro ya existe'],
  23503: [400, 'INVALID_REFERENCE', 'Una referencia relacionada no existe o no se puede eliminar'],
  23502: [400, 'VALIDATION_ERROR', 'Falta un valor obligatorio'],
  23514: [400, 'VALIDATION_ERROR', 'Los datos no cumplen las reglas del modelo'],
  '22P02': [400, 'VALIDATION_ERROR', 'Los datos no cumplen las reglas del modelo'],
  22001: [400, 'VALIDATION_ERROR', 'Un valor excede la longitud permitida'],
  22003: [400, 'VALIDATION_ERROR', 'Un valor numérico está fuera de rango'],
  22007: [400, 'VALIDATION_ERROR', 'Fecha u hora con formato inválido'],
  22008: [400, 'VALIDATION_ERROR', 'Fecha u hora fuera de rango'],
  P0001: [422, 'BUSINESS_RULE', 'La operación no cumple las reglas de negocio del modelo'],
};

export function errorHandler(error, _req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Error interno del servidor';
  let details;

  if (error instanceof HttpError) {
    ({ status, code, message, details } = error);
  } else if (pgErrors[error.code]) {
    [status, code, message] = pgErrors[error.code];
  } else if (error.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'El cuerpo de la solicitud no es JSON válido';
  } else if (error.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'El cuerpo de la solicitud es demasiado grande';
  } else if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    status = error.status; code = 'BAD_REQUEST'; message = 'Solicitud inválida';
  }

  if (status >= 500 || error.code === 'P0001') console.error(error);
  const body = { error: { code, message } };
  if (details && status < 500) body.error.details = details;
  res.status(status).json(body);
}
