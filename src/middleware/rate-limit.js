import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const common = { standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env.NODE_ENV === 'test' };
const limited = (code, message) => (_req, res) => res.status(429).json({ error: { code, message } });

export const globalLimiter = rateLimit({
  ...common, windowMs: 15 * 60 * 1000, limit: 300,
  handler: limited('RATE_LIMITED', 'Demasiadas solicitudes; intenta más tarde'),
});

// Endpoints públicos sensibles: login, registro, refresco y formularios anónimos.
export const sensitiveLimiter = rateLimit({
  ...common, windowMs: 15 * 60 * 1000, limit: 20,
  handler: limited('RATE_LIMITED', 'Demasiados intentos; espera unos minutos'),
});
