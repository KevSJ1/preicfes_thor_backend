import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query, transaction } from '../db/pool.js';
import { authenticate, signAccessToken } from '../middleware/auth.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, isUuid, sendData } from '../utils/http.js';

const router = Router();
const password = z.string().min(8).max(128);
const credentials = z.object({ correo: z.string().trim().email().max(254), contrasena: password }).strict();
const digest = (value) => createHash('sha256').update(value).digest('hex');
// Hash de relleno para que un correo inexistente tarde lo mismo que una contraseña incorrecta.
const dummyHash = argon2.hash(randomUUID());
const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;
const userColumns = `u.id_usuario, u.nombres, u.apellidos, u.correo, u.estado, u.foto_perfil_url, r.codigo AS rol_global`;

function issueRefreshToken(userId) {
  return jwt.sign({}, env.JWT_REFRESH_SECRET, {
    subject: userId,
    jwtid: randomUUID(),
    expiresIn: `${env.REFRESH_TOKEN_DAYS}d`,
  });
}

async function saveSession(client, req, userId, token) {
  await client.query(
    `INSERT INTO sesion_refresco
       (id_sesion, id_usuario, token_hash, direccion_ip, agente_usuario, fecha_expiracion)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + ($6 * INTERVAL '1 day'))`,
    [randomUUID(), userId, digest(token), isIP(req.ip ?? '') ? req.ip : null,
      req.get('user-agent')?.slice(0, 500) ?? null, env.REFRESH_TOKEN_DAYS],
  );
}

function userSummary(user) {
  return {
    id: user.id_usuario,
    nombres: user.nombres,
    apellidos: user.apellidos,
    correo: user.correo,
    fotoPerfilUrl: user.foto_perfil_url ?? null,
    rol: user.rol_global ?? null,
  };
}

router.post('/register', sensitiveLimiter, asyncHandler(async (req, res) => {
  const parsed = credentials.extend({ nombres: z.string().trim().min(1).max(100), apellidos: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Datos de registro inválidos', 'VALIDATION_ERROR', parsed.error.flatten());
  const { nombres, apellidos, correo, contrasena } = parsed.data;
  const role = await query(`SELECT id_rol FROM rol WHERE codigo = 'ESTUDIANTE'`);
  if (!role.rowCount) throw new HttpError(500, 'No está configurado el rol ESTUDIANTE');
  const result = await query(
    `INSERT INTO usuario (id_usuario, id_rol, nombres, apellidos, correo, contrasena_hash, estado, fecha_actualizacion)
     VALUES ($1, $2, $3, $4, lower(btrim($5)), $6, 'PENDIENTE', CURRENT_TIMESTAMP)
     RETURNING id_usuario, nombres, apellidos, correo, estado`,
    [randomUUID(), role.rows[0].id_rol, nombres, apellidos, correo, await argon2.hash(contrasena)],
  );
  sendData(res, { id: result.rows[0].id_usuario, estado: result.rows[0].estado, mensaje: 'Cuenta creada; requiere activación.' }, 201);
}));

router.post('/login', sensitiveLimiter, asyncHandler(async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Correo o contraseña inválidos', 'VALIDATION_ERROR');
  const result = await query(
    `SELECT ${userColumns}, u.contrasena_hash
       FROM usuario u LEFT JOIN rol r ON r.id_rol = u.id_rol
      WHERE lower(u.correo) = lower($1)`,
    [parsed.data.correo],
  );
  const user = result.rows[0];
  const passwordMatches = await argon2.verify(user?.contrasena_hash ?? await dummyHash, parsed.data.contrasena).catch(() => false);
  if (!user || !passwordMatches || user.estado !== 'ACTIVO') throw new HttpError(401, 'Credenciales incorrectas o cuenta inactiva', 'INVALID_CREDENTIALS');

  const refreshToken = issueRefreshToken(user.id_usuario);
  await saveSession({ query }, req, user.id_usuario, refreshToken);
  sendData(res, { accessToken: signAccessToken(user.id_usuario), refreshToken, user: userSummary(user) });
}));

router.post('/refresh', sensitiveLimiter, asyncHandler(async (req, res) => {
  const token = z.string().min(1).safeParse(req.body?.refreshToken);
  if (!token.success) throw new HttpError(400, 'refreshToken requerido', 'VALIDATION_ERROR');
  let payload;
  try { payload = jwt.verify(token.data, env.JWT_REFRESH_SECRET); }
  catch { throw new HttpError(401, 'Sesión de refresco inválida o expirada', 'UNAUTHORIZED'); }
  if (!isUuid(payload.sub)) throw new HttpError(401, 'Sesión de refresco inválida o expirada', 'UNAUTHORIZED');

  const userResult = await query(
    `SELECT ${userColumns} FROM usuario u LEFT JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1`,
    [payload.sub],
  );
  const user = userResult.rows[0];
  if (!user || user.estado !== 'ACTIVO') throw new HttpError(401, 'La cuenta no está activa', 'UNAUTHORIZED');

  const nextRefreshToken = issueRefreshToken(payload.sub);
  const rotated = await transaction(async (client) => {
    const session = await client.query(
      `UPDATE sesion_refresco SET fecha_revocacion = CURRENT_TIMESTAMP
        WHERE token_hash = $1 AND id_usuario = $2 AND fecha_revocacion IS NULL
          AND fecha_expiracion > CURRENT_TIMESTAMP RETURNING id_sesion`,
      [digest(token.data), payload.sub],
    );
    if (!session.rowCount) return false;
    await saveSession(client, req, payload.sub, nextRefreshToken);
    return true;
  });
  if (!rotated) {
    // Reutilizar un token ya rotado indica posible robo: se revocan todas las sesiones del usuario.
    const reused = await query('SELECT 1 FROM sesion_refresco WHERE token_hash = $1 AND fecha_revocacion IS NOT NULL', [digest(token.data)]);
    if (reused.rowCount) {
      await query('UPDATE sesion_refresco SET fecha_revocacion = CURRENT_TIMESTAMP WHERE id_usuario = $1 AND fecha_revocacion IS NULL', [payload.sub]);
    }
    throw new HttpError(401, 'Sesión de refresco revocada o expirada', 'UNAUTHORIZED');
  }

  sendData(res, { accessToken: signAccessToken(payload.sub), refreshToken: nextRefreshToken, user: userSummary(user) });
}));

// Métodos de inicio de sesión disponibles; el frontend lo usa para decidir si muestra el botón de Google.
router.get('/providers', (_req, res) => {
  sendData(res, { contrasena: true, google: { habilitado: Boolean(googleClient), clientId: env.GOOGLE_CLIENT_ID ?? null } });
});

/*
 * Inicio de sesión con Google. El frontend obtiene un ID token con Google Identity Services
 * (botón "Iniciar sesión con Google") y lo envía aquí; la API lo verifica contra GOOGLE_CLIENT_ID.
 * - Cuenta ya vinculada (google_sub) o con el mismo correo: se vincula y, si está ACTIVO, recibe tokens.
 * - Correo nuevo: se crea como ESTUDIANTE PENDIENTE, igual que /register; un administrador debe activarla.
 */
router.post('/google', sensitiveLimiter, asyncHandler(async (req, res) => {
  if (!googleClient) throw new HttpError(503, 'El inicio de sesión con Google no está configurado', 'GOOGLE_NOT_CONFIGURED');
  const parsed = z.object({ idToken: z.string().min(1).max(4096) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'idToken requerido', 'VALIDATION_ERROR', parsed.error.flatten());
  let profile;
  try {
    profile = (await googleClient.verifyIdToken({ idToken: parsed.data.idToken, audience: env.GOOGLE_CLIENT_ID })).getPayload();
  } catch {
    throw new HttpError(401, 'Token de Google inválido o expirado', 'INVALID_GOOGLE_TOKEN');
  }
  if (!profile?.sub || !profile.email || !profile.email_verified) {
    throw new HttpError(401, 'La cuenta de Google no tiene un correo verificado', 'INVALID_GOOGLE_TOKEN');
  }
  const picture = /^https:\/\//i.test(profile.picture ?? '') && profile.picture.length <= 1000 ? profile.picture : null;

  const outcome = await transaction(async (client) => {
    const found = await client.query(
      `SELECT ${userColumns}, u.google_sub FROM usuario u LEFT JOIN rol r ON r.id_rol = u.id_rol
        WHERE u.google_sub = $1 OR lower(u.correo) = lower($2)
        ORDER BY (u.google_sub = $1) DESC NULLS LAST LIMIT 1 FOR UPDATE OF u`,
      [profile.sub, profile.email],
    );
    const existing = found.rows[0];
    if (existing) {
      if (existing.google_sub && existing.google_sub !== profile.sub) {
        throw new HttpError(409, 'El correo ya está vinculado a otra cuenta de Google', 'GOOGLE_ACCOUNT_MISMATCH');
      }
      // Vincula la cuenta y completa la foto solo si el usuario no tiene una propia.
      const linked = await client.query(
        `UPDATE usuario SET google_sub = $2, correo_verificado = true,
                foto_perfil_url = COALESCE(foto_perfil_url, $3), fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE id_usuario = $1 RETURNING foto_perfil_url`,
        [existing.id_usuario, profile.sub, picture],
      );
      if (!existing.google_sub) {
        await audit(client, { ip: req.ip, user: { id: existing.id_usuario } }, { entidad: 'usuario', entidadId: existing.id_usuario, accion: 'VINCULAR_GOOGLE' });
      }
      return { created: false, user: { ...existing, foto_perfil_url: linked.rows[0].foto_perfil_url } };
    }
    const role = await client.query(`SELECT id_rol FROM rol WHERE codigo = 'ESTUDIANTE'`);
    if (!role.rowCount) throw new HttpError(500, 'No está configurado el rol ESTUDIANTE');
    const created = await client.query(
      `INSERT INTO usuario (id_usuario, id_rol, nombres, apellidos, correo, google_sub, foto_perfil_url, correo_verificado, estado, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, lower(btrim($5)), $6, $7, true, 'PENDIENTE', CURRENT_TIMESTAMP)
       RETURNING id_usuario, estado`,
      [randomUUID(), role.rows[0].id_rol, (profile.given_name || profile.name || profile.email.split('@')[0]).slice(0, 100),
        (profile.family_name ?? '').slice(0, 100), profile.email, profile.sub, picture],
    );
    return { created: true, user: created.rows[0] };
  });

  if (outcome.created) {
    return sendData(res, { id: outcome.user.id_usuario, estado: outcome.user.estado, mensaje: 'Cuenta creada con Google; requiere activación.' }, 201);
  }
  if (outcome.user.estado !== 'ACTIVO') {
    throw new HttpError(403, 'La cuenta aún no está activa', 'ACCOUNT_NOT_ACTIVE', { estado: outcome.user.estado });
  }
  const refreshToken = issueRefreshToken(outcome.user.id_usuario);
  await saveSession({ query }, req, outcome.user.id_usuario, refreshToken);
  sendData(res, { accessToken: signAccessToken(outcome.user.id_usuario), refreshToken, user: userSummary(outcome.user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = z.string().min(1).safeParse(req.body?.refreshToken);
  if (token.success) {
    await query(`UPDATE sesion_refresco SET fecha_revocacion = CURRENT_TIMESTAMP WHERE token_hash = $1 AND fecha_revocacion IS NULL`, [digest(token.data)]);
  }
  res.status(204).end();
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => sendData(res, req.user)));

router.post('/change-password', sensitiveLimiter, authenticate, asyncHandler(async (req, res) => {
  const parsed = z.object({ contrasenaActual: z.string().min(1).max(128), contrasenaNueva: password }).strict()
    .refine((value) => value.contrasenaActual !== value.contrasenaNueva, 'La nueva contraseña debe ser diferente')
    .safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Cambio de contraseña inválido', 'VALIDATION_ERROR', parsed.error.flatten());
  const current = await query('SELECT contrasena_hash FROM usuario WHERE id_usuario = $1', [req.user.id]);
  if (!current.rows[0].contrasena_hash) throw new HttpError(409, 'La cuenta inicia sesión con Google y no tiene contraseña', 'PASSWORD_NOT_SET');
  const matches = await argon2.verify(current.rows[0].contrasena_hash, parsed.data.contrasenaActual).catch(() => false);
  if (!matches) throw new HttpError(401, 'La contraseña actual no es correcta', 'INVALID_CREDENTIALS');
  const newHash = await argon2.hash(parsed.data.contrasenaNueva);
  await transaction(async (client) => {
    await client.query('UPDATE usuario SET contrasena_hash = $2, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_usuario = $1', [req.user.id, newHash]);
    await client.query('UPDATE sesion_refresco SET fecha_revocacion = CURRENT_TIMESTAMP WHERE id_usuario = $1 AND fecha_revocacion IS NULL', [req.user.id]);
    await audit(client, req, { entidad: 'usuario', entidadId: req.user.id, accion: 'CAMBIAR_CONTRASENA' });
  });
  res.status(204).end();
}));

export default router;
