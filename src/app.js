import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { query } from './db/pool.js';
import { asyncHandler, sendData } from './utils/http.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(helmet());
app.use(cors({ origin: env.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(globalLimiter);

app.get('/health', asyncHandler(async (_req, res) => {
  await query('SELECT 1');
  sendData(res, { status: 'ok', database: 'connected' });
}));
// Documentación de uso en HTML estático (sin scripts en línea, compatible con la CSP de helmet).
const docsDir = fileURLToPath(new URL('./docs/', import.meta.url));
app.get('/api/documentacion', (_req, res) => res.sendFile('index.html', { root: docsDir }));
app.use('/api/documentacion', express.static(docsDir, { index: 'index.html' }));
app.use(env.API_PREFIX, apiRouter);
app.use(notFound);
app.use(errorHandler);
