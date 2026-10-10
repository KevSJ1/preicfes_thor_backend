#!/usr/bin/env node
/*
 * Crea o promueve una cuenta ADMINISTRADOR activa (bootstrap inicial).
 * Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_NOMBRES=...] [ADMIN_APELLIDOS=...] npm run create-admin
 * Si el correo ya existe, se le asigna rol ADMINISTRADOR, estado ACTIVO y la nueva contraseña,
 * y se revocan sus sesiones de refresco.
 */
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { pool, transaction } from '../src/db/pool.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  console.error('Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres).');
  process.exit(1);
}

try {
  const hash = await argon2.hash(password);
  const result = await transaction(async (client) => {
    const role = await client.query(`SELECT id_rol FROM rol WHERE codigo = 'ADMINISTRADOR'`);
    if (!role.rowCount) throw new Error('No existe el rol ADMINISTRADOR en la base');
    const saved = await client.query(
      `INSERT INTO usuario (id_usuario, id_rol, nombres, apellidos, correo, contrasena_hash, correo_verificado, estado, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, $6, true, 'ACTIVO', CURRENT_TIMESTAMP)
       ON CONFLICT (lower(correo)) DO UPDATE SET
         id_rol = EXCLUDED.id_rol, contrasena_hash = EXCLUDED.contrasena_hash,
         estado = 'ACTIVO', correo_verificado = true, fecha_actualizacion = CURRENT_TIMESTAMP
       RETURNING id_usuario, (xmax = 0) AS creado`,
      [randomUUID(), role.rows[0].id_rol, process.env.ADMIN_NOMBRES?.trim() || 'Administrador',
        process.env.ADMIN_APELLIDOS?.trim() || 'PreICFES', email, hash],
    );
    await client.query('UPDATE sesion_refresco SET fecha_revocacion = CURRENT_TIMESTAMP WHERE id_usuario = $1 AND fecha_revocacion IS NULL', [saved.rows[0].id_usuario]);
    return saved.rows[0];
  });
  console.info(`${result.creado ? 'Administrador creado' : 'Cuenta existente promovida a administrador'}: ${email} (${result.id_usuario})`);
} catch (error) {
  console.error('No se pudo crear el administrador:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
