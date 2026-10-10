<div align="center">

# ⚡ PreICFES Thor API

API REST para la preparación de las pruebas **Saber (ICFES)**: banco de preguntas versionado, cuestionarios, aulas, intentos cronometrados y analítica por institución.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![JWT](https://img.shields.io/badge/Auth-JWT%20%2B%20Google-F7B500?logo=jsonwebtokens&logoColor=white)

</div>

---

## Contenido

- [Descripción](#descripción)
- [Stack y estructura](#stack-y-estructura)
- [Arranque rápido con Docker](#arranque-rápido-con-docker)
- [Ejecución local](#ejecución-local)
- [Pruebas](#pruebas)
- [Documentación de uso](#documentación-de-uso)
- [Convenciones de API](#convenciones-de-api)
- [Roles](#roles)
- [🗺️ Mapa de rutas](#️-mapa-de-rutas)
- [Notas del esquema](#notas-del-esquema)

## Descripción

API en Node.js/Express conectada al esquema PostgreSQL existente en `SQL/preicfes.sql`. La base de datos es la fuente de verdad: tipos ENUM, triggers, vistas, claves foráneas e índices viven en PostgreSQL y no en la aplicación. No hay ORM ni herramienta de migraciones; el SQL se escribe a mano y siempre parametrizado.

## Stack y estructura

| Capa | Tecnología |
| --- | --- |
| Runtime | Node.js ≥ 20 (ES modules) |
| HTTP | Express 5, helmet, CORS, express-rate-limit |
| Validación | zod (cuerpos `.strict()`) |
| Base de datos | PostgreSQL 18 con `pg` |
| Autenticación | JWT de acceso + refresh token rotativo, Argon2, Google Identity Services |
| Pruebas | `node:test` (E2E) y colección Postman/Newman |

```text
src/
├── app.js              # Middlewares globales y montaje de /api/v1
├── server.js           # Arranque del servidor
├── config/env.js       # Validación del entorno con zod
├── db/                 # Pool, transacciones y fragmentos SQL reutilizables
├── middleware/         # Autenticación, roles, errores y rate limit
├── routes/             # Un Router por recurso (SQL + validación + DTOs)
├── utils/              # Respuestas HTTP y auditoría
└── docs/               # Guía HTML servida en /api/documentacion
SQL/                    # Dump del esquema, seed y migraciones manuales
scripts/create-admin.js # Crea o promueve el primer administrador
test/e2e.test.js        # Prueba de extremo a extremo
postman/                # Colección y entorno de Postman
```

## Arranque rápido con Docker

1. Copia `.env.example` a `.env` y establece `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (secretos aleatorios de al menos 32 caracteres).
2. Ejecuta `docker compose up --build`.
3. Verifica `http://localhost:3000/health`.
4. Crea el primer administrador:

   ```bash
   docker compose exec -e ADMIN_EMAIL=tu@correo -e ADMIN_PASSWORD='clave-de-12+-caracteres' api node scripts/create-admin.js
   ```

> [!NOTE]
> El init de Docker solo importa el dump al **crear el volumen por primera vez** (`docker compose down -v` para reimportar). Si tu base se creó antes de la foto de perfil / login con Google, aplica una vez la migración (es idempotente):
>
> ```bash
> docker compose exec -T db psql -U preicfes_app -d preicfes < SQL/migrations/001_perfil_y_google.sql
> # o en local: psql "$DATABASE_URL" -f SQL/migrations/001_perfil_y_google.sql
> ```

> [!WARNING]
> El dump trae un usuario de muestra con hash existente; el seed lo deja inactivo por seguridad. No reutilices ese hash ni datos personales del dump en producción.

## Ejecución local

- Requiere Node.js 20 o superior y PostgreSQL 18.
- `npm install`
- Crea la base de datos y el usuario definidos en `DATABASE_URL`, e importa `SQL/preicfes.sql` y luego `SQL/seed.sql` con `psql` (el dump contiene `\restrict` / `\unrestrict`, comandos propios de `psql`).
- Copia `.env.example` a `.env`, ajusta credenciales y ejecuta `npm run dev`.
- `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin` crea o promueve un administrador activo.

## Pruebas

| Comando | Qué hace |
| --- | --- |
| `npm run check` | Verificación de sintaxis de todo el código. |
| `npm test` | Prueba E2E (`test/e2e.test.js`): registro, institución, catálogos, contenido, cuestionario, aula, intento, calificación y auditoría. |

`npm test` **escribe datos**, por eso solo corre si `TEST_DATABASE_URL` apunta a una base desechable con el dump cargado; sin esa variable se omite. Ejemplo con un contenedor temporal:

```bash
docker run -d --name thor_testdb -e POSTGRES_DB=preicfes -e POSTGRES_USER=preicfes_app -e POSTGRES_PASSWORD=test \
  -p 127.0.0.1:55432:5432 -v "$PWD/SQL/preicfes.sql:/docker-entrypoint-initdb.d/10.sql:ro" \
  -v "$PWD/SQL/seed.sql:/docker-entrypoint-initdb.d/20.sql:ro" postgres:18-alpine
TEST_DATABASE_URL=postgresql://preicfes_app:test@127.0.0.1:55432/preicfes npm test
```

**Postman:** importa `postman/PreICFES-Thor.postman_collection.json` y el entorno `postman/PreICFES-Thor.local.postman_environment.json`, define `baseUrl`, `adminEmail` y `adminPassword` (un admin creado con `create-admin`) y ejecuta la colección con el Collection Runner. Recorre el mismo flujo que la prueba E2E (116 peticiones con aserciones) encadenando los ids en variables de colección. También **escribe datos**; cada corrida usa un sufijo propio, así que se puede repetir sobre la misma base, pero consume 17 de las 20 peticiones sensibles permitidas cada 15 minutos (sin límite con `NODE_ENV=test`). Por consola:

```bash
npx newman run postman/PreICFES-Thor.postman_collection.json \
  -e postman/PreICFES-Thor.local.postman_environment.json --env-var adminPassword=...
```

## Documentación de uso

Con la API en marcha, abre `/api/documentacion` (por ejemplo `http://localhost:3000/api/documentacion`): guía HTML con autenticación, formato de errores, roles, flujos típicos y referencia de todos los endpoints con ejemplos. El archivo fuente está en `src/docs/index.html`; actualízalo al agregar o cambiar rutas.

## Convenciones de API

- **Base:** `/api/v1`. Éxito: `{ "data": ... }`. Error: `{ "error": { "code", "message", "details?" } }`. Los mensajes internos de PostgreSQL y de los triggers nunca llegan al cliente; las violaciones de reglas de negocio responden `422 BUSINESS_RULE`.
- **Autenticación:** `Authorization: Bearer <accessToken>` (15 min por defecto). El refresh token rota en cada uso; reutilizar uno ya rotado revoca todas las sesiones del usuario.
- **Contexto institucional:** las rutas institucionales usan `X-Institution-Id`. La API verifica la vinculación activa en la base; si no existe, el encabezado se ignora.
- **Datos del servidor:** UUID, rol de registro inicial, usuario creador, marcas de tiempo y totales los asigna la API; nunca se aceptan del cliente. Los cuerpos rechazan campos extra y los identificadores de ruta deben ser UUID.
- **Seguridad del contenido:** las claves de respuesta nunca se incluyen en payloads para estudiantes.
- **Límites:** listas con `?limit=50` (máx. 100). 300 solicitudes / 15 min por IP y 20 / 15 min en login, registro, refresco, Google, cambio de contraseña y solicitud institucional. Detrás de un proxy define `TRUST_PROXY`.
- **Auditoría:** las operaciones administrativas relevantes se registran en `auditoria` dentro de la misma transacción.

## Roles

| Rol | Alcance |
| --- | --- |
| `ADMINISTRADOR` | Toda la plataforma: usuarios, catálogos, instituciones, solicitudes, auditoría. |
| `GESTOR_INSTITUCIONAL` | Con `X-Institution-Id`: miembros (profesores), aulas y progreso de su institución. |
| `PROFESOR` | Banco de preguntas/estímulos, plantillas, cuestionarios, sus aulas y asignaciones. |
| `ESTUDIANTE` | Matricularse con código, presentar intentos libres o asignados, ver sus resultados. |

Registrarse crea una cuenta `PENDIENTE` con rol `ESTUDIANTE`; un administrador la activa y, si corresponde, cambia su rol. Profesores y gestores además se vinculan a una institución. Un permiso se concede si coincide el rol global **o** el rol institucional.

## 🗺️ Mapa de rutas

Todas las rutas cuelgan de `/api/v1`, salvo `GET /health` y `GET /api/documentacion`.

```mermaid
flowchart LR
    API(["/api/v1"])

    API --> AUTH["/auth<br/>sesión y Google"]
    API --> USERS["/users<br/>perfil y administración"]
    API --> CAT["/catalogs<br/>jerarquía ICFES"]

    API --> INST_REQ["/institution-requests<br/>solicitudes"]
    API --> INST["/institutions<br/>miembros y progreso"]

    API --> MEDIA["/media<br/>recursos"]
    API --> STIM["/stimuli<br/>estímulos versionados"]
    API --> QUES["/questions<br/>preguntas versionadas"]
    API --> TPL["/templates<br/>plantillas"]
    API --> QNR["/questionnaires<br/>sesiones e ítems"]

    API --> CLS["/classrooms<br/>aulas, invitaciones, asignaciones"]
    API --> ATT["/attempts<br/>intentos y resultados"]
    API --> AUD["/audit<br/>bitácora"]

    INST_REQ -. aprobar crea .-> INST
    STIM -. se asocia a .-> QUES
    QUES -. ítems de .-> QNR
    TPL -. estructura .-> QNR
    QNR -. se asigna en .-> CLS
    CLS -. intento asignado .-> ATT
    QNR -. intento libre .-> ATT
```

**Leyenda de acceso:** 🌐 público · 🔐 cualquier usuario autenticado · `ADM` administrador · `GES` gestor institucional · `PROF` profesor · `EST` estudiante.

<details open>
<summary><b>🔐 Sesión — <code>/auth</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | 🌐 | `{ nombres, apellidos, correo, contrasena }`. Crea cuenta `ESTUDIANTE` `PENDIENTE`. |
| `POST` | `/auth/login` | 🌐 | `{ correo, contrasena }`. Devuelve tokens y `user`. |
| `POST` | `/auth/refresh` | 🌐 | `{ refreshToken }`. Rota el token. |
| `POST` | `/auth/logout` | 🌐 | `{ refreshToken }`. Revoca la sesión. |
| `GET` | `/auth/me` | 🔐 | Usuario actual. |
| `POST` | `/auth/change-password` | 🔐 | `{ contrasenaActual, contrasenaNueva }`. Revoca todas las sesiones; `409 PASSWORD_NOT_SET` en cuentas de Google. |
| `GET` | `/auth/providers` | 🌐 | `{ contrasena: true, google: { habilitado, clientId } }`. |
| `POST` | `/auth/google` | 🌐 | `{ idToken }`. Login o registro con Google. |

Login, refresh y `/auth/me` incluyen `user.fotoPerfilUrl` (o `null`).

**Google:** `POST /auth/google` recibe el `credential` del botón de Google Identity Services y lo verifica con `google-auth-library` contra `GOOGLE_CLIENT_ID` (exige correo verificado).

- Correo nuevo: crea una cuenta `ESTUDIANTE` `PENDIENTE` sin contraseña y con la foto de Google (`201`).
- Correo existente: vincula la cuenta (`usuario.google_sub`, auditado como `VINCULAR_GOOGLE`) sin pisar su foto propia.
- Errores: `401 INVALID_GOOGLE_TOKEN`, `403 ACCOUNT_NOT_ACTIVE` (con `details.estado`), `409 GOOGLE_ACCOUNT_MISMATCH`, `503 GOOGLE_NOT_CONFIGURED`.
- Configuración: crea un ID de cliente OAuth tipo *Aplicación web* en Google Cloud Console, agrega el origen del frontend en *Orígenes de JavaScript autorizados* y define `GOOGLE_CLIENT_ID` en `.env`. La guía `/api/documentacion` incluye el código del botón.

</details>

<details>
<summary><b>👤 Usuarios — <code>/users</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/users/me/institutions` | 🔐 | Instituciones y roles vinculados. |
| `PATCH` | `/users/me` | 🔐 | `{ nombres?, apellidos?, fotoPerfilUrl? }`. La foto es una URL http(s); `null` la quita. |
| `GET` | `/users?q=&estado=&rol=&offset=` | `ADM` | Listado con filtros. |
| `GET` | `/users/:id` | `ADM` | Detalle. |
| `PATCH` | `/users/:id` | `ADM` | `{ estado?, rol?, correoVerificado? }`. Desactivar o cambiar rol revoca sesiones; un admin no puede bloquearse a sí mismo. |

</details>

<details>
<summary><b>📚 Catálogos — <code>/catalogs</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/catalogs` | 🌐 | Pruebas, tipos de pregunta, dificultades, modalidades y servicios. |
| `GET` | `/catalogs/{padre}/:id/{nivel}` | 🌐 | Hijos de un nivel. `?incluirInactivos=true` incluye inactivos. |
| `POST` | `/catalogs/{padre}/:id/{nivel}` | `ADM` | Crea un elemento bajo su padre. |
| `PATCH` | `/catalogs/{nivel}/:id` | `ADM` | Edita campos o `activo`. |

Jerarquía ICFES:

```text
pruebas ─┬─► competencias ─► afirmaciones ─► evidencias ─► tareas
         └─► componentes  ─► temas
```

Ejemplo: `GET /catalogs/pruebas/:id/competencias`, `POST /catalogs/afirmaciones/:id/evidencias`, `PATCH /catalogs/temas/:id`.

</details>

<details>
<summary><b>🏫 Instituciones — <code>/institution-requests</code>, <code>/institutions</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `POST` | `/institution-requests` | 🌐 | Solicitud de alta. `servicios: [uuid]`, `aceptaPoliticaDatos: true`. |
| `GET` | `/institution-requests?estado=` | `ADM` | Listado. |
| `GET` | `/institution-requests/:id` | `ADM` | Detalle. |
| `PATCH` | `/institution-requests/:id/review` | `ADM` | Aprobar crea la institución en la misma transacción; una aprobada no cambia de estado. |
| `GET` | `/institutions` | 🔐 | Instituciones visibles para el usuario. |
| `POST` | `/institutions` | `ADM` | Crea institución. |
| `GET` | `/institutions/:id` | 🔐 | Detalle. |
| `PATCH` | `/institutions/:id` | `ADM` `GES` | Edita datos; solo admin cambia `estado`. |
| `GET` | `/institutions/:id/progress` | 🔐 | Progreso por aula (un profesor solo ve sus aulas). |
| `GET` | `/institutions/:id/members` | `ADM` `GES` | Miembros. |
| `POST` | `/institutions/:id/members` | `ADM` `GES` | `{ correo, rol }`. El gestor solo vincula profesores; el rol global debe coincidir. |
| `PATCH` | `/institutions/:id/members/:memberId` | `ADM` `GES` | `{ estado }`. |

</details>

<details>
<summary><b>🖼️ Recursos — <code>/media</code></b></summary>

Solo metadatos; el binario vive en un almacenamiento privado que entrega la URL.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/media` | `ADM` `PROF` | Listado. |
| `POST` | `/media` | `ADM` `PROF` | Registra un recurso. |
| `GET` | `/media/:id` | `ADM` `PROF` | Detalle. |
| `DELETE` | `/media/:id` | `ADM` `PROF` | Elimina (no si está en uso). |
| `GET` | `/media/sources` | `ADM` `PROF` | Fuentes. |
| `POST` | `/media/sources` | `ADM` `PROF` | Crea fuente. |

</details>

<details>
<summary><b>🧩 Estímulos — <code>/stimuli</code></b></summary>

Ciclo de vida: `BORRADOR → PUBLICADA → ARCHIVADA`. Las rutas usan el id de **versión**, salvo `/versions`, que usa el id del estímulo padre.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/stimuli` | `ADM` `PROF` `GES` | Listado. |
| `POST` | `/stimuli` | `ADM` `PROF` | Crea estímulo con su primera versión. |
| `GET` | `/stimuli/:versionId` | `ADM` `PROF` `GES` | Detalle de una versión. |
| `POST` | `/stimuli/:estimuloId/versions` | `ADM` `PROF` | Nueva versión. |
| `POST` | `/stimuli/:versionId/publish` | `ADM` `PROF` | Publica. |
| `POST` | `/stimuli/:versionId/archive` | `ADM` `PROF` | Archiva. |

</details>

<details>
<summary><b>❓ Preguntas — <code>/questions</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/questions?q=&estado=&preguntaId=&temaId=&tareaId=&dificultadId=` | `ADM` `PROF` `GES` | Listado con filtros. |
| `POST` | `/questions` | `ADM` `PROF` | Crea pregunta en borrador. |
| `GET` | `/questions/:versionId` | `ADM` `PROF` `GES` | Detalle con opciones y clave. |
| `POST` | `/questions/:preguntaId/versions` | `ADM` `PROF` | Nueva versión. |
| `POST` | `/questions/:versionId/publish` | `ADM` `PROF` | Requiere clave, ≥ 2 opciones y estímulo publicado; archiva la versión publicada anterior. |
| `POST` | `/questions/:versionId/archive` | `ADM` `PROF` | Archiva. |
| `POST` | `/questions/import` | `ADM` `PROF` | `{ nombreArchivo, preguntas: [...] }` (hasta 200). Las filas válidas se crean en borrador; las inválidas quedan registradas en el lote. |
| `GET` | `/questions/imports` | `ADM` `PROF` | Lotes de importación. |
| `GET` | `/questions/imports/:id` | `ADM` `PROF` | Lote con errores por fila. |

</details>

<details>
<summary><b>📐 Plantillas — <code>/templates</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/templates/modalities` | 🔐 | Modalidades disponibles. |
| `GET` | `/templates` | 🔐 | Listado. |
| `POST` | `/templates` | `ADM` `PROF` | Crea plantilla. |
| `GET` | `/templates/:id` | 🔐 | Detalle. |
| `PATCH` | `/templates/:id` | `ADM` `PROF` | Edita; solo admin marca `oficial`. |

</details>

<details>
<summary><b>📝 Cuestionarios — <code>/questionnaires</code></b></summary>

Un cuestionario contiene **sesiones**, y cada sesión contiene **ítems** (versiones de pregunta).

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/questionnaires` | 🔐 | Listado según rol. |
| `POST` | `/questionnaires` | `ADM` `PROF` | Crea en borrador. |
| `GET` | `/questionnaires/:id` | 🔐 | Detalle con sesiones e ítems. |
| `PATCH` | `/questionnaires/:id` | `ADM` `PROF` | Renombrar en borrador o `estado: ARCHIVADO` (cierra sus asignaciones). |
| `POST` | `/questionnaires/:id/sessions` | `ADM` `PROF` | Agrega sesión. |
| `DELETE` | `/questionnaires/:id/sessions/:sessionId` | `ADM` `PROF` | Quita sesión. |
| `POST` | `/questionnaires/:id/sessions/:sessionId/items` | `ADM` `PROF` | Agrega ítem. |
| `DELETE` | `/questionnaires/:id/sessions/:sessionId/items/:itemId` | `ADM` `PROF` | Quita ítem. |
| `POST` | `/questionnaires/:id/publish` | `ADM` `PROF` | Publica. |

</details>

<details>
<summary><b>🧑‍🏫 Aulas — <code>/classrooms</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/classrooms?estado=&institucionId=` | `ADM` `GES` `PROF` | Listado. |
| `POST` | `/classrooms` | `PROF` | Crea aula (requiere `X-Institution-Id`). |
| `GET` | `/classrooms/:id` | `ADM` `GES` `PROF` | Detalle. |
| `PATCH` | `/classrooms/:id` | `ADM` `GES` `PROF` | Edita. |
| `GET` | `/classrooms/:id/students` | `ADM` `GES` `PROF` | Matriculados. |
| `PATCH` | `/classrooms/:id/students/:enrollmentId` | `ADM` `GES` `PROF` | `{ estado: ACTIVA \| RETIRADA \| BLOQUEADA }`. |
| `GET` | `/classrooms/:id/invitations` | `ADM` `GES` `PROF` | Códigos de invitación. |
| `POST` | `/classrooms/:id/invitations` | `ADM` `GES` `PROF` | Genera código (no distingue mayúsculas). |
| `PATCH` | `/classrooms/:id/invitations/:invitationId` | `ADM` `GES` `PROF` | `{ activa }`. |
| `GET` | `/classrooms/:id/assignments` | `ADM` `GES` `PROF` | Asignaciones; el `estado` se calcula con las fechas. |
| `POST` | `/classrooms/:id/assignments` | `PROF` | Solo el profesor del aula. |
| `PATCH` | `/classrooms/:id/assignments/:assignmentId` | `PROF` | `{ fechaCierre?, intentosPermitidos?, estado?: CERRADA \| CANCELADA }`. |
| `GET` | `/classrooms/:id/results?asignacionId=` | `ADM` `GES` `PROF` | Resultados del aula. |
| `GET` | `/classrooms/mine` | `EST` | Aulas con asignaciones e intentos usados. |
| `POST` | `/classrooms/enroll` | `EST` | `{ codigo }`. Matrícula por código. |

</details>

<details>
<summary><b>⏱️ Intentos — <code>/attempts</code></b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/attempts` | `EST` | Mis intentos. |
| `POST` | `/attempts/free` | `EST` | `{ cuestionarioId }`. Intento libre. |
| `POST` | `/attempts/assignments/:assignmentId` | `EST` | Intento de una asignación. |
| `GET` | `/attempts/:id` | `EST` | Intento con preguntas (sin claves). |
| `PUT` | `/attempts/:id/answers/:itemId` | `EST` | `{ opcionId?, texto?, tiempoSegundos? }`. Guarda respuesta. |
| `POST` | `/attempts/:id/finish` | `EST` | Finaliza y califica. |
| `GET` | `/attempts/:id/result` | `EST` | Resultado. |
| `GET` | `/attempts/:id/review` | `ADM` `PROF` `GES` | Revisión con clave, explicación y acierto por ítem (profesor del aula o gestor de la institución). |

- Solo puede haber un intento en progreso por cuestionario/asignación (`409 ATTEMPT_IN_PROGRESS` devuelve su `intentoId`).
- `fechaLimite` = inicio + suma de `duracionMinutos` de las sesiones (con 1 minuto de margen). Pasado ese límite, o cerrada la asignación, el intento pasa a `VENCIDO`; las respuestas ya guardadas se califican.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> EN_PROGRESO: POST /attempts/free<br/>POST /attempts/assignments/:id
    EN_PROGRESO --> EN_PROGRESO: PUT /answers/:itemId
    EN_PROGRESO --> FINALIZADO: POST /finish
    EN_PROGRESO --> VENCIDO: fecha límite o<br/>cierre de asignación
    FINALIZADO --> [*]
    VENCIDO --> [*]
```

</details>

<details>
<summary><b>🧾 Auditoría y sistema</b></summary>

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| `GET` | `/audit?institutionId=&entity=&entityId=&userId=&offset=` | `ADM` | Bitácora de operaciones. |
| `GET` | `/health` | 🌐 | Estado de la API y la base (fuera de `/api/v1`). |
| `GET` | `/api/documentacion` | 🌐 | Guía HTML (fuera de `/api/v1`). |

</details>

## Notas del esquema

- El dump trae tablas de contenido vacías, roles/catálogos ICFES, modalidades y tipos básicos; `seed.sql` agrega servicios.
- `usuario` guarda la foto de perfil en `foto_perfil_url` y la cuenta de Google en `google_sub` (única). `contrasena_hash` admite `NULL` para cuentas solo-Google y un `CHECK` exige al menos uno de los dos.
- `fecha_actualizacion` no tiene default en varias tablas; la API la completa explícitamente.
- PostgreSQL impone reglas adicionales mediante triggers: el profesor de un aula debe estar vinculado a la institución, solo estudiantes activos se matriculan y solo el profesor del aula crea asignaciones.
