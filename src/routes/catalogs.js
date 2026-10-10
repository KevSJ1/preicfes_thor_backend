import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { asyncHandler, HttpError, sendData, requireUuidParams } from '../utils/http.js';

const router = Router();
requireUuidParams(router, 'id');
const admin = [authenticate, authorize('ADMINISTRADOR')];

router.get('/', asyncHandler(async (_req, res) => {
  const [pruebas, tiposPregunta, dificultades, modalidades, servicios] = await Promise.all([
    query('SELECT id_prueba AS id, codigo, nombre, descripcion FROM prueba WHERE activa ORDER BY nombre'),
    query('SELECT id_tipo_pregunta AS id, codigo, nombre, descripcion FROM tipo_pregunta WHERE activo ORDER BY nombre'),
    query('SELECT id_dificultad AS id, codigo, nombre, valor FROM nivel_dificultad ORDER BY valor'),
    query('SELECT id_modalidad AS id, codigo, nombre, descripcion FROM modalidad_evaluacion WHERE activa ORDER BY nombre'),
    query('SELECT id_servicio AS id, codigo, nombre, descripcion FROM servicio WHERE activo ORDER BY nombre'),
  ]);
  sendData(res, {
    pruebas: pruebas.rows,
    tiposPregunta: tiposPregunta.rows,
    dificultades: dificultades.rows,
    modalidades: modalidades.rows,
    servicios: servicios.rows,
  });
}));

/*
 * Jerarquía ICFES: prueba → competencia → afirmación → evidencia → tarea, y prueba → componente → tema.
 * Cada nivel se describe una sola vez y genera sus rutas GET (pública), POST y PATCH (administrador).
 */
const code = z.string().trim().min(1).max(50);
const text = z.string().trim().min(1);
const levels = [
  {
    parent: 'pruebas', parentTable: 'prueba', parentKey: 'id_prueba', path: 'competencias',
    table: 'competencia', key: 'id_competencia', activeColumn: 'activa', orderBy: 'nombre',
    fields: { codigo: ['codigo', code], nombre: ['nombre', z.string().trim().min(1).max(180)], descripcion: ['descripcion', z.string().nullable().optional()] },
  },
  {
    parent: 'competencias', parentTable: 'competencia', parentKey: 'id_competencia', path: 'afirmaciones',
    table: 'afirmacion', key: 'id_afirmacion', activeColumn: 'activa', orderBy: 'codigo',
    fields: { codigo: ['codigo', code], descripcion: ['descripcion', text] },
  },
  {
    parent: 'afirmaciones', parentTable: 'afirmacion', parentKey: 'id_afirmacion', path: 'evidencias',
    table: 'evidencia', key: 'id_evidencia', activeColumn: 'activa', orderBy: 'codigo',
    fields: { codigo: ['codigo', code], descripcion: ['descripcion', text] },
  },
  {
    parent: 'evidencias', parentTable: 'evidencia', parentKey: 'id_evidencia', path: 'tareas',
    table: 'tarea', key: 'id_tarea', activeColumn: 'activa', orderBy: 'codigo',
    fields: { codigo: ['codigo', code], descripcion: ['descripcion', text] },
  },
  {
    parent: 'pruebas', parentTable: 'prueba', parentKey: 'id_prueba', path: 'componentes',
    table: 'componente', key: 'id_componente', activeColumn: 'activo', orderBy: 'nombre',
    fields: { nombre: ['nombre', z.string().trim().min(1).max(150)], descripcion: ['descripcion', z.string().max(500).nullable().optional()] },
  },
  {
    parent: 'componentes', parentTable: 'componente', parentKey: 'id_componente', path: 'temas',
    table: 'tema', key: 'id_tema', activeColumn: 'activo', orderBy: 'nombre',
    fields: { nombre: ['nombre', z.string().trim().min(1).max(150)], descripcion: ['descripcion', z.string().max(500).nullable().optional()] },
  },
];

for (const level of levels) {
  const entries = Object.entries(level.fields);
  const columns = entries.map(([name, [column]]) => `${column} AS "${name}"`).join(', ');
  const returning = `${level.key} AS id, ${columns}, ${level.activeColumn} AS activo`;
  const createSchema = z.object(Object.fromEntries(entries.map(([name, [, type]]) => [name, type]))).strict();
  const updateSchema = z.object({
    ...Object.fromEntries(entries.map(([name, [, type]]) => [name, type.optional()])),
    activo: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo');

  router.get(`/${level.parent}/:id/${level.path}`, asyncHandler(async (req, res) => {
    const includeInactive = req.query.incluirInactivos === 'true';
    const result = await query(
      `SELECT ${returning} FROM ${level.table}
        WHERE ${level.parentKey} = $1 AND ($2 OR ${level.activeColumn}) ORDER BY ${level.orderBy}`,
      [req.params.id, includeInactive],
    );
    sendData(res, result.rows);
  }));

  router.post(`/${level.parent}/:id/${level.path}`, ...admin, asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Elemento de catálogo inválido', 'VALIDATION_ERROR', parsed.error.flatten());
    const created = await transaction(async (client) => {
      const parent = await client.query(`SELECT 1 FROM ${level.parentTable} WHERE ${level.parentKey} = $1`, [req.params.id]);
      if (!parent.rowCount) throw new HttpError(404, 'Elemento padre no encontrado', 'NOT_FOUND');
      const values = entries.map(([name]) => parsed.data[name] ?? null);
      const result = await client.query(
        `INSERT INTO ${level.table} (${level.key}, ${level.parentKey}, ${entries.map(([, [column]]) => column).join(', ')})
         VALUES ($1, $2, ${entries.map((_, index) => `$${index + 3}`).join(', ')})
         RETURNING ${returning}`,
        [randomUUID(), req.params.id, ...values],
      );
      await audit(client, req, { entidad: level.table, entidadId: result.rows[0].id, accion: 'CREAR', despues: result.rows[0] });
      return result.rows[0];
    });
    sendData(res, created, 201);
  }));

  router.patch(`/${level.path}/:id`, ...admin, asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Actualización de catálogo inválida', 'VALIDATION_ERROR', parsed.error.flatten());
    const sets = [];
    const params = [req.params.id];
    for (const [name, [column]] of entries) {
      if (parsed.data[name] !== undefined) { params.push(parsed.data[name]); sets.push(`${column} = $${params.length}`); }
    }
    if (parsed.data.activo !== undefined) { params.push(parsed.data.activo); sets.push(`${level.activeColumn} = $${params.length}`); }
    const updated = await transaction(async (client) => {
      const result = await client.query(`UPDATE ${level.table} SET ${sets.join(', ')} WHERE ${level.key} = $1 RETURNING ${returning}`, params);
      if (!result.rowCount) throw new HttpError(404, 'Elemento de catálogo no encontrado', 'NOT_FOUND');
      await audit(client, req, { entidad: level.table, entidadId: req.params.id, accion: 'ACTUALIZAR', despues: result.rows[0] });
      return result.rows[0];
    });
    sendData(res, updated);
  }));
}

export default router;
