import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Número de proxies confiables delante de la API (0 = conexión directa). Afecta req.ip y el rate limit.
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),
  // ID de cliente OAuth (tipo "Aplicación web") de Google Cloud. Vacío = inicio de sesión con Google deshabilitado.
  GOOGLE_CLIENT_ID: z.string().trim().optional().transform((value) => value || undefined),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuración inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const defaults = parsed.data.NODE_ENV === 'production' ? {} : {
  JWT_ACCESS_SECRET: 'local-development-access-secret-at-least-32-chars',
  JWT_REFRESH_SECRET: 'local-development-refresh-secret-at-least-32-chars',
};
const accessSecret = parsed.data.JWT_ACCESS_SECRET ?? defaults.JWT_ACCESS_SECRET;
const refreshSecret = parsed.data.JWT_REFRESH_SECRET ?? defaults.JWT_REFRESH_SECRET;
if (!accessSecret || !refreshSecret) {
  console.error('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET son obligatorios fuera de desarrollo.');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  JWT_ACCESS_SECRET: accessSecret,
  JWT_REFRESH_SECRET: refreshSecret,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
};