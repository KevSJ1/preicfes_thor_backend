/*
 * Prueba de extremo a extremo contra una base PostgreSQL real con SQL/preicfes.sql y SQL/seed.sql cargados.
 * Escribe datos: úsala solo con una base desechable, indicada en TEST_DATABASE_URL.
 *   TEST_DATABASE_URL=postgresql://... npm test
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : 'Define TEST_DATABASE_URL con una base desechable';

let server;
let baseUrl;
let pool;
const run = randomUUID().slice(0, 8);
const password = 'Clave-segura-123';

async function api(method, path, { token, body, institution, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (institution) headers['x-institution-id'] = institution;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const expectStatus = (response, status) => assert.equal(response.status, status, JSON.stringify(response.body));

describe('PreICFES Thor API', { skip }, () => {
  const state = {};

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    const { app } = await import('../src/app.js');
    ({ pool } = await import('../src/db/pool.js'));
    const argon2 = (await import('argon2')).default;
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Bootstrap del administrador directamente en la base, como en scripts/create-admin.js.
    state.adminEmail = `admin-${run}@test.local`;
    await pool.query(
      `INSERT INTO usuario (id_usuario, id_rol, nombres, apellidos, correo, contrasena_hash, estado, fecha_actualizacion)
       SELECT $1, id_rol, 'Admin', 'Prueba', $2, $3, 'ACTIVO', CURRENT_TIMESTAMP FROM rol WHERE codigo = 'ADMINISTRADOR'`,
      [randomUUID(), state.adminEmail, await argon2.hash(password)],
    );
  });

  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await pool?.end();
  });

  const login = async (correo) => {
    const response = await api('POST', '/api/v1/auth/login', { body: { correo, contrasena: password } });
    expectStatus(response, 200);
    return response.body.data;
  };

  test('salud y errores genéricos', async () => {
    expectStatus(await api('GET', '/health'), 200);
    const badJson = await api('POST', '/api/v1/auth/login', { raw: '{"correo":', body: null });
    expectStatus(badJson, 400);
    assert.equal(badJson.body.error.code, 'INVALID_JSON');
    expectStatus(await api('GET', '/api/v1/no-existe'), 404);
  });

  test('registro, activación y roles', async () => {
    const admin = await login(state.adminEmail);
    state.admin = admin.accessToken;
    state.adminRefresh = admin.refreshToken;

    for (const [key, rol] of [['teacher', 'PROFESOR'], ['manager', 'GESTOR_INSTITUCIONAL'], ['student', 'ESTUDIANTE']]) {
      const correo = `${key}-${run}@test.local`;
      const registered = await api('POST', '/api/v1/auth/register', { body: { nombres: key, apellidos: 'Prueba', correo, contrasena: password } });
      expectStatus(registered, 201);
      expectStatus(await api('POST', '/api/v1/auth/login', { body: { correo, contrasena: password } }), 401);
      expectStatus(await api('PATCH', `/api/v1/users/${registered.body.data.id}`, { token: state.admin, body: { estado: 'ACTIVO', rol } }), 200);
      state[`${key}Id`] = registered.body.data.id;
      state[`${key}Email`] = correo;
      state[key] = (await login(correo)).accessToken;
    }
    const duplicate = await api('POST', '/api/v1/auth/register', { body: { nombres: 'x', apellidos: 'y', correo: state.studentEmail.toUpperCase(), contrasena: password } });
    expectStatus(duplicate, 409);
    const extra = await api('POST', '/api/v1/auth/register', { body: { nombres: 'x', apellidos: 'y', correo: `x-${run}@t.local`, contrasena: password, rol: 'ADMINISTRADOR' } });
    expectStatus(extra, 400);
    expectStatus(await api('PATCH', `/api/v1/users/${state.studentId}`, { token: state.student, body: { estado: 'ACTIVO' } }), 403);
    expectStatus(await api('GET', '/api/v1/users/no-es-uuid', { token: state.admin }), 400);
  });

  test('foto de perfil y proveedores de inicio de sesión', async () => {
    const before = await login(state.studentEmail);
    assert.equal(before.user.fotoPerfilUrl, null);
    const foto = 'https://cdn.example.com/perfil.png';
    const updated = await api('PATCH', '/api/v1/users/me', { token: state.student, body: { fotoPerfilUrl: foto } });
    expectStatus(updated, 200);
    assert.equal(updated.body.data.fotoPerfilUrl, foto);
    expectStatus(await api('PATCH', '/api/v1/users/me', { token: state.student, body: { fotoPerfilUrl: 'ftp://x.com/a.png' } }), 400);
    expectStatus(await api('PATCH', '/api/v1/users/me', { token: state.student, body: { rol: 'ADMINISTRADOR' } }), 400);
    assert.equal((await api('GET', '/api/v1/auth/me', { token: state.student })).body.data.fotoPerfilUrl, foto);
    assert.equal((await login(state.studentEmail)).user.fotoPerfilUrl, foto);

    const providers = await api('GET', '/api/v1/auth/providers');
    expectStatus(providers, 200);
    const google = await api('POST', '/api/v1/auth/google', { body: { idToken: 'no-es-un-token' } });
    if (providers.body.data.google.habilitado) {
      expectStatus(google, 401);
      assert.equal(google.body.error.code, 'INVALID_GOOGLE_TOKEN');
    } else {
      expectStatus(google, 503);
      assert.equal(google.body.error.code, 'GOOGLE_NOT_CONFIGURED');
    }

    // Una cuenta creada con Google no tiene contraseña: no entra por /auth/login.
    const googleEmail = `google-${run}@test.local`;
    await pool.query(
      `INSERT INTO usuario (id_usuario, id_rol, nombres, apellidos, correo, google_sub, estado, fecha_actualizacion)
       SELECT $1, id_rol, 'Google', 'Prueba', $2, $3, 'ACTIVO', CURRENT_TIMESTAMP FROM rol WHERE codigo = 'ESTUDIANTE'`,
      [randomUUID(), googleEmail, `sub-${run}`],
    );
    expectStatus(await api('POST', '/api/v1/auth/login', { body: { correo: googleEmail, contrasena: password } }), 401);
  });

  test('rotación de refresh token y detección de reutilización', async () => {
    const first = await login(state.studentEmail);
    const rotated = await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: first.refreshToken } });
    expectStatus(rotated, 200);
    // Reutilizar el token viejo revoca todas las sesiones, incluida la nueva.
    expectStatus(await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: first.refreshToken } }), 401);
    expectStatus(await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: rotated.body.data.refreshToken } }), 401);
  });

  test('institución, miembros y solicitud pública', async () => {
    const request = await api('POST', '/api/v1/institution-requests', {
      body: { nombreInstitucion: `Colegio ${run}`, nombreResponsable: 'Rectora', cargo: 'Rectora', correoInstitucional: `rectoria-${run}@test.local`, telefono: '3000000000', ciudad: 'Montería', rangoEstudiantes: '100-500', aceptaPoliticaDatos: true },
    });
    expectStatus(request, 201);
    const approved = await api('PATCH', `/api/v1/institution-requests/${request.body.data.id}/review`, { token: state.admin, body: { estado: 'APROBADA' } });
    expectStatus(approved, 200);
    state.institution = approved.body.data.institucionId;
    expectStatus(await api('PATCH', `/api/v1/institution-requests/${request.body.data.id}/review`, { token: state.admin, body: { estado: 'RECHAZADA' } }), 409);

    expectStatus(await api('POST', `/api/v1/institutions/${state.institution}/members`, { token: state.admin, body: { correo: state.managerEmail, rol: 'GESTOR_INSTITUCIONAL' } }), 201);
    // El gestor vincula al profesor usando X-Institution-Id.
    const mismatch = await api('POST', `/api/v1/institutions/${state.institution}/members`, { token: state.manager, institution: state.institution, body: { correo: state.studentEmail, rol: 'PROFESOR' } });
    expectStatus(mismatch, 400);
    assert.equal(mismatch.body.error.code, 'ROLE_MISMATCH');
    expectStatus(await api('POST', `/api/v1/institutions/${state.institution}/members`, { token: state.manager, institution: state.institution, body: { correo: state.teacherEmail, rol: 'PROFESOR' } }), 201);
    expectStatus(await api('POST', `/api/v1/institutions/${state.institution}/members`, { token: state.manager, body: { correo: state.teacherEmail, rol: 'PROFESOR' } }), 403);
    const members = await api('GET', `/api/v1/institutions/${state.institution}/members`, { token: state.manager, institution: state.institution });
    expectStatus(members, 200);
    assert.equal(members.body.data.length, 2);
  });

  test('catálogos administrables', async () => {
    const catalogs = await api('GET', '/api/v1/catalogs');
    expectStatus(catalogs, 200);
    const math = catalogs.body.data.pruebas.find((prueba) => prueba.codigo === 'MATEMATICAS');
    state.math = math.id;
    state.tipo = catalogs.body.data.tiposPregunta[0].id;
    state.dificultad = catalogs.body.data.dificultades[0].id;
    state.modalidad = catalogs.body.data.modalidades.find((modalidad) => modalidad.codigo === 'RAPIDO').id;

    expectStatus(await api('POST', `/api/v1/catalogs/pruebas/${math.id}/competencias`, { token: state.teacher, body: { codigo: 'X', nombre: 'X' } }), 403);
    const competencia = await api('POST', `/api/v1/catalogs/pruebas/${math.id}/competencias`, { token: state.admin, body: { codigo: `C-${run}`, nombre: 'Razonamiento' } });
    expectStatus(competencia, 201);
    const afirmacion = await api('POST', `/api/v1/catalogs/competencias/${competencia.body.data.id}/afirmaciones`, { token: state.admin, body: { codigo: 'A1', descripcion: 'Afirmación' } });
    const evidencia = await api('POST', `/api/v1/catalogs/afirmaciones/${afirmacion.body.data.id}/evidencias`, { token: state.admin, body: { codigo: 'E1', descripcion: 'Evidencia' } });
    const tarea = await api('POST', `/api/v1/catalogs/evidencias/${evidencia.body.data.id}/tareas`, { token: state.admin, body: { codigo: 'T1', descripcion: 'Tarea' } });
    expectStatus(tarea, 201);
    state.tarea = tarea.body.data.id;
    const componente = await api('POST', `/api/v1/catalogs/pruebas/${math.id}/componentes`, { token: state.admin, body: { nombre: `Álgebra ${run}` } });
    const tema = await api('POST', `/api/v1/catalogs/componentes/${componente.body.data.id}/temas`, { token: state.admin, body: { nombre: 'Ecuaciones' } });
    expectStatus(tema, 201);
    state.tema = tema.body.data.id;
    const temas = await api('GET', `/api/v1/catalogs/componentes/${componente.body.data.id}/temas`);
    assert.equal(temas.body.data.length, 1);
  });

  test('contenido: recursos, estímulos, preguntas e importación', async () => {
    const media = await api('POST', '/api/v1/media', { token: state.teacher, body: { tipo: 'IMAGEN', url: 'https://cdn.example.com/grafica.png', nombreArchivo: 'grafica.png', mimeType: 'image/png' } });
    expectStatus(media, 201);
    expectStatus(await api('POST', '/api/v1/media', { token: state.teacher, body: { tipo: 'IMAGEN', url: 'https://x.com/a.pdf', nombreArchivo: 'a.pdf', mimeType: 'application/pdf' } }), 400);

    const stimulus = await api('POST', '/api/v1/stimuli', { token: state.teacher, body: { titulo: 'Texto base', contenido: 'Un tren sale a las 8...', recursos: [media.body.data.id] } });
    expectStatus(stimulus, 201);
    const question = (enunciado) => ({
      tipoPreguntaId: state.tipo, dificultadId: state.dificultad, tareaId: state.tarea, estimuloVersionId: stimulus.body.data.id,
      enunciado, explicacion: 'Porque sí', opciones: [{ letra: 'A', contenido: '2', orden: 1 }, { letra: 'B', contenido: '3', orden: 2 }],
      respuestaCorrecta: 'A', temas: [state.tema], recursos: [media.body.data.id],
    });
    const q1 = await api('POST', '/api/v1/questions', { token: state.teacher, body: question('¿1+1?') });
    expectStatus(q1, 201);
    // No se publica con el estímulo en borrador.
    expectStatus(await api('POST', `/api/v1/questions/${q1.body.data.versionId}/publish`, { token: state.teacher }), 400);
    expectStatus(await api('POST', `/api/v1/stimuli/${stimulus.body.data.id}/publish`, { token: state.teacher }), 200);
    expectStatus(await api('POST', `/api/v1/questions/${q1.body.data.versionId}/publish`, { token: state.teacher }), 200);
    expectStatus(await api('POST', '/api/v1/questions', { token: state.teacher, body: { ...question('x'), respuestaCorrecta: 'Z' } }), 400);

    const imported = await api('POST', '/api/v1/questions/import', {
      token: state.teacher,
      body: { nombreArchivo: 'banco.json', preguntas: [question('¿2+0?'), { enunciado: 'incompleta' }, { ...question('¿mala ref?'), temas: [randomUUID()] }] },
    });
    expectStatus(imported, 201);
    assert.equal(imported.body.data.estado, 'COMPLETADA_CON_ERRORES');
    assert.equal(imported.body.data.filasExitosas, 1);
    assert.equal(imported.body.data.filasFallidas, 2);
    const batch = await api('GET', `/api/v1/questions/imports/${imported.body.data.id}`, { token: state.teacher });
    assert.ok(batch.body.data.errores.some((error) => error.fila === 3 && error.codigo === 'INVALID_REFERENCE'));
    const q2 = imported.body.data.preguntas[0].versionId;
    expectStatus(await api('POST', `/api/v1/questions/${q2}/publish`, { token: state.teacher }), 200);

    // Nueva versión publicada archiva la anterior.
    const v2 = await api('POST', `/api/v1/questions/${q1.body.data.preguntaId}/versions`, { token: state.teacher, body: question('¿1+1? (v2)') });
    expectStatus(await api('POST', `/api/v1/questions/${v2.body.data.versionId}/publish`, { token: state.teacher }), 200);
    const old = await api('GET', `/api/v1/questions/${q1.body.data.versionId}`, { token: state.teacher });
    assert.equal(old.body.data.estado, 'ARCHIVADA');
    const detail = await api('GET', `/api/v1/questions/${v2.body.data.versionId}`, { token: state.teacher });
    assert.equal(detail.body.data.clave.letra, 'A');
    assert.equal(detail.body.data.recursos.length, 1);
    state.questions = [v2.body.data.versionId, q2];
  });

  test('plantilla y cuestionario', async () => {
    const template = await api('POST', '/api/v1/templates', { token: state.teacher, body: { modalidadId: state.modalidad, nombre: `Rápido ${run}`, sesiones: [{ pruebaId: state.math, numeroSesion: 1, cantidadPreguntas: 2, duracionMinutos: 30, orden: 1 }] } });
    expectStatus(template, 201);
    const questionnaire = await api('POST', '/api/v1/questionnaires', { token: state.teacher, body: { plantillaId: template.body.data.id, nombre: `Simulacro ${run}` } });
    expectStatus(questionnaire, 201);
    const id = questionnaire.body.data.id;
    expectStatus(await api('POST', `/api/v1/questionnaires/${id}/publish`, { token: state.teacher }), 400);
    const session = await api('POST', `/api/v1/questionnaires/${id}/sessions`, { token: state.teacher, body: { numeroSesion: 1, nombre: 'Sesión 1', duracionMinutos: 30, orden: 1 } });
    for (const [index, versionPreguntaId] of state.questions.entries()) {
      expectStatus(await api('POST', `/api/v1/questionnaires/${id}/sessions/${session.body.data.id}/items`, { token: state.teacher, body: { versionPreguntaId, orden: index + 1 } }), 201);
    }
    expectStatus(await api('POST', `/api/v1/questionnaires/${id}/publish`, { token: state.teacher }), 200);
    expectStatus(await api('POST', `/api/v1/questionnaires/${id}/sessions`, { token: state.teacher, body: { numeroSesion: 2, nombre: 'x', duracionMinutos: 1, orden: 2 } }), 409);
    state.questionnaire = id;
  });

  test('aula, invitación, matrícula y asignación', async () => {
    expectStatus(await api('POST', '/api/v1/classrooms', { token: state.teacher, body: { nombre: '11A' } }), 400);
    const classroom = await api('POST', '/api/v1/classrooms', { token: state.teacher, institution: state.institution, body: { nombre: '11A' } });
    expectStatus(classroom, 201);
    state.classroom = classroom.body.data.id;
    const invitation = await api('POST', `/api/v1/classrooms/${state.classroom}/invitations`, { token: state.teacher, body: { usosMaximos: 30 } });
    expectStatus(invitation, 201);
    expectStatus(await api('POST', '/api/v1/classrooms/enroll', { token: state.student, body: { codigo: invitation.body.data.codigo.toLowerCase() } }), 201);
    expectStatus(await api('POST', '/api/v1/classrooms/enroll', { token: state.student, body: { codigo: invitation.body.data.codigo } }), 409);

    const window = { fechaApertura: new Date(Date.now() - 60000).toISOString(), fechaCierre: new Date(Date.now() + 86400000).toISOString() };
    // Solo el profesor del aula puede asignar.
    expectStatus(await api('POST', `/api/v1/classrooms/${state.classroom}/assignments`, { token: state.admin, body: { cuestionarioId: state.questionnaire, ...window } }), 403);
    const assignment = await api('POST', `/api/v1/classrooms/${state.classroom}/assignments`, { token: state.teacher, body: { cuestionarioId: state.questionnaire, intentosPermitidos: 2, ...window } });
    expectStatus(assignment, 201);
    state.assignment = assignment.body.data.id;

    const mine = await api('GET', '/api/v1/classrooms/mine', { token: state.student });
    expectStatus(mine, 200);
    assert.equal(mine.body.data[0].asignaciones[0].estado, 'ABIERTA');
  });

  test('intento del estudiante, calificación y revisión docente', async () => {
    const started = await api('POST', `/api/v1/attempts/assignments/${state.assignment}`, { token: state.student });
    expectStatus(started, 201);
    const attemptId = started.body.data.id;
    const again = await api('POST', `/api/v1/attempts/assignments/${state.assignment}`, { token: state.student });
    expectStatus(again, 409);
    assert.equal(again.body.error.details.intentoId, attemptId);

    const attempt = await api('GET', `/api/v1/attempts/${attemptId}`, { token: state.student });
    expectStatus(attempt, 200);
    assert.ok(attempt.body.data.fechaLimite);
    const items = attempt.body.data.sesiones[0].items;
    assert.equal(items[0].estimulo.contenido, 'Un tren sale a las 8...');
    assert.ok(!JSON.stringify(attempt.body.data).includes('clave'), 'el estudiante no debe recibir claves');

    const optionA = (item) => item.opciones.find((option) => option.letra === 'A').id;
    const optionB = (item) => item.opciones.find((option) => option.letra === 'B').id;
    expectStatus(await api('PUT', `/api/v1/attempts/${attemptId}/answers/${items[0].id}`, { token: state.student, body: { opcionId: optionA(items[0]) } }), 200);
    expectStatus(await api('PUT', `/api/v1/attempts/${attemptId}/answers/${items[1].id}`, { token: state.student, body: { opcionId: optionB(items[1]) } }), 200);
    const foreign = await api('PUT', `/api/v1/attempts/${attemptId}/answers/${items[1].id}`, { token: state.student, body: { opcionId: optionA(items[0]) } });
    expectStatus(foreign, 400);

    const finished = await api('POST', `/api/v1/attempts/${attemptId}/finish`, { token: state.student });
    expectStatus(finished, 200);
    assert.equal(finished.body.data.estado, 'FINALIZADO');
    assert.equal(Number(finished.body.data.resultado.porcentaje), 50);

    const review = await api('GET', `/api/v1/attempts/${attemptId}/review`, { token: state.teacher });
    expectStatus(review, 200);
    assert.deepEqual(review.body.data.sesiones[0].items.map((item) => item.correcta), [true, false]);
    expectStatus(await api('GET', `/api/v1/attempts/${attemptId}/review`, { token: state.student }), 403);

    const results = await api('GET', `/api/v1/classrooms/${state.classroom}/results`, { token: state.teacher });
    assert.equal(results.body.data.length, 1);
    const progress = await api('GET', `/api/v1/institutions/${state.institution}/progress`, { token: state.manager, institution: state.institution });
    assert.equal(Number(progress.body.data[0].promedioPorcentaje), 50);
  });

  test('cerrar la asignación vence el intento en curso (y el cambio persiste)', async () => {
    const started = await api('POST', `/api/v1/attempts/assignments/${state.assignment}`, { token: state.student });
    expectStatus(started, 201);
    const attemptId = started.body.data.id;
    const attempt = await api('GET', `/api/v1/attempts/${attemptId}`, { token: state.student });
    const item = attempt.body.data.sesiones[0].items[0];
    expectStatus(await api('PATCH', `/api/v1/classrooms/${state.classroom}/assignments/${state.assignment}`, { token: state.teacher, body: { estado: 'CERRADA' } }), 200);
    const answer = await api('PUT', `/api/v1/attempts/${attemptId}/answers/${item.id}`, { token: state.student, body: { opcionId: item.opciones[0].id } });
    expectStatus(answer, 403);
    assert.equal(answer.body.error.code, 'ATTEMPT_EXPIRED');
    const after = await api('GET', `/api/v1/attempts/${attemptId}/result`, { token: state.student });
    assert.equal(after.body.data.estado, 'VENCIDO');
  });

  test('bitácora de auditoría', async () => {
    const entries = await api('GET', `/api/v1/audit?institutionId=${state.institution}`, { token: state.admin });
    expectStatus(entries, 200);
    const actions = new Set(entries.body.data.map((entry) => entry.accion));
    for (const action of ['CREAR_DESDE_SOLICITUD', 'VINCULAR', 'ACTUALIZAR']) assert.ok(actions.has(action), `falta ${action}`);
    expectStatus(await api('GET', '/api/v1/audit', { token: state.teacher }), 403);
  });
});
