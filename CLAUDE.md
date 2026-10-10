# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

PreICFES Thor API: a REST API (Node.js ≥20, Express 5, ES modules) over an **existing** PostgreSQL 18 schema (`SQL/preicfes.sql`). The database is the source of truth: ENUMs, triggers, views, FKs and indexes live there, not in the app. There is no ORM and no migration tool. Schema changes mean editing the SQL dump. Identifiers, routes, error messages and the README are in Spanish; keep new code consistent with that. README.md has the full route list.

## Commands

- `npm install`, then `npm run dev` (runs `node --watch src/server.js`, needs `.env` copied from `.env.example`)
- `npm run check`: `node --check` on every file in `src/`, `scripts/` and `test/`. There is no linter.
- `npm test`: runs the end-to-end suite in `test/e2e.test.js` with `node:test`. It only runs when `TEST_DATABASE_URL` points to a **disposable** database loaded with the dump, because it writes data. Without that variable the suite is skipped. The tests run in order and share state, so filter by name only for read-only checks, e.g. `node --test --test-name-pattern="salud" test/`. A throwaway DB setup is described in the README.
- `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin`: bootstraps or promotes an active admin. This is the only way to create the first admin.
- `docker compose up --build`: starts Postgres 18 and the API. The SQL files in `SQL/` are mounted as init scripts, so they run **only when the `postgres_data` volume is first created**.
- Manual DB import: load `SQL/preicfes.sql` then `SQL/seed.sql` with `psql`. The dump contains `\restrict`, a psql meta-command.

## Architecture

- `src/app.js` sets up the middleware stack: helmet, CORS, 1 MB JSON, `trust proxy` from `TRUST_PROXY`, and the global rate limiter. It mounts `routes/index.js` under `/api/v1`. `src/config/env.js` validates the environment with zod.
- `src/db/pool.js` exports `query()` and `transaction(async (client) => ...)`. Inside a transaction always use `client.query`.
- `src/db/fragments.js` holds `studentQuestionContent`, the SQL for the options, stimulus and media a student sees. It never includes the answer key. Reuse it wherever question content reaches students.
- Each `src/routes/*.js` file is one self-contained Router per resource. There is no service layer. Raw parameterized SQL, zod schemas and row→DTO mappers live in the route file. `catalogs.js` generates the GET/POST/PATCH routes for each ICFES catalog level from a `levels` table.

### Conventions

- Wrap handlers in `asyncHandler`. Respond with `sendData(res, data, status)`. Fail by throwing `new HttpError(status, message, CODE, details)`.
- Validate request bodies with `z.object({...}).strict()` and `safeParse`. On failure throw `HttpError(400, …, 'VALIDATION_ERROR', parsed.error.flatten())`.
- Call `requireUuidParams(router, 'id', ...)` once per router to make path params like `:id` 400 on non-UUIDs. Validate UUID query filters with `isUuid`.
- `middleware/errors.js` maps PG SQLSTATEs to client errors. Trigger `RAISE EXCEPTION` (P0001) becomes 422 `BUSINESS_RULE`. Raw DB or trigger messages are never sent to clients. Prefer pre-checking business rules in the route so the client gets a precise error code.
- The server sets UUIDs, the creator, timestamps and totals. Many tables have no default for `fecha_actualizacion`, so set it explicitly; a missing value fails the NOT NULL constraint.
- A transaction that must persist a state change and also report an error, such as expiring an attempt, should return a flag and throw *after* `transaction()` resolves. Throwing inside rolls the change back.
- Admin-relevant mutations call `audit(client, req, {...})` from `utils/audit.js` inside the same transaction.
- Inside the DB, compare times with `CURRENT_TIMESTAMP`, not JS `Date`.
- Never send answer keys to students. `GET /attempts/:id/review` is the only place keys appear next to student answers, and it is restricted to staff.

### Auth model

- Access JWTs are short-lived. `authenticate` reloads the user on every request and rejects users who are not `ACTIVO`.
- Refresh tokens rotate on use and are stored as SHA-256 hashes in `sesion_refresco`. Reusing a rotated token revokes all of that user's sessions.
- `POST /auth/google` verifies a Google ID token against `GOOGLE_CLIENT_ID` (unset = 503). It links accounts by verified email via `usuario.google_sub`; new emails become PENDIENTE students. Google-only users have a NULL `contrasena_hash`. Login, refresh and `/auth/me` return `fotoPerfilUrl`.
- Roles come from two sources:
  - The global role is `usuario.id_rol`.
  - The institutional role is resolved from the `X-Institution-Id` header via an active `usuario_institucion` row in an active institution. `req.user.idInstitucion` is null unless that membership is verified.
- `authorize(...roles)` passes if **either** role matches. Role codes: `ADMINISTRADOR`, `GESTOR_INSTITUCIONAL`, `PROFESOR`, `ESTUDIANTE`.
- DB triggers add constraints. Only users whose global role is PROFESOR or GESTOR can be linked to an institution. A classroom's teacher must be a linked PROFESOR. Only the classroom's teacher can create assignments. Only active students can enroll.

### Domain notes

- Questions and stimuli are versioned: `pregunta` → `version_pregunta` and `estimulo` → `version_estimulo`. The lifecycle is BORRADOR → PUBLICADA → ARCHIVADA.
  - Routes take the *version* id, except `POST /:id/versions`, which takes the parent id.
  - Publishing a question version archives that question's previously published version.
- Questionnaires contain sessions, and sessions contain items. An attempt is either free (`intento_libre`) or assigned (`intento_asignado`). `vista_origen_intento` unifies the two. It contains a UNION, so `FOR UPDATE` can't be used on queries joining it; lock `intento` separately.
- An attempt's deadline is its start time plus the sum of its session durations, with a 1-minute grace period. It also expires when its assignment closes. Results come from the views `vista_resultado_intento`, `vista_resultado_aula` and `vista_progreso_institucion`.
