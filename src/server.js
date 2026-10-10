import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

const server = app.listen(env.PORT, () => console.info(`PreICFES Thor API escuchando en :${env.PORT}`));

async function shutdown(signal) {
  console.info(`${signal}: cerrando API...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));