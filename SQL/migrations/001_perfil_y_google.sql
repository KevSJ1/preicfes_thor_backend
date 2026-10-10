-- Foto de perfil e inicio de sesión con Google en la tabla usuario.
-- SQL/preicfes.sql ya incluye estos cambios; este script es solo para bases creadas antes con el dump anterior.
-- Es idempotente: puede ejecutarse varias veces.
--   psql "$DATABASE_URL" -f SQL/migrations/001_perfil_y_google.sql
--   docker compose exec -T db psql -U preicfes_app -d preicfes < SQL/migrations/001_perfil_y_google.sql

BEGIN;

ALTER TABLE public.usuario ADD COLUMN IF NOT EXISTS foto_perfil_url character varying(1000);
ALTER TABLE public.usuario ADD COLUMN IF NOT EXISTS google_sub character varying(255);
-- Las cuentas creadas con Google no tienen contraseña local.
ALTER TABLE public.usuario ALTER COLUMN contrasena_hash DROP NOT NULL;

ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_credencial_check;
ALTER TABLE public.usuario ADD CONSTRAINT usuario_credencial_check CHECK (((contrasena_hash IS NOT NULL) OR (google_sub IS NOT NULL)));
ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_foto_perfil_url_check;
ALTER TABLE public.usuario ADD CONSTRAINT usuario_foto_perfil_url_check CHECK (((foto_perfil_url IS NULL) OR ((foto_perfil_url)::text ~* '^https?://'::text)));

CREATE UNIQUE INDEX IF NOT EXISTS usuario_google_sub_key ON public.usuario USING btree (google_sub) WHERE (google_sub IS NOT NULL);

COMMIT;
