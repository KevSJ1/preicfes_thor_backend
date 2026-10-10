--
-- PostgreSQL database dump
--

\restrict DMMAktfoX6lVeqKtsGfQkVR5GVhHuknE9OZyTEPNAEVcVEHvWqlihuprAaLiEWe

-- Dumped from database version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: estado_asignacion; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_asignacion AS ENUM (
    'PROGRAMADA',
    'ABIERTA',
    'CERRADA',
    'CANCELADA'
);


ALTER TYPE public.estado_asignacion OWNER TO preicfes_app;

--
-- Name: estado_aula; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_aula AS ENUM (
    'ACTIVA',
    'ARCHIVADA',
    'INACTIVA'
);


ALTER TYPE public.estado_aula OWNER TO preicfes_app;

--
-- Name: estado_cuestionario; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_cuestionario AS ENUM (
    'BORRADOR',
    'PUBLICADO',
    'ARCHIVADO'
);


ALTER TYPE public.estado_cuestionario OWNER TO preicfes_app;

--
-- Name: estado_importacion; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_importacion AS ENUM (
    'PENDIENTE',
    'PROCESANDO',
    'COMPLETADA',
    'COMPLETADA_CON_ERRORES',
    'FALLIDA'
);


ALTER TYPE public.estado_importacion OWNER TO preicfes_app;

--
-- Name: estado_institucion; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_institucion AS ENUM (
    'ACTIVA',
    'INACTIVA',
    'BLOQUEADA'
);


ALTER TYPE public.estado_institucion OWNER TO preicfes_app;

--
-- Name: estado_intento; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_intento AS ENUM (
    'EN_PROGRESO',
    'FINALIZADO',
    'VENCIDO',
    'CANCELADO'
);


ALTER TYPE public.estado_intento OWNER TO preicfes_app;

--
-- Name: estado_matricula; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_matricula AS ENUM (
    'ACTIVA',
    'RETIRADA',
    'BLOQUEADA'
);


ALTER TYPE public.estado_matricula OWNER TO preicfes_app;

--
-- Name: estado_pregunta; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_pregunta AS ENUM (
    'BORRADOR',
    'PUBLICADA',
    'ARCHIVADA'
);


ALTER TYPE public.estado_pregunta OWNER TO preicfes_app;

--
-- Name: estado_solicitud_institucional; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_solicitud_institucional AS ENUM (
    'PENDIENTE',
    'EN_REVISION',
    'CONTACTADA',
    'APROBADA',
    'RECHAZADA'
);


ALTER TYPE public.estado_solicitud_institucional OWNER TO preicfes_app;

--
-- Name: estado_usuario; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_usuario AS ENUM (
    'PENDIENTE',
    'ACTIVO',
    'BLOQUEADO',
    'INACTIVO'
);


ALTER TYPE public.estado_usuario OWNER TO preicfes_app;

--
-- Name: estado_vinculacion; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.estado_vinculacion AS ENUM (
    'ACTIVA',
    'INACTIVA',
    'RETIRADA'
);


ALTER TYPE public.estado_vinculacion OWNER TO preicfes_app;

--
-- Name: tipo_fuente; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.tipo_fuente AS ENUM (
    'PROPIA',
    'ICFES',
    'LIBRO',
    'OTRO'
);


ALTER TYPE public.tipo_fuente OWNER TO preicfes_app;

--
-- Name: tipo_recurso; Type: TYPE; Schema: public; Owner: preicfes_app
--

CREATE TYPE public.tipo_recurso AS ENUM (
    'IMAGEN',
    'AUDIO',
    'VIDEO',
    'DOCUMENTO'
);


ALTER TYPE public.tipo_recurso OWNER TO preicfes_app;

--
-- Name: fn_validar_clave_respuesta(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_clave_respuesta() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "version_pregunta" vp
    JOIN "opcion_respuesta" op
      ON op."id_opcion" = NEW."id_opcion"
     AND op."id_conjunto_opciones" = vp."id_conjunto_opciones"
    WHERE vp."id_version_pregunta" = NEW."id_version_pregunta"
  ) THEN
    RAISE EXCEPTION
      'La respuesta correcta debe pertenecer al conjunto de opciones de la pregunta';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_validar_clave_respuesta() OWNER TO preicfes_app;

--
-- Name: fn_validar_creador_asignacion(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_creador_asignacion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "aula" a
    WHERE a."id_aula" = NEW."id_aula"
      AND a."id_profesor" = NEW."id_creada_por"
      AND a."estado" = 'ACTIVA'
  ) THEN
    RAISE EXCEPTION 'La asignación debe ser creada por el profesor del aula activa';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_validar_creador_asignacion() OWNER TO preicfes_app;

--
-- Name: fn_validar_estudiante_matricula(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_estudiante_matricula() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "usuario" u
    JOIN "rol" r ON r."id_rol" = u."id_rol"
    WHERE u."id_usuario" = NEW."id_estudiante"
      AND u."estado" = 'ACTIVO'
      AND r."codigo" = 'ESTUDIANTE'
  ) THEN
    RAISE EXCEPTION 'La matrícula requiere un estudiante activo';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_validar_estudiante_matricula() OWNER TO preicfes_app;

--
-- Name: fn_validar_opcion_respuesta_intento(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_opcion_respuesta_intento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id_cuestionario uuid;
BEGIN
  /*
   * El item respondido debe pertenecer al mismo cuestionario del intento.
   * Se determina el cuestionario desde la especialización del intento,
   * evitando almacenar una segunda copia de id_cuestionario en respuesta_intento.
   */
  SELECT x.id_cuestionario
    INTO v_id_cuestionario
  FROM (
    SELECT ia.id_intento, aa.id_cuestionario
    FROM "intento_asignado" ia
    JOIN "asignacion_aula" aa
      ON aa.id_asignacion = ia.id_asignacion
    WHERE ia.id_intento = NEW.id_intento

    UNION ALL

    SELECT il.id_intento, il.id_cuestionario
    FROM "intento_libre" il
    WHERE il.id_intento = NEW.id_intento
  ) x
  LIMIT 1;

  IF v_id_cuestionario IS NULL THEN
    RAISE EXCEPTION
      'El intento % no tiene un tipo válido (libre o asignado)', NEW.id_intento;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "item_cuestionario" ic
    JOIN "sesion_cuestionario" sc
      ON sc.id_sesion_cuestionario = ic.id_sesion_cuestionario
    WHERE ic.id_item = NEW.id_item
      AND sc.id_cuestionario = v_id_cuestionario
  ) THEN
    RAISE EXCEPTION
      'El item % no pertenece al cuestionario del intento %',
      NEW.id_item, NEW.id_intento;
  END IF;

  IF NEW.id_opcion IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "item_cuestionario" ic
    JOIN "version_pregunta" vp
      ON vp.id_version_pregunta = ic.id_version_pregunta
    JOIN "opcion_respuesta" op
      ON op.id_opcion = NEW.id_opcion
     AND op.id_conjunto_opciones = vp.id_conjunto_opciones
    WHERE ic.id_item = NEW.id_item
  ) THEN
    RAISE EXCEPTION
      'La opción seleccionada no pertenece a la pregunta del cuestionario';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_validar_opcion_respuesta_intento() OWNER TO preicfes_app;

--
-- Name: fn_normalizar_correo(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_normalizar_correo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.correo := lower(btrim(NEW.correo));
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_normalizar_correo() OWNER TO preicfes_app;

--
-- Name: fn_validar_intento_asignado(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_intento_asignado() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id_estudiante uuid;
BEGIN
  /* Serializa las dos posibles especializaciones para evitar una carrera
     donde el mismo intento termine siendo libre y asignado simultáneamente. */
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id_intento::text, 0));

  SELECT i.id_estudiante
    INTO v_id_estudiante
  FROM "intento" i
  WHERE i.id_intento = NEW.id_intento;

  IF v_id_estudiante IS NULL THEN
    RAISE EXCEPTION 'El intento % no existe', NEW.id_intento;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "intento_libre" il
    WHERE il.id_intento = NEW.id_intento
  ) THEN
    RAISE EXCEPTION
      'El intento % ya está definido como intento libre', NEW.id_intento;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "asignacion_aula" aa
    JOIN "aula" a
      ON a.id_aula = aa.id_aula
    JOIN "matricula_aula" ma
      ON ma.id_aula = a.id_aula
     AND ma.id_estudiante = v_id_estudiante
     AND ma.estado = 'ACTIVA'
    WHERE aa.id_asignacion = NEW.id_asignacion
  ) THEN
    RAISE EXCEPTION
      'El estudiante % no está matriculado activamente en el aula de la asignación %',
      v_id_estudiante, NEW.id_asignacion;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_validar_intento_asignado() OWNER TO preicfes_app;

--
-- Name: fn_validar_intento_libre(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_intento_libre() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id_intento::text, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM "intento" i
    WHERE i.id_intento = NEW.id_intento
  ) THEN
    RAISE EXCEPTION 'El intento % no existe', NEW.id_intento;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "intento_asignado" ia
    WHERE ia.id_intento = NEW.id_intento
  ) THEN
    RAISE EXCEPTION
      'El intento % ya está definido como intento asignado', NEW.id_intento;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_validar_intento_libre() OWNER TO preicfes_app;

--
-- Name: fn_validar_profesor_aula(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_profesor_aula() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "usuario" u
    JOIN "rol" r ON r."id_rol" = u."id_rol"
    JOIN "usuario_institucion" ui
      ON ui."id_usuario" = u."id_usuario"
     AND ui."id_institucion" = NEW."id_institucion"
     AND ui."estado" = 'ACTIVA'
    WHERE u."id_usuario" = NEW."id_profesor"
      AND u."estado" = 'ACTIVO'
      AND r."codigo" = 'PROFESOR'
  ) THEN
    RAISE EXCEPTION
      'El profesor debe estar activo y vinculado a la institución del aula';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_validar_profesor_aula() OWNER TO preicfes_app;

--
-- Name: fn_validar_usuario_institucion(); Type: FUNCTION; Schema: public; Owner: preicfes_app
--

CREATE FUNCTION public.fn_validar_usuario_institucion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_rol VARCHAR(40);
BEGIN
  SELECT r."codigo"
    INTO v_rol
  FROM "usuario" u
  JOIN "rol" r ON r."id_rol" = u."id_rol"
  WHERE u."id_usuario" = NEW."id_usuario";

  IF v_rol IS NULL OR v_rol NOT IN ('GESTOR_INSTITUCIONAL', 'PROFESOR') THEN
    RAISE EXCEPTION
      'Solo gestores institucionales o profesores pueden vincularse a una institución';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.fn_validar_usuario_institucion() OWNER TO preicfes_app;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO preicfes_app;

--
-- Name: afirmacion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.afirmacion (
    id_afirmacion uuid NOT NULL,
    id_competencia uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    descripcion text NOT NULL,
    activa boolean DEFAULT true NOT NULL
);


ALTER TABLE public.afirmacion OWNER TO preicfes_app;

--
-- Name: asignacion_aula; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.asignacion_aula (
    id_asignacion uuid NOT NULL,
    id_aula uuid NOT NULL,
    id_cuestionario uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    fecha_apertura timestamp(3) with time zone NOT NULL,
    fecha_cierre timestamp(3) with time zone,
    intentos_permitidos integer DEFAULT 1 NOT NULL,
    estado public.estado_asignacion DEFAULT 'PROGRAMADA'::public.estado_asignacion NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_asignacion_fechas CHECK (((fecha_cierre IS NULL) OR (fecha_cierre > fecha_apertura))),
    CONSTRAINT ck_asignacion_intentos CHECK ((intentos_permitidos > 0))
);


ALTER TABLE public.asignacion_aula OWNER TO preicfes_app;

--
-- Name: auditoria; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.auditoria (
    id_auditoria uuid NOT NULL,
    id_usuario uuid,
    id_institucion uuid,
    entidad character varying(100) NOT NULL,
    id_entidad character varying(100),
    accion character varying(80) NOT NULL,
    datos_anteriores jsonb,
    datos_nuevos jsonb,
    direccion_ip inet,
    fecha timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.auditoria OWNER TO preicfes_app;

--
-- Name: aula; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.aula (
    id_aula uuid NOT NULL,
    id_institucion uuid NOT NULL,
    id_profesor uuid NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion character varying(500),
    estado public.estado_aula DEFAULT 'ACTIVA'::public.estado_aula NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.aula OWNER TO preicfes_app;

--
-- Name: clave_respuesta; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.clave_respuesta (
    id_version_pregunta uuid NOT NULL,
    id_opcion uuid NOT NULL,
    justificacion text
);


ALTER TABLE public.clave_respuesta OWNER TO preicfes_app;

--
-- Name: competencia; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.competencia (
    id_competencia uuid NOT NULL,
    id_prueba uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(180) NOT NULL,
    descripcion text,
    activa boolean DEFAULT true NOT NULL
);


ALTER TABLE public.competencia OWNER TO preicfes_app;

--
-- Name: componente; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.componente (
    id_componente uuid NOT NULL,
    id_prueba uuid NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion character varying(500),
    activo boolean DEFAULT true NOT NULL
);


ALTER TABLE public.componente OWNER TO preicfes_app;

--
-- Name: conjunto_opciones; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.conjunto_opciones (
    id_conjunto_opciones uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    nombre character varying(150),
    descripcion character varying(500),
    reutilizable boolean DEFAULT false NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.conjunto_opciones OWNER TO preicfes_app;

--
-- Name: cuestionario; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.cuestionario (
    id_cuestionario uuid NOT NULL,
    id_plantilla uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    nombre character varying(180) NOT NULL,
    estado public.estado_cuestionario DEFAULT 'BORRADOR'::public.estado_cuestionario NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_publicacion timestamp(3) with time zone
);


ALTER TABLE public.cuestionario OWNER TO preicfes_app;

--
-- Name: detalle_plantilla; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.detalle_plantilla (
    id_detalle uuid NOT NULL,
    id_plantilla uuid NOT NULL,
    id_prueba uuid NOT NULL,
    numero_sesion integer NOT NULL,
    cantidad_preguntas integer NOT NULL,
    duracion_minutos integer NOT NULL,
    orden integer NOT NULL,
    CONSTRAINT ck_detalle_valores_positivos CHECK (((numero_sesion > 0) AND (cantidad_preguntas > 0) AND (duracion_minutos > 0) AND (orden > 0)))
);


ALTER TABLE public.detalle_plantilla OWNER TO preicfes_app;

--
-- Name: error_importacion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.error_importacion (
    id_error uuid NOT NULL,
    id_lote_importacion uuid NOT NULL,
    numero_fila integer NOT NULL,
    columna character varying(120),
    codigo_error character varying(80) NOT NULL,
    mensaje text NOT NULL,
    valor_recibido text,
    fila_original jsonb,
    CONSTRAINT ck_error_numero_fila CHECK ((numero_fila > 0))
);


ALTER TABLE public.error_importacion OWNER TO preicfes_app;

--
-- Name: estimulo; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.estimulo (
    id_estimulo uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    codigo character varying(80) NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.estimulo OWNER TO preicfes_app;

--
-- Name: evidencia; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.evidencia (
    id_evidencia uuid NOT NULL,
    id_afirmacion uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    descripcion text NOT NULL,
    activa boolean DEFAULT true NOT NULL
);


ALTER TABLE public.evidencia OWNER TO preicfes_app;

--
-- Name: fuente_contenido; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.fuente_contenido (
    id_fuente uuid NOT NULL,
    nombre character varying(180) NOT NULL,
    tipo public.tipo_fuente NOT NULL,
    referencia character varying(500),
    anio integer
);


ALTER TABLE public.fuente_contenido OWNER TO preicfes_app;

--
-- Name: institucion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.institucion (
    id_institucion uuid NOT NULL,
    id_creada_por uuid,
    nombre character varying(180) NOT NULL,
    nit character varying(30),
    correo character varying(254),
    telefono character varying(30),
    direccion character varying(255),
    ciudad character varying(100),
    logo_url character varying(500),
    estado public.estado_institucion DEFAULT 'ACTIVA'::public.estado_institucion NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.institucion OWNER TO preicfes_app;

--
-- Name: intento; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.intento (
    id_intento uuid NOT NULL,
    id_estudiante uuid NOT NULL,
    estado public.estado_intento DEFAULT 'EN_PROGRESO'::public.estado_intento NOT NULL,
    fecha_inicio timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_finalizacion timestamp(3) with time zone,
    ultima_actividad timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_intento_fechas CHECK (((fecha_finalizacion IS NULL) OR (fecha_finalizacion >= fecha_inicio)))
);


ALTER TABLE public.intento OWNER TO preicfes_app;

--
-- Name: intento_asignado; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.intento_asignado (
    id_intento uuid NOT NULL,
    id_asignacion uuid NOT NULL
);


ALTER TABLE public.intento_asignado OWNER TO preicfes_app;

--
-- Name: intento_libre; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.intento_libre (
    id_intento uuid NOT NULL,
    id_cuestionario uuid NOT NULL
);


ALTER TABLE public.intento_libre OWNER TO preicfes_app;

--
-- Name: invitacion_aula; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.invitacion_aula (
    id_invitacion uuid NOT NULL,
    id_aula uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    codigo character varying(80) NOT NULL,
    fecha_expiracion timestamp(3) with time zone,
    usos_maximos integer,
    usos_realizados integer DEFAULT 0 NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_invitacion_limite_usos CHECK (((usos_maximos IS NULL) OR (usos_realizados <= usos_maximos))),
    CONSTRAINT ck_invitacion_usos_maximos CHECK (((usos_maximos IS NULL) OR (usos_maximos > 0))),
    CONSTRAINT ck_invitacion_usos_realizados CHECK ((usos_realizados >= 0))
);


ALTER TABLE public.invitacion_aula OWNER TO preicfes_app;

--
-- Name: item_cuestionario; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.item_cuestionario (
    id_item uuid NOT NULL,
    id_sesion_cuestionario uuid NOT NULL,
    id_version_pregunta uuid NOT NULL,
    orden integer NOT NULL,
    valor numeric(8,2) DEFAULT 1 NOT NULL,
    CONSTRAINT ck_item_valores_positivos CHECK (((orden > 0) AND (valor > (0)::numeric)))
);


ALTER TABLE public.item_cuestionario OWNER TO preicfes_app;

--
-- Name: lote_importacion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.lote_importacion (
    id_lote_importacion uuid NOT NULL,
    id_usuario uuid NOT NULL,
    nombre_archivo character varying(255) NOT NULL,
    archivo_url character varying(1000),
    estado public.estado_importacion DEFAULT 'PENDIENTE'::public.estado_importacion NOT NULL,
    total_filas integer DEFAULT 0 NOT NULL,
    filas_exitosas integer DEFAULT 0 NOT NULL,
    filas_fallidas integer DEFAULT 0 NOT NULL,
    fecha_inicio timestamp(3) with time zone,
    fecha_finalizacion timestamp(3) with time zone,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_lote_fechas CHECK (((fecha_finalizacion IS NULL) OR (fecha_inicio IS NULL) OR (fecha_finalizacion >= fecha_inicio))),
    CONSTRAINT ck_lote_suma_filas CHECK (((filas_exitosas + filas_fallidas) <= total_filas)),
    CONSTRAINT ck_lote_totales_no_negativos CHECK (((total_filas >= 0) AND (filas_exitosas >= 0) AND (filas_fallidas >= 0)))
);


ALTER TABLE public.lote_importacion OWNER TO preicfes_app;

--
-- Name: matricula_aula; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.matricula_aula (
    id_matricula uuid NOT NULL,
    id_aula uuid NOT NULL,
    id_estudiante uuid NOT NULL,
    id_invitacion uuid,
    estado public.estado_matricula DEFAULT 'ACTIVA'::public.estado_matricula NOT NULL,
    fecha_ingreso timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_retiro timestamp(3) with time zone,
    CONSTRAINT ck_matricula_fechas CHECK (((fecha_retiro IS NULL) OR (fecha_retiro >= fecha_ingreso)))
);


ALTER TABLE public.matricula_aula OWNER TO preicfes_app;

--
-- Name: modalidad_evaluacion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.modalidad_evaluacion (
    id_modalidad uuid NOT NULL,
    codigo character varying(30) NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion character varying(500),
    activa boolean DEFAULT true NOT NULL
);


ALTER TABLE public.modalidad_evaluacion OWNER TO preicfes_app;

--
-- Name: nivel_dificultad; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.nivel_dificultad (
    id_dificultad uuid NOT NULL,
    codigo character varying(30) NOT NULL,
    nombre character varying(80) NOT NULL,
    valor integer NOT NULL,
    descripcion character varying(255),
    CONSTRAINT ck_dificultad_valor_positivo CHECK ((valor > 0))
);


ALTER TABLE public.nivel_dificultad OWNER TO preicfes_app;

--
-- Name: opcion_recurso; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.opcion_recurso (
    id_opcion uuid NOT NULL,
    id_recurso uuid NOT NULL,
    orden integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_opcion_recurso_orden CHECK ((orden > 0))
);


ALTER TABLE public.opcion_recurso OWNER TO preicfes_app;

--
-- Name: opcion_respuesta; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.opcion_respuesta (
    id_opcion uuid NOT NULL,
    id_conjunto_opciones uuid NOT NULL,
    letra character varying(5) NOT NULL,
    contenido text NOT NULL,
    orden integer NOT NULL,
    CONSTRAINT ck_opcion_orden_positivo CHECK ((orden > 0))
);


ALTER TABLE public.opcion_respuesta OWNER TO preicfes_app;

--
-- Name: plantilla_evaluacion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.plantilla_evaluacion (
    id_plantilla uuid NOT NULL,
    id_modalidad uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    nombre character varying(180) NOT NULL,
    descripcion character varying(500),
    oficial boolean DEFAULT false NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp(3) with time zone NOT NULL,
    CONSTRAINT ck_plantilla_version CHECK ((version > 0))
);


ALTER TABLE public.plantilla_evaluacion OWNER TO preicfes_app;

--
-- Name: pregunta; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.pregunta (
    id_pregunta uuid NOT NULL,
    id_creada_por uuid NOT NULL,
    codigo character varying(80) NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.pregunta OWNER TO preicfes_app;

--
-- Name: prueba; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.prueba (
    id_prueba uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(120) NOT NULL,
    descripcion character varying(500),
    activa boolean DEFAULT true NOT NULL
);


ALTER TABLE public.prueba OWNER TO preicfes_app;

--
-- Name: recurso_multimedia; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.recurso_multimedia (
    id_recurso uuid NOT NULL,
    id_subido_por uuid,
    tipo public.tipo_recurso NOT NULL,
    url character varying(1000) NOT NULL,
    nombre_archivo character varying(255) NOT NULL,
    texto_alternativo character varying(500),
    mime_type character varying(120) NOT NULL,
    tamano_bytes bigint,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_recurso_tamano CHECK (((tamano_bytes IS NULL) OR (tamano_bytes >= 0)))
);


ALTER TABLE public.recurso_multimedia OWNER TO preicfes_app;

--
-- Name: respuesta_intento; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.respuesta_intento (
    id_respuesta uuid NOT NULL,
    id_intento uuid NOT NULL,
    id_item uuid NOT NULL,
    id_opcion uuid,
    respuesta_texto text,
    tiempo_segundos integer,
    fecha_respuesta timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp(3) with time zone NOT NULL,
    CONSTRAINT ck_respuesta_contenido CHECK (((id_opcion IS NOT NULL) OR (NULLIF(btrim(respuesta_texto), ''::text) IS NOT NULL))),
    CONSTRAINT ck_respuesta_tiempo CHECK (((tiempo_segundos IS NULL) OR (tiempo_segundos >= 0)))
);


ALTER TABLE public.respuesta_intento OWNER TO preicfes_app;

--
-- Name: rol; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.rol (
    id_rol uuid NOT NULL,
    codigo character varying(40) NOT NULL,
    nombre character varying(80) NOT NULL,
    descripcion character varying(255)
);


ALTER TABLE public.rol OWNER TO preicfes_app;

--
-- Name: servicio; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.servicio (
    id_servicio uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion character varying(500),
    activo boolean DEFAULT true NOT NULL
);


ALTER TABLE public.servicio OWNER TO preicfes_app;

--
-- Name: sesion_cuestionario; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.sesion_cuestionario (
    id_sesion_cuestionario uuid NOT NULL,
    id_cuestionario uuid NOT NULL,
    numero_sesion integer NOT NULL,
    nombre character varying(150) NOT NULL,
    duracion_minutos integer NOT NULL,
    orden integer NOT NULL,
    CONSTRAINT ck_sesion_valores_positivos CHECK (((numero_sesion > 0) AND (duracion_minutos > 0) AND (orden > 0)))
);


ALTER TABLE public.sesion_cuestionario OWNER TO preicfes_app;

--
-- Name: sesion_refresco; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.sesion_refresco (
    id_sesion uuid NOT NULL,
    id_usuario uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    direccion_ip inet,
    agente_usuario character varying(500),
    fecha_expiracion timestamp(3) with time zone NOT NULL,
    fecha_revocacion timestamp(3) with time zone,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.sesion_refresco OWNER TO preicfes_app;

--
-- Name: solicitud_acceso_institucional; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.solicitud_acceso_institucional (
    id_solicitud uuid NOT NULL,
    nombre_institucion character varying(180) NOT NULL,
    nombre_responsable character varying(120) NOT NULL,
    cargo character varying(100) NOT NULL,
    correo_institucional character varying(254) NOT NULL,
    telefono character varying(30) NOT NULL,
    ciudad character varying(100) NOT NULL,
    rango_estudiantes character varying(60) NOT NULL,
    mensaje text,
    acepta_politica_datos boolean DEFAULT false NOT NULL,
    estado public.estado_solicitud_institucional DEFAULT 'PENDIENTE'::public.estado_solicitud_institucional NOT NULL,
    notas_internas text,
    id_revisada_por uuid,
    id_institucion_creada uuid,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp(3) with time zone NOT NULL
);


ALTER TABLE public.solicitud_acceso_institucional OWNER TO preicfes_app;

--
-- Name: solicitud_servicio; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.solicitud_servicio (
    id_solicitud uuid NOT NULL,
    id_servicio uuid NOT NULL
);


ALTER TABLE public.solicitud_servicio OWNER TO preicfes_app;

--
-- Name: tarea; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.tarea (
    id_tarea uuid NOT NULL,
    id_evidencia uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    descripcion text NOT NULL,
    activa boolean DEFAULT true NOT NULL
);


ALTER TABLE public.tarea OWNER TO preicfes_app;

--
-- Name: tema; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.tema (
    id_tema uuid NOT NULL,
    id_componente uuid NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion character varying(500),
    activo boolean DEFAULT true NOT NULL
);


ALTER TABLE public.tema OWNER TO preicfes_app;

--
-- Name: tipo_pregunta; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.tipo_pregunta (
    id_tipo_pregunta uuid NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(120) NOT NULL,
    descripcion character varying(500),
    activo boolean DEFAULT true NOT NULL
);


ALTER TABLE public.tipo_pregunta OWNER TO preicfes_app;

--
-- Name: usuario; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.usuario (
    id_usuario uuid NOT NULL,
    id_rol uuid,
    nombres character varying(100) NOT NULL,
    apellidos character varying(100) NOT NULL,
    correo character varying(254) NOT NULL,
    contrasena_hash character varying(255),
    correo_verificado boolean DEFAULT false NOT NULL,
    estado public.estado_usuario DEFAULT 'PENDIENTE'::public.estado_usuario NOT NULL,
    fecha_registro timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp(3) with time zone NOT NULL,
    foto_perfil_url character varying(1000),
    google_sub character varying(255),
    CONSTRAINT usuario_credencial_check CHECK (((contrasena_hash IS NOT NULL) OR (google_sub IS NOT NULL))),
    CONSTRAINT usuario_foto_perfil_url_check CHECK (((foto_perfil_url IS NULL) OR ((foto_perfil_url)::text ~* '^https?://'::text)))
);


ALTER TABLE public.usuario OWNER TO preicfes_app;

--
-- Name: usuario_institucion; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.usuario_institucion (
    id_usuario_institucion uuid NOT NULL,
    id_institucion uuid NOT NULL,
    id_usuario uuid NOT NULL,
    estado public.estado_vinculacion DEFAULT 'ACTIVA'::public.estado_vinculacion NOT NULL,
    fecha_vinculacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_desvinculacion timestamp(3) with time zone,
    id_rol_institucional uuid NOT NULL,
    CONSTRAINT ck_vinculacion_fechas CHECK (((fecha_desvinculacion IS NULL) OR (fecha_desvinculacion >= fecha_vinculacion)))
);


ALTER TABLE public.usuario_institucion OWNER TO preicfes_app;

--
-- Name: version_estimulo; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.version_estimulo (
    id_version_estimulo uuid NOT NULL,
    id_estimulo uuid NOT NULL,
    id_fuente uuid,
    numero_version integer NOT NULL,
    titulo character varying(250),
    contenido text NOT NULL,
    estado public.estado_pregunta DEFAULT 'BORRADOR'::public.estado_pregunta NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_publicacion timestamp(3) with time zone,
    CONSTRAINT ck_version_estimulo_numero CHECK ((numero_version > 0)),
    CONSTRAINT ck_version_estimulo_publicacion CHECK (((estado <> 'PUBLICADA'::public.estado_pregunta) OR (fecha_publicacion IS NOT NULL)))
);


ALTER TABLE public.version_estimulo OWNER TO preicfes_app;

--
-- Name: version_estimulo_recurso; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.version_estimulo_recurso (
    id_version_estimulo uuid NOT NULL,
    id_recurso uuid NOT NULL,
    orden integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_estimulo_recurso_orden CHECK ((orden > 0))
);


ALTER TABLE public.version_estimulo_recurso OWNER TO preicfes_app;

--
-- Name: version_pregunta; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.version_pregunta (
    id_version_pregunta uuid NOT NULL,
    id_pregunta uuid NOT NULL,
    id_tipo_pregunta uuid NOT NULL,
    id_dificultad uuid NOT NULL,
    id_tarea uuid,
    id_version_estimulo uuid,
    id_conjunto_opciones uuid NOT NULL,
    id_fuente uuid,
    id_lote_importacion uuid,
    id_creada_por uuid NOT NULL,
    numero_version integer NOT NULL,
    enunciado text NOT NULL,
    explicacion text,
    estado public.estado_pregunta DEFAULT 'BORRADOR'::public.estado_pregunta NOT NULL,
    fecha_creacion timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_publicacion timestamp(3) with time zone,
    CONSTRAINT ck_version_pregunta_numero CHECK ((numero_version > 0)),
    CONSTRAINT ck_version_pregunta_publicacion CHECK (((estado <> 'PUBLICADA'::public.estado_pregunta) OR (fecha_publicacion IS NOT NULL)))
);


ALTER TABLE public.version_pregunta OWNER TO preicfes_app;

--
-- Name: version_pregunta_recurso; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.version_pregunta_recurso (
    id_version_pregunta uuid NOT NULL,
    id_recurso uuid NOT NULL,
    orden integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_pregunta_recurso_orden CHECK ((orden > 0))
);


ALTER TABLE public.version_pregunta_recurso OWNER TO preicfes_app;

--
-- Name: version_pregunta_tema; Type: TABLE; Schema: public; Owner: preicfes_app
--

CREATE TABLE public.version_pregunta_tema (
    id_version_pregunta uuid NOT NULL,
    id_tema uuid NOT NULL
);


ALTER TABLE public.version_pregunta_tema OWNER TO preicfes_app;

--
-- Name: vista_origen_intento; Type: VIEW; Schema: public; Owner: preicfes_app
--

CREATE VIEW public.vista_origen_intento AS
 SELECT il.id_intento,
    il.id_cuestionario,
    NULL::uuid AS id_asignacion,
    NULL::uuid AS id_aula
   FROM public.intento_libre il
UNION ALL
 SELECT ia.id_intento,
    aa.id_cuestionario,
    aa.id_asignacion,
    aa.id_aula
   FROM (public.intento_asignado ia
     JOIN public.asignacion_aula aa ON ((aa.id_asignacion = ia.id_asignacion)));


ALTER VIEW public.vista_origen_intento OWNER TO preicfes_app;

--
-- Name: vista_resultado_intento; Type: VIEW; Schema: public; Owner: preicfes_app
--

CREATE VIEW public.vista_resultado_intento AS
 SELECT i.id_intento,
    i.id_estudiante,
    oi.id_cuestionario,
    oi.id_asignacion,
    oi.id_aula,
    i.estado,
    i.fecha_inicio,
    i.fecha_finalizacion,
    (count(ic.id_item))::integer AS total_preguntas,
    (count(ri.id_respuesta))::integer AS preguntas_respondidas,
    (count(*) FILTER (WHERE ((ri.id_opcion IS NOT NULL) AND (ri.id_opcion = cr.id_opcion))))::integer AS respuestas_correctas,
    (count(*) FILTER (WHERE ((ri.id_respuesta IS NOT NULL) AND (cr.id_opcion IS NOT NULL) AND (ri.id_opcion IS DISTINCT FROM cr.id_opcion))))::integer AS respuestas_incorrectas,
    ((count(ic.id_item) - count(ri.id_respuesta)))::integer AS sin_responder,
    round(
        CASE
            WHEN (count(ic.id_item) = 0) THEN (0)::numeric
            ELSE (((count(*) FILTER (WHERE ((ri.id_opcion IS NOT NULL) AND (ri.id_opcion = cr.id_opcion))))::numeric * (100)::numeric) / (count(ic.id_item))::numeric)
        END, 2) AS porcentaje
   FROM (((((public.intento i
     JOIN public.vista_origen_intento oi ON ((oi.id_intento = i.id_intento)))
     JOIN public.sesion_cuestionario sc ON ((sc.id_cuestionario = oi.id_cuestionario)))
     JOIN public.item_cuestionario ic ON ((ic.id_sesion_cuestionario = sc.id_sesion_cuestionario)))
     LEFT JOIN public.respuesta_intento ri ON (((ri.id_intento = i.id_intento) AND (ri.id_item = ic.id_item))))
     LEFT JOIN public.clave_respuesta cr ON ((cr.id_version_pregunta = ic.id_version_pregunta)))
  GROUP BY i.id_intento, i.id_estudiante, oi.id_cuestionario, oi.id_asignacion, oi.id_aula, i.estado, i.fecha_inicio, i.fecha_finalizacion;


ALTER VIEW public.vista_resultado_intento OWNER TO preicfes_app;

--
-- Name: VIEW vista_resultado_intento; Type: COMMENT; Schema: public; Owner: preicfes_app
--

COMMENT ON VIEW public.vista_resultado_intento IS 'Resultado calculado de cada intento; el porcentaje no equivale a un puntaje oficial del ICFES.';


--
-- Name: vista_resultado_aula; Type: VIEW; Schema: public; Owner: preicfes_app
--

CREATE VIEW public.vista_resultado_aula AS
 SELECT a.id_institucion,
    a.id_aula,
    a.id_profesor,
    vr.id_asignacion,
    vr.id_cuestionario,
    vr.id_intento,
    vr.id_estudiante,
    concat(u.nombres, ' ', u.apellidos) AS nombre_estudiante,
    vr.estado,
    vr.total_preguntas,
    vr.preguntas_respondidas,
    vr.respuestas_correctas,
    vr.respuestas_incorrectas,
    vr.sin_responder,
    vr.porcentaje,
    vr.fecha_inicio,
    vr.fecha_finalizacion
   FROM ((public.vista_resultado_intento vr
     JOIN public.aula a ON ((a.id_aula = vr.id_aula)))
     JOIN public.usuario u ON ((u.id_usuario = vr.id_estudiante)))
  WHERE (vr.id_asignacion IS NOT NULL);


ALTER VIEW public.vista_resultado_aula OWNER TO preicfes_app;

--
-- Name: VIEW vista_resultado_aula; Type: COMMENT; Schema: public; Owner: preicfes_app
--

COMMENT ON VIEW public.vista_resultado_aula IS 'Resultados asignados agrupables por institución, profesor y aula.';


--
-- Name: vista_progreso_institucion; Type: VIEW; Schema: public; Owner: preicfes_app
--

CREATE VIEW public.vista_progreso_institucion AS
 SELECT i.id_institucion,
    i.nombre AS nombre_institucion,
    a.id_profesor,
    concat(p.nombres, ' ', p.apellidos) AS nombre_profesor,
    a.id_aula,
    a.nombre AS nombre_aula,
    (count(DISTINCT vra.id_estudiante))::integer AS total_estudiantes_evaluados,
    (count(vra.id_intento))::integer AS intentos_finalizados,
    round(avg(vra.porcentaje), 2) AS promedio_porcentaje,
    max(vra.fecha_finalizacion) AS fecha_ultimo_intento
   FROM (((public.institucion i
     JOIN public.aula a ON ((a.id_institucion = i.id_institucion)))
     JOIN public.usuario p ON ((p.id_usuario = a.id_profesor)))
     LEFT JOIN public.vista_resultado_aula vra ON (((vra.id_aula = a.id_aula) AND (vra.estado = 'FINALIZADO'::public.estado_intento))))
  GROUP BY i.id_institucion, i.nombre, a.id_profesor, p.nombres, p.apellidos, a.id_aula, a.nombre;


ALTER VIEW public.vista_progreso_institucion OWNER TO preicfes_app;

--
-- Name: VIEW vista_progreso_institucion; Type: COMMENT; Schema: public; Owner: preicfes_app
--

COMMENT ON VIEW public.vista_progreso_institucion IS 'Progreso agregado de todas las aulas pertenecientes a una institución.';


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
bdfa53e1-d80d-42e3-84b1-3276b09cdd70	a55bdf8dac9474f96ffae34f0e865c203d8e74761939aec061ce38eca27a98a0	2026-08-31 00:06:37.252141-05	20260830205131_modelo_relacional_v1	\N	\N	2026-08-31 00:06:37.157062-05	1
8f0cec53-cc5c-478b-84e8-8aee3304562f	40d9e05e7dca9a6f7117e4a248dacfd2ef6b3f50c351726d2f35088a9d644b44	2026-08-31 00:06:37.256526-05	20260830230000_multitenencia_roles_por_institucion	\N	\N	2026-08-31 00:06:37.252765-05	1
c63b83c7-9084-4bee-981c-ce6f9e91c036	da3872eaff47548132a5a70e227afba4dfd28fa2f61000059ef60bad0c4afc3e	2026-09-02 13:31:56.339457-05	20260902183156_flujo_solicitudes_institucionales	\N	\N	2026-09-02 13:31:56.322726-05	1
\.


--
-- Data for Name: afirmacion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.afirmacion (id_afirmacion, id_competencia, codigo, descripcion, activa) FROM stdin;
\.


--
-- Data for Name: asignacion_aula; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.asignacion_aula (id_asignacion, id_aula, id_cuestionario, id_creada_por, fecha_apertura, fecha_cierre, intentos_permitidos, estado, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: auditoria; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.auditoria (id_auditoria, id_usuario, id_institucion, entidad, id_entidad, accion, datos_anteriores, datos_nuevos, direccion_ip, fecha) FROM stdin;
\.


--
-- Data for Name: aula; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.aula (id_aula, id_institucion, id_profesor, nombre, descripcion, estado, fecha_creacion, fecha_actualizacion) FROM stdin;
\.


--
-- Data for Name: clave_respuesta; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.clave_respuesta (id_version_pregunta, id_opcion, justificacion) FROM stdin;
\.


--
-- Data for Name: competencia; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.competencia (id_competencia, id_prueba, codigo, nombre, descripcion, activa) FROM stdin;
\.


--
-- Data for Name: componente; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.componente (id_componente, id_prueba, nombre, descripcion, activo) FROM stdin;
\.


--
-- Data for Name: conjunto_opciones; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.conjunto_opciones (id_conjunto_opciones, id_creada_por, nombre, descripcion, reutilizable, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: cuestionario; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.cuestionario (id_cuestionario, id_plantilla, id_creada_por, nombre, estado, fecha_creacion, fecha_publicacion) FROM stdin;
\.


--
-- Data for Name: detalle_plantilla; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.detalle_plantilla (id_detalle, id_plantilla, id_prueba, numero_sesion, cantidad_preguntas, duracion_minutos, orden) FROM stdin;
\.


--
-- Data for Name: error_importacion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.error_importacion (id_error, id_lote_importacion, numero_fila, columna, codigo_error, mensaje, valor_recibido, fila_original) FROM stdin;
\.


--
-- Data for Name: estimulo; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.estimulo (id_estimulo, id_creada_por, codigo, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: evidencia; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.evidencia (id_evidencia, id_afirmacion, codigo, descripcion, activa) FROM stdin;
\.


--
-- Data for Name: fuente_contenido; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.fuente_contenido (id_fuente, nombre, tipo, referencia, anio) FROM stdin;
\.


--
-- Data for Name: institucion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.institucion (id_institucion, id_creada_por, nombre, nit, correo, telefono, direccion, ciudad, logo_url, estado, fecha_creacion, fecha_actualizacion) FROM stdin;
\.


--
-- Data for Name: intento; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.intento (id_intento, id_estudiante, estado, fecha_inicio, fecha_finalizacion, ultima_actividad) FROM stdin;
\.


--
-- Data for Name: intento_asignado; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.intento_asignado (id_intento, id_asignacion) FROM stdin;
\.


--
-- Data for Name: intento_libre; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.intento_libre (id_intento, id_cuestionario) FROM stdin;
\.


--
-- Data for Name: invitacion_aula; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.invitacion_aula (id_invitacion, id_aula, id_creada_por, codigo, fecha_expiracion, usos_maximos, usos_realizados, activa, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: item_cuestionario; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.item_cuestionario (id_item, id_sesion_cuestionario, id_version_pregunta, orden, valor) FROM stdin;
\.


--
-- Data for Name: lote_importacion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.lote_importacion (id_lote_importacion, id_usuario, nombre_archivo, archivo_url, estado, total_filas, filas_exitosas, filas_fallidas, fecha_inicio, fecha_finalizacion, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: matricula_aula; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.matricula_aula (id_matricula, id_aula, id_estudiante, id_invitacion, estado, fecha_ingreso, fecha_retiro) FROM stdin;
\.


--
-- Data for Name: modalidad_evaluacion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.modalidad_evaluacion (id_modalidad, codigo, nombre, descripcion, activa) FROM stdin;
1b1fa3a5-d29e-403f-a17a-7fff17d4f378	RAPIDO	Cuestionario rápido	Evaluación corta por prueba o combinación de pruebas	t
5e86601a-1db4-432f-978d-4f8c6e8fe9a2	REAL	Simulacro real	Evaluación distribuida por sesiones y pruebas	t
\.


--
-- Data for Name: nivel_dificultad; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.nivel_dificultad (id_dificultad, codigo, nombre, valor, descripcion) FROM stdin;
6a94a197-b6b2-4eca-8c10-839b5dea4491	BAJA	Baja	1	Pregunta de dificultad baja
32fef90d-be8c-4f79-9daa-91e3b1d1af94	MEDIA	Media	2	Pregunta de dificultad media
2abc2c5f-eed4-4e8e-b0c4-b3202361c071	ALTA	Alta	3	Pregunta de dificultad alta
\.


--
-- Data for Name: opcion_recurso; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.opcion_recurso (id_opcion, id_recurso, orden) FROM stdin;
\.


--
-- Data for Name: opcion_respuesta; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.opcion_respuesta (id_opcion, id_conjunto_opciones, letra, contenido, orden) FROM stdin;
\.


--
-- Data for Name: plantilla_evaluacion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.plantilla_evaluacion (id_plantilla, id_modalidad, id_creada_por, nombre, descripcion, oficial, activa, version, fecha_creacion, fecha_actualizacion) FROM stdin;
\.


--
-- Data for Name: pregunta; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.pregunta (id_pregunta, id_creada_por, codigo, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: prueba; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.prueba (id_prueba, codigo, nombre, descripcion, activa) FROM stdin;
819730f0-0330-40c6-9f30-09d3fecde051	LECTURA_CRITICA	Lectura Crítica	Prueba de Lectura Crítica	t
08286be2-3c42-4891-b0b4-66242f37e46a	MATEMATICAS	Matemáticas	Prueba de Matemáticas	t
6eab5684-e840-46bc-b26b-976a0e933fe6	SOCIALES_CIUDADANAS	Sociales y Ciudadanas	Prueba de Sociales y Ciudadanas	t
0c5b411a-57d5-4307-a4ec-00b0375c572d	CIENCIAS_NATURALES	Ciencias Naturales	Prueba de Ciencias Naturales	t
9f9e3b11-2751-4940-a89c-50976f1d5a24	INGLES	Inglés	Prueba de Inglés	t
\.


--
-- Data for Name: recurso_multimedia; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.recurso_multimedia (id_recurso, id_subido_por, tipo, url, nombre_archivo, texto_alternativo, mime_type, tamano_bytes, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: respuesta_intento; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.respuesta_intento (id_respuesta, id_intento, id_item, id_opcion, respuesta_texto, tiempo_segundos, fecha_respuesta, fecha_actualizacion) FROM stdin;
\.


--
-- Data for Name: rol; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.rol (id_rol, codigo, nombre, descripcion) FROM stdin;
bb686c53-25b8-4081-a858-e209eae6e072	ADMINISTRADOR	Administrador	Administra toda la plataforma
05194f5f-03b3-42d3-8f25-1c280681747e	GESTOR_INSTITUCIONAL	Gestor institucional	Administra profesores y consulta el progreso de su institución
dd853f41-59e6-482b-89d2-1df6b5316bd4	PROFESOR	Profesor	Administra sus aulas y asignaciones
ba667d56-c747-4677-8d34-a2baf18fb8fb	ESTUDIANTE	Estudiante	Presenta cuestionarios y consulta sus resultados
\.


--
-- Data for Name: servicio; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.servicio (id_servicio, codigo, nombre, descripcion, activo) FROM stdin;
\.


--
-- Data for Name: sesion_cuestionario; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.sesion_cuestionario (id_sesion_cuestionario, id_cuestionario, numero_sesion, nombre, duracion_minutos, orden) FROM stdin;
\.


--
-- Data for Name: sesion_refresco; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.sesion_refresco (id_sesion, id_usuario, token_hash, direccion_ip, agente_usuario, fecha_expiracion, fecha_revocacion, fecha_creacion) FROM stdin;
\.


--
-- Data for Name: solicitud_acceso_institucional; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.solicitud_acceso_institucional (id_solicitud, nombre_institucion, nombre_responsable, cargo, correo_institucional, telefono, ciudad, rango_estudiantes, mensaje, acepta_politica_datos, estado, notas_internas, id_revisada_por, id_institucion_creada, fecha_creacion, fecha_actualizacion) FROM stdin;
\.


--
-- Data for Name: solicitud_servicio; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.solicitud_servicio (id_solicitud, id_servicio) FROM stdin;
\.


--
-- Data for Name: tarea; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.tarea (id_tarea, id_evidencia, codigo, descripcion, activa) FROM stdin;
\.


--
-- Data for Name: tema; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.tema (id_tema, id_componente, nombre, descripcion, activo) FROM stdin;
\.


--
-- Data for Name: tipo_pregunta; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.tipo_pregunta (id_tipo_pregunta, codigo, nombre, descripcion, activo) FROM stdin;
e4a31494-6cf6-4fd4-ba73-3d119422e7bd	SELECCION_MULTIPLE_UNICA	Selección múltiple con única respuesta	Pregunta objetiva con una sola opción correcta	t
\.


--
-- Data for Name: usuario; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.usuario (id_usuario, id_rol, nombres, apellidos, correo, contrasena_hash, correo_verificado, estado, fecha_registro, fecha_actualizacion) FROM stdin;
668c76ab-01aa-4c13-9ea4-56227b89e61e	\N	Usuario	Demo	demo@preicfes.local	$argon2id$v=19$m=65536,t=3,p=4$mxb2HCX2RCeq38aMBZvDvw$wCuOvmAdNmrXf6UFN9aYM8rpk9RDONXKA0MwmFLw6QQ	f	ACTIVO	2026-09-02 17:03:43.585-05	2026-09-02 17:03:43.585-05
\.


--
-- Data for Name: usuario_institucion; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.usuario_institucion (id_usuario_institucion, id_institucion, id_usuario, estado, fecha_vinculacion, fecha_desvinculacion, id_rol_institucional) FROM stdin;
\.


--
-- Data for Name: version_estimulo; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.version_estimulo (id_version_estimulo, id_estimulo, id_fuente, numero_version, titulo, contenido, estado, fecha_creacion, fecha_publicacion) FROM stdin;
\.


--
-- Data for Name: version_estimulo_recurso; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.version_estimulo_recurso (id_version_estimulo, id_recurso, orden) FROM stdin;
\.


--
-- Data for Name: version_pregunta; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.version_pregunta (id_version_pregunta, id_pregunta, id_tipo_pregunta, id_dificultad, id_tarea, id_version_estimulo, id_conjunto_opciones, id_fuente, id_lote_importacion, id_creada_por, numero_version, enunciado, explicacion, estado, fecha_creacion, fecha_publicacion) FROM stdin;
\.


--
-- Data for Name: version_pregunta_recurso; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.version_pregunta_recurso (id_version_pregunta, id_recurso, orden) FROM stdin;
\.


--
-- Data for Name: version_pregunta_tema; Type: TABLE DATA; Schema: public; Owner: preicfes_app
--

COPY public.version_pregunta_tema (id_version_pregunta, id_tema) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: afirmacion afirmacion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.afirmacion
    ADD CONSTRAINT afirmacion_pkey PRIMARY KEY (id_afirmacion);


--
-- Name: asignacion_aula asignacion_aula_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.asignacion_aula
    ADD CONSTRAINT asignacion_aula_pkey PRIMARY KEY (id_asignacion);


--
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id_auditoria);


--
-- Name: aula aula_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.aula
    ADD CONSTRAINT aula_pkey PRIMARY KEY (id_aula);


--
-- Name: clave_respuesta clave_respuesta_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.clave_respuesta
    ADD CONSTRAINT clave_respuesta_pkey PRIMARY KEY (id_version_pregunta);


--
-- Name: competencia competencia_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.competencia
    ADD CONSTRAINT competencia_pkey PRIMARY KEY (id_competencia);


--
-- Name: componente componente_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.componente
    ADD CONSTRAINT componente_pkey PRIMARY KEY (id_componente);


--
-- Name: conjunto_opciones conjunto_opciones_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.conjunto_opciones
    ADD CONSTRAINT conjunto_opciones_pkey PRIMARY KEY (id_conjunto_opciones);


--
-- Name: cuestionario cuestionario_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.cuestionario
    ADD CONSTRAINT cuestionario_pkey PRIMARY KEY (id_cuestionario);


--
-- Name: detalle_plantilla detalle_plantilla_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.detalle_plantilla
    ADD CONSTRAINT detalle_plantilla_pkey PRIMARY KEY (id_detalle);


--
-- Name: error_importacion error_importacion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.error_importacion
    ADD CONSTRAINT error_importacion_pkey PRIMARY KEY (id_error);


--
-- Name: estimulo estimulo_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.estimulo
    ADD CONSTRAINT estimulo_pkey PRIMARY KEY (id_estimulo);


--
-- Name: evidencia evidencia_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.evidencia
    ADD CONSTRAINT evidencia_pkey PRIMARY KEY (id_evidencia);


--
-- Name: fuente_contenido fuente_contenido_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.fuente_contenido
    ADD CONSTRAINT fuente_contenido_pkey PRIMARY KEY (id_fuente);


--
-- Name: institucion institucion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.institucion
    ADD CONSTRAINT institucion_pkey PRIMARY KEY (id_institucion);


--
-- Name: intento_asignado intento_asignado_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento_asignado
    ADD CONSTRAINT intento_asignado_pkey PRIMARY KEY (id_intento);


--
-- Name: intento_libre intento_libre_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento_libre
    ADD CONSTRAINT intento_libre_pkey PRIMARY KEY (id_intento);


--
-- Name: intento intento_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento
    ADD CONSTRAINT intento_pkey PRIMARY KEY (id_intento);


--
-- Name: invitacion_aula invitacion_aula_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.invitacion_aula
    ADD CONSTRAINT invitacion_aula_pkey PRIMARY KEY (id_invitacion);


--
-- Name: item_cuestionario item_cuestionario_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.item_cuestionario
    ADD CONSTRAINT item_cuestionario_pkey PRIMARY KEY (id_item);


--
-- Name: lote_importacion lote_importacion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.lote_importacion
    ADD CONSTRAINT lote_importacion_pkey PRIMARY KEY (id_lote_importacion);


--
-- Name: matricula_aula matricula_aula_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.matricula_aula
    ADD CONSTRAINT matricula_aula_pkey PRIMARY KEY (id_matricula);


--
-- Name: modalidad_evaluacion modalidad_evaluacion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.modalidad_evaluacion
    ADD CONSTRAINT modalidad_evaluacion_pkey PRIMARY KEY (id_modalidad);


--
-- Name: nivel_dificultad nivel_dificultad_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.nivel_dificultad
    ADD CONSTRAINT nivel_dificultad_pkey PRIMARY KEY (id_dificultad);


--
-- Name: opcion_recurso opcion_recurso_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.opcion_recurso
    ADD CONSTRAINT opcion_recurso_pkey PRIMARY KEY (id_opcion, id_recurso);


--
-- Name: opcion_respuesta opcion_respuesta_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.opcion_respuesta
    ADD CONSTRAINT opcion_respuesta_pkey PRIMARY KEY (id_opcion);


--
-- Name: plantilla_evaluacion plantilla_evaluacion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.plantilla_evaluacion
    ADD CONSTRAINT plantilla_evaluacion_pkey PRIMARY KEY (id_plantilla);


--
-- Name: pregunta pregunta_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.pregunta
    ADD CONSTRAINT pregunta_pkey PRIMARY KEY (id_pregunta);


--
-- Name: prueba prueba_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.prueba
    ADD CONSTRAINT prueba_pkey PRIMARY KEY (id_prueba);


--
-- Name: recurso_multimedia recurso_multimedia_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.recurso_multimedia
    ADD CONSTRAINT recurso_multimedia_pkey PRIMARY KEY (id_recurso);


--
-- Name: respuesta_intento respuesta_intento_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.respuesta_intento
    ADD CONSTRAINT respuesta_intento_pkey PRIMARY KEY (id_respuesta);


--
-- Name: rol rol_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_pkey PRIMARY KEY (id_rol);


--
-- Name: servicio servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.servicio
    ADD CONSTRAINT servicio_pkey PRIMARY KEY (id_servicio);


--
-- Name: sesion_cuestionario sesion_cuestionario_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.sesion_cuestionario
    ADD CONSTRAINT sesion_cuestionario_pkey PRIMARY KEY (id_sesion_cuestionario);


--
-- Name: sesion_refresco sesion_refresco_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.sesion_refresco
    ADD CONSTRAINT sesion_refresco_pkey PRIMARY KEY (id_sesion);


--
-- Name: solicitud_acceso_institucional solicitud_acceso_institucional_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.solicitud_acceso_institucional
    ADD CONSTRAINT solicitud_acceso_institucional_pkey PRIMARY KEY (id_solicitud);


--
-- Name: solicitud_servicio solicitud_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.solicitud_servicio
    ADD CONSTRAINT solicitud_servicio_pkey PRIMARY KEY (id_solicitud, id_servicio);


--
-- Name: tarea tarea_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.tarea
    ADD CONSTRAINT tarea_pkey PRIMARY KEY (id_tarea);


--
-- Name: tema tema_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.tema
    ADD CONSTRAINT tema_pkey PRIMARY KEY (id_tema);


--
-- Name: tipo_pregunta tipo_pregunta_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.tipo_pregunta
    ADD CONSTRAINT tipo_pregunta_pkey PRIMARY KEY (id_tipo_pregunta);


--
-- Name: usuario_institucion usuario_institucion_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.usuario_institucion
    ADD CONSTRAINT usuario_institucion_pkey PRIMARY KEY (id_usuario_institucion);


--
-- Name: usuario usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_pkey PRIMARY KEY (id_usuario);


--
-- Name: version_estimulo version_estimulo_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_estimulo
    ADD CONSTRAINT version_estimulo_pkey PRIMARY KEY (id_version_estimulo);


--
-- Name: version_estimulo_recurso version_estimulo_recurso_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_estimulo_recurso
    ADD CONSTRAINT version_estimulo_recurso_pkey PRIMARY KEY (id_version_estimulo, id_recurso);


--
-- Name: version_pregunta version_pregunta_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_pkey PRIMARY KEY (id_version_pregunta);


--
-- Name: version_pregunta_recurso version_pregunta_recurso_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta_recurso
    ADD CONSTRAINT version_pregunta_recurso_pkey PRIMARY KEY (id_version_pregunta, id_recurso);


--
-- Name: version_pregunta_tema version_pregunta_tema_pkey; Type: CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta_tema
    ADD CONSTRAINT version_pregunta_tema_pkey PRIMARY KEY (id_version_pregunta, id_tema);


--
-- Name: afirmacion_id_competencia_activa_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX afirmacion_id_competencia_activa_idx ON public.afirmacion USING btree (id_competencia, activa);


--
-- Name: afirmacion_id_competencia_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX afirmacion_id_competencia_codigo_key ON public.afirmacion USING btree (id_competencia, codigo);


--
-- Name: asignacion_aula_fecha_apertura_fecha_cierre_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX asignacion_aula_fecha_apertura_fecha_cierre_idx ON public.asignacion_aula USING btree (fecha_apertura, fecha_cierre);


--
-- Name: asignacion_aula_id_aula_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX asignacion_aula_id_aula_estado_idx ON public.asignacion_aula USING btree (id_aula, estado);


--
-- Name: asignacion_aula_id_cuestionario_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX asignacion_aula_id_cuestionario_idx ON public.asignacion_aula USING btree (id_cuestionario);


--
-- Name: auditoria_entidad_id_entidad_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX auditoria_entidad_id_entidad_idx ON public.auditoria USING btree (entidad, id_entidad);


--
-- Name: auditoria_id_institucion_fecha_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX auditoria_id_institucion_fecha_idx ON public.auditoria USING btree (id_institucion, fecha);


--
-- Name: auditoria_id_usuario_fecha_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX auditoria_id_usuario_fecha_idx ON public.auditoria USING btree (id_usuario, fecha);


--
-- Name: aula_id_institucion_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX aula_id_institucion_estado_idx ON public.aula USING btree (id_institucion, estado);


--
-- Name: aula_id_profesor_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX aula_id_profesor_estado_idx ON public.aula USING btree (id_profesor, estado);


--
-- Name: clave_respuesta_id_opcion_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX clave_respuesta_id_opcion_idx ON public.clave_respuesta USING btree (id_opcion);


--
-- Name: competencia_id_prueba_activa_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX competencia_id_prueba_activa_idx ON public.competencia USING btree (id_prueba, activa);


--
-- Name: competencia_id_prueba_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX competencia_id_prueba_codigo_key ON public.competencia USING btree (id_prueba, codigo);


--
-- Name: componente_id_prueba_activo_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX componente_id_prueba_activo_idx ON public.componente USING btree (id_prueba, activo);


--
-- Name: componente_id_prueba_nombre_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX componente_id_prueba_nombre_key ON public.componente USING btree (id_prueba, nombre);


--
-- Name: cuestionario_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX cuestionario_estado_idx ON public.cuestionario USING btree (estado);


--
-- Name: cuestionario_id_plantilla_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX cuestionario_id_plantilla_idx ON public.cuestionario USING btree (id_plantilla);


--
-- Name: detalle_plantilla_id_plantilla_id_prueba_numero_sesion_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX detalle_plantilla_id_plantilla_id_prueba_numero_sesion_key ON public.detalle_plantilla USING btree (id_plantilla, id_prueba, numero_sesion);


--
-- Name: detalle_plantilla_id_plantilla_orden_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX detalle_plantilla_id_plantilla_orden_key ON public.detalle_plantilla USING btree (id_plantilla, orden);


--
-- Name: detalle_plantilla_id_prueba_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX detalle_plantilla_id_prueba_idx ON public.detalle_plantilla USING btree (id_prueba);


--
-- Name: error_importacion_id_lote_importacion_numero_fila_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX error_importacion_id_lote_importacion_numero_fila_idx ON public.error_importacion USING btree (id_lote_importacion, numero_fila);


--
-- Name: estimulo_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX estimulo_codigo_key ON public.estimulo USING btree (codigo);


--
-- Name: evidencia_id_afirmacion_activa_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX evidencia_id_afirmacion_activa_idx ON public.evidencia USING btree (id_afirmacion, activa);


--
-- Name: evidencia_id_afirmacion_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX evidencia_id_afirmacion_codigo_key ON public.evidencia USING btree (id_afirmacion, codigo);


--
-- Name: fuente_contenido_tipo_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX fuente_contenido_tipo_idx ON public.fuente_contenido USING btree (tipo);


--
-- Name: institucion_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX institucion_estado_idx ON public.institucion USING btree (estado);


--
-- Name: institucion_nit_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX institucion_nit_key ON public.institucion USING btree (nit);


--
-- Name: institucion_nombre_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX institucion_nombre_idx ON public.institucion USING btree (nombre);


--
-- Name: intento_asignado_id_asignacion_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX intento_asignado_id_asignacion_idx ON public.intento_asignado USING btree (id_asignacion);


--
-- Name: intento_fecha_inicio_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX intento_fecha_inicio_idx ON public.intento USING btree (fecha_inicio);


--
-- Name: intento_id_estudiante_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX intento_id_estudiante_estado_idx ON public.intento USING btree (id_estudiante, estado);


--
-- Name: intento_libre_id_cuestionario_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX intento_libre_id_cuestionario_idx ON public.intento_libre USING btree (id_cuestionario);


--
-- Name: invitacion_aula_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX invitacion_aula_codigo_key ON public.invitacion_aula USING btree (codigo);


--
-- Name: invitacion_aula_id_aula_activa_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX invitacion_aula_id_aula_activa_idx ON public.invitacion_aula USING btree (id_aula, activa);


--
-- Name: item_cuestionario_id_sesion_cuestionario_id_version_pregunt_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX item_cuestionario_id_sesion_cuestionario_id_version_pregunt_key ON public.item_cuestionario USING btree (id_sesion_cuestionario, id_version_pregunta);


--
-- Name: item_cuestionario_id_sesion_cuestionario_orden_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX item_cuestionario_id_sesion_cuestionario_orden_key ON public.item_cuestionario USING btree (id_sesion_cuestionario, orden);


--
-- Name: item_cuestionario_id_version_pregunta_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX item_cuestionario_id_version_pregunta_idx ON public.item_cuestionario USING btree (id_version_pregunta);


--
-- Name: lote_importacion_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX lote_importacion_estado_idx ON public.lote_importacion USING btree (estado);


--
-- Name: lote_importacion_id_usuario_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX lote_importacion_id_usuario_idx ON public.lote_importacion USING btree (id_usuario);


--
-- Name: matricula_aula_id_aula_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX matricula_aula_id_aula_estado_idx ON public.matricula_aula USING btree (id_aula, estado);


--
-- Name: matricula_aula_id_aula_id_estudiante_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX matricula_aula_id_aula_id_estudiante_key ON public.matricula_aula USING btree (id_aula, id_estudiante);


--
-- Name: matricula_aula_id_estudiante_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX matricula_aula_id_estudiante_idx ON public.matricula_aula USING btree (id_estudiante);


--
-- Name: modalidad_evaluacion_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX modalidad_evaluacion_codigo_key ON public.modalidad_evaluacion USING btree (codigo);


--
-- Name: nivel_dificultad_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX nivel_dificultad_codigo_key ON public.nivel_dificultad USING btree (codigo);


--
-- Name: nivel_dificultad_valor_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX nivel_dificultad_valor_key ON public.nivel_dificultad USING btree (valor);


--
-- Name: opcion_recurso_id_recurso_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX opcion_recurso_id_recurso_idx ON public.opcion_recurso USING btree (id_recurso);


--
-- Name: opcion_respuesta_id_conjunto_opciones_letra_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX opcion_respuesta_id_conjunto_opciones_letra_key ON public.opcion_respuesta USING btree (id_conjunto_opciones, letra);


--
-- Name: opcion_respuesta_id_conjunto_opciones_orden_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX opcion_respuesta_id_conjunto_opciones_orden_key ON public.opcion_respuesta USING btree (id_conjunto_opciones, orden);


--
-- Name: plantilla_evaluacion_id_modalidad_activa_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX plantilla_evaluacion_id_modalidad_activa_idx ON public.plantilla_evaluacion USING btree (id_modalidad, activa);


--
-- Name: plantilla_evaluacion_nombre_version_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX plantilla_evaluacion_nombre_version_key ON public.plantilla_evaluacion USING btree (nombre, version);


--
-- Name: pregunta_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX pregunta_codigo_key ON public.pregunta USING btree (codigo);


--
-- Name: pregunta_id_creada_por_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX pregunta_id_creada_por_idx ON public.pregunta USING btree (id_creada_por);


--
-- Name: prueba_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX prueba_codigo_key ON public.prueba USING btree (codigo);


--
-- Name: prueba_nombre_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX prueba_nombre_key ON public.prueba USING btree (nombre);


--
-- Name: recurso_multimedia_tipo_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX recurso_multimedia_tipo_idx ON public.recurso_multimedia USING btree (tipo);


--
-- Name: respuesta_intento_id_intento_id_item_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX respuesta_intento_id_intento_id_item_key ON public.respuesta_intento USING btree (id_intento, id_item);


--
-- Name: respuesta_intento_id_item_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX respuesta_intento_id_item_idx ON public.respuesta_intento USING btree (id_item);


--
-- Name: respuesta_intento_id_opcion_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX respuesta_intento_id_opcion_idx ON public.respuesta_intento USING btree (id_opcion);


--
-- Name: rol_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX rol_codigo_key ON public.rol USING btree (codigo);


--
-- Name: servicio_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX servicio_codigo_key ON public.servicio USING btree (codigo);


--
-- Name: sesion_cuestionario_id_cuestionario_numero_sesion_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX sesion_cuestionario_id_cuestionario_numero_sesion_key ON public.sesion_cuestionario USING btree (id_cuestionario, numero_sesion);


--
-- Name: sesion_cuestionario_id_cuestionario_orden_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX sesion_cuestionario_id_cuestionario_orden_key ON public.sesion_cuestionario USING btree (id_cuestionario, orden);


--
-- Name: sesion_refresco_fecha_expiracion_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX sesion_refresco_fecha_expiracion_idx ON public.sesion_refresco USING btree (fecha_expiracion);


--
-- Name: sesion_refresco_id_usuario_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX sesion_refresco_id_usuario_idx ON public.sesion_refresco USING btree (id_usuario);


--
-- Name: sesion_refresco_token_hash_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX sesion_refresco_token_hash_key ON public.sesion_refresco USING btree (token_hash);


--
-- Name: solicitud_acceso_institucional_correo_institucional_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX solicitud_acceso_institucional_correo_institucional_idx ON public.solicitud_acceso_institucional USING btree (correo_institucional);


--
-- Name: solicitud_acceso_institucional_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX solicitud_acceso_institucional_estado_idx ON public.solicitud_acceso_institucional USING btree (estado);


--
-- Name: solicitud_acceso_institucional_fecha_creacion_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX solicitud_acceso_institucional_fecha_creacion_idx ON public.solicitud_acceso_institucional USING btree (fecha_creacion);


--
-- Name: solicitud_servicio_id_servicio_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX solicitud_servicio_id_servicio_idx ON public.solicitud_servicio USING btree (id_servicio);


--
-- Name: tarea_id_evidencia_activa_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX tarea_id_evidencia_activa_idx ON public.tarea USING btree (id_evidencia, activa);


--
-- Name: tarea_id_evidencia_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX tarea_id_evidencia_codigo_key ON public.tarea USING btree (id_evidencia, codigo);


--
-- Name: tema_id_componente_activo_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX tema_id_componente_activo_idx ON public.tema USING btree (id_componente, activo);


--
-- Name: tema_id_componente_nombre_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX tema_id_componente_nombre_key ON public.tema USING btree (id_componente, nombre);


--
-- Name: tipo_pregunta_codigo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX tipo_pregunta_codigo_key ON public.tipo_pregunta USING btree (codigo);


--
-- Name: usuario_correo_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX usuario_correo_key ON public.usuario USING btree (lower(correo));


--
-- Name: usuario_google_sub_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX usuario_google_sub_key ON public.usuario USING btree (google_sub) WHERE (google_sub IS NOT NULL);


--
-- Name: usuario_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX usuario_estado_idx ON public.usuario USING btree (estado);


--
-- Name: usuario_id_rol_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX usuario_id_rol_idx ON public.usuario USING btree (id_rol);


--
-- Name: usuario_institucion_id_institucion_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX usuario_institucion_id_institucion_estado_idx ON public.usuario_institucion USING btree (id_institucion, estado);


--
-- Name: usuario_institucion_id_institucion_id_usuario_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX usuario_institucion_id_institucion_id_usuario_key ON public.usuario_institucion USING btree (id_institucion, id_usuario);


--
-- Name: usuario_institucion_id_rol_institucional_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX usuario_institucion_id_rol_institucional_idx ON public.usuario_institucion USING btree (id_rol_institucional);


--
-- Name: usuario_institucion_id_usuario_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX usuario_institucion_id_usuario_idx ON public.usuario_institucion USING btree (id_usuario);


--
-- Name: version_estimulo_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_estimulo_estado_idx ON public.version_estimulo USING btree (estado);


--
-- Name: version_estimulo_id_estimulo_numero_version_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX version_estimulo_id_estimulo_numero_version_key ON public.version_estimulo USING btree (id_estimulo, numero_version);


--
-- Name: version_estimulo_recurso_id_recurso_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_estimulo_recurso_id_recurso_idx ON public.version_estimulo_recurso USING btree (id_recurso);


--
-- Name: version_pregunta_estado_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_estado_idx ON public.version_pregunta USING btree (estado);


--
-- Name: version_pregunta_id_dificultad_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_id_dificultad_idx ON public.version_pregunta USING btree (id_dificultad);


--
-- Name: version_pregunta_id_lote_importacion_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_id_lote_importacion_idx ON public.version_pregunta USING btree (id_lote_importacion);


--
-- Name: version_pregunta_id_pregunta_numero_version_key; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE UNIQUE INDEX version_pregunta_id_pregunta_numero_version_key ON public.version_pregunta USING btree (id_pregunta, numero_version);


--
-- Name: version_pregunta_id_tarea_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_id_tarea_idx ON public.version_pregunta USING btree (id_tarea);


--
-- Name: version_pregunta_id_tipo_pregunta_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_id_tipo_pregunta_idx ON public.version_pregunta USING btree (id_tipo_pregunta);


--
-- Name: version_pregunta_recurso_id_recurso_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_recurso_id_recurso_idx ON public.version_pregunta_recurso USING btree (id_recurso);


--
-- Name: version_pregunta_tema_id_tema_idx; Type: INDEX; Schema: public; Owner: preicfes_app
--

CREATE INDEX version_pregunta_tema_id_tema_idx ON public.version_pregunta_tema USING btree (id_tema);


--
-- Name: intento_asignado tr_validar_intento_asignado; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_intento_asignado BEFORE INSERT OR UPDATE OF id_intento, id_asignacion ON public.intento_asignado FOR EACH ROW EXECUTE FUNCTION public.fn_validar_intento_asignado();


--
-- Name: intento_libre tr_validar_intento_libre; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_intento_libre BEFORE INSERT OR UPDATE OF id_intento, id_cuestionario ON public.intento_libre FOR EACH ROW EXECUTE FUNCTION public.fn_validar_intento_libre();


--
-- Name: usuario tr_normalizar_correo; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_normalizar_correo BEFORE INSERT OR UPDATE OF correo ON public.usuario FOR EACH ROW EXECUTE FUNCTION public.fn_normalizar_correo();


--
-- Name: clave_respuesta tr_validar_clave_respuesta; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_clave_respuesta BEFORE INSERT OR UPDATE OF id_version_pregunta, id_opcion ON public.clave_respuesta FOR EACH ROW EXECUTE FUNCTION public.fn_validar_clave_respuesta();


--
-- Name: asignacion_aula tr_validar_creador_asignacion; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_creador_asignacion BEFORE INSERT OR UPDATE OF id_aula, id_creada_por ON public.asignacion_aula FOR EACH ROW EXECUTE FUNCTION public.fn_validar_creador_asignacion();


--
-- Name: matricula_aula tr_validar_estudiante_matricula; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_estudiante_matricula BEFORE INSERT OR UPDATE OF id_estudiante ON public.matricula_aula FOR EACH ROW EXECUTE FUNCTION public.fn_validar_estudiante_matricula();


--
-- Name: respuesta_intento tr_validar_opcion_respuesta_intento; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_opcion_respuesta_intento BEFORE INSERT OR UPDATE OF id_item, id_opcion ON public.respuesta_intento FOR EACH ROW EXECUTE FUNCTION public.fn_validar_opcion_respuesta_intento();


--
-- Name: aula tr_validar_profesor_aula; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_profesor_aula BEFORE INSERT OR UPDATE OF id_institucion, id_profesor ON public.aula FOR EACH ROW EXECUTE FUNCTION public.fn_validar_profesor_aula();


--
-- Name: usuario_institucion tr_validar_usuario_institucion; Type: TRIGGER; Schema: public; Owner: preicfes_app
--

CREATE TRIGGER tr_validar_usuario_institucion BEFORE INSERT OR UPDATE OF id_usuario, id_institucion, estado ON public.usuario_institucion FOR EACH ROW EXECUTE FUNCTION public.fn_validar_usuario_institucion();


--
-- Name: afirmacion afirmacion_id_competencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.afirmacion
    ADD CONSTRAINT afirmacion_id_competencia_fkey FOREIGN KEY (id_competencia) REFERENCES public.competencia(id_competencia) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asignacion_aula asignacion_aula_id_aula_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.asignacion_aula
    ADD CONSTRAINT asignacion_aula_id_aula_fkey FOREIGN KEY (id_aula) REFERENCES public.aula(id_aula) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asignacion_aula asignacion_aula_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.asignacion_aula
    ADD CONSTRAINT asignacion_aula_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: asignacion_aula asignacion_aula_id_cuestionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.asignacion_aula
    ADD CONSTRAINT asignacion_aula_id_cuestionario_fkey FOREIGN KEY (id_cuestionario) REFERENCES public.cuestionario(id_cuestionario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: auditoria auditoria_id_institucion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_id_institucion_fkey FOREIGN KEY (id_institucion) REFERENCES public.institucion(id_institucion) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: auditoria auditoria_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: aula aula_id_institucion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.aula
    ADD CONSTRAINT aula_id_institucion_fkey FOREIGN KEY (id_institucion) REFERENCES public.institucion(id_institucion) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: aula aula_id_profesor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.aula
    ADD CONSTRAINT aula_id_profesor_fkey FOREIGN KEY (id_profesor) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: clave_respuesta clave_respuesta_id_opcion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.clave_respuesta
    ADD CONSTRAINT clave_respuesta_id_opcion_fkey FOREIGN KEY (id_opcion) REFERENCES public.opcion_respuesta(id_opcion) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: clave_respuesta clave_respuesta_id_version_pregunta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.clave_respuesta
    ADD CONSTRAINT clave_respuesta_id_version_pregunta_fkey FOREIGN KEY (id_version_pregunta) REFERENCES public.version_pregunta(id_version_pregunta) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: competencia competencia_id_prueba_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.competencia
    ADD CONSTRAINT competencia_id_prueba_fkey FOREIGN KEY (id_prueba) REFERENCES public.prueba(id_prueba) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: componente componente_id_prueba_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.componente
    ADD CONSTRAINT componente_id_prueba_fkey FOREIGN KEY (id_prueba) REFERENCES public.prueba(id_prueba) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: conjunto_opciones conjunto_opciones_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.conjunto_opciones
    ADD CONSTRAINT conjunto_opciones_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cuestionario cuestionario_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.cuestionario
    ADD CONSTRAINT cuestionario_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: cuestionario cuestionario_id_plantilla_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.cuestionario
    ADD CONSTRAINT cuestionario_id_plantilla_fkey FOREIGN KEY (id_plantilla) REFERENCES public.plantilla_evaluacion(id_plantilla) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: detalle_plantilla detalle_plantilla_id_plantilla_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.detalle_plantilla
    ADD CONSTRAINT detalle_plantilla_id_plantilla_fkey FOREIGN KEY (id_plantilla) REFERENCES public.plantilla_evaluacion(id_plantilla) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: detalle_plantilla detalle_plantilla_id_prueba_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.detalle_plantilla
    ADD CONSTRAINT detalle_plantilla_id_prueba_fkey FOREIGN KEY (id_prueba) REFERENCES public.prueba(id_prueba) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: error_importacion error_importacion_id_lote_importacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.error_importacion
    ADD CONSTRAINT error_importacion_id_lote_importacion_fkey FOREIGN KEY (id_lote_importacion) REFERENCES public.lote_importacion(id_lote_importacion) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: estimulo estimulo_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.estimulo
    ADD CONSTRAINT estimulo_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: evidencia evidencia_id_afirmacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.evidencia
    ADD CONSTRAINT evidencia_id_afirmacion_fkey FOREIGN KEY (id_afirmacion) REFERENCES public.afirmacion(id_afirmacion) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: institucion institucion_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.institucion
    ADD CONSTRAINT institucion_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: intento_asignado intento_asignado_id_asignacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento_asignado
    ADD CONSTRAINT intento_asignado_id_asignacion_fkey FOREIGN KEY (id_asignacion) REFERENCES public.asignacion_aula(id_asignacion) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: intento_asignado intento_asignado_id_intento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento_asignado
    ADD CONSTRAINT intento_asignado_id_intento_fkey FOREIGN KEY (id_intento) REFERENCES public.intento(id_intento) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: intento intento_id_estudiante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento
    ADD CONSTRAINT intento_id_estudiante_fkey FOREIGN KEY (id_estudiante) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: intento_libre intento_libre_id_cuestionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento_libre
    ADD CONSTRAINT intento_libre_id_cuestionario_fkey FOREIGN KEY (id_cuestionario) REFERENCES public.cuestionario(id_cuestionario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: intento_libre intento_libre_id_intento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.intento_libre
    ADD CONSTRAINT intento_libre_id_intento_fkey FOREIGN KEY (id_intento) REFERENCES public.intento(id_intento) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invitacion_aula invitacion_aula_id_aula_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.invitacion_aula
    ADD CONSTRAINT invitacion_aula_id_aula_fkey FOREIGN KEY (id_aula) REFERENCES public.aula(id_aula) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invitacion_aula invitacion_aula_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.invitacion_aula
    ADD CONSTRAINT invitacion_aula_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: item_cuestionario item_cuestionario_id_sesion_cuestionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.item_cuestionario
    ADD CONSTRAINT item_cuestionario_id_sesion_cuestionario_fkey FOREIGN KEY (id_sesion_cuestionario) REFERENCES public.sesion_cuestionario(id_sesion_cuestionario) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: item_cuestionario item_cuestionario_id_version_pregunta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.item_cuestionario
    ADD CONSTRAINT item_cuestionario_id_version_pregunta_fkey FOREIGN KEY (id_version_pregunta) REFERENCES public.version_pregunta(id_version_pregunta) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: lote_importacion lote_importacion_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.lote_importacion
    ADD CONSTRAINT lote_importacion_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: matricula_aula matricula_aula_id_aula_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.matricula_aula
    ADD CONSTRAINT matricula_aula_id_aula_fkey FOREIGN KEY (id_aula) REFERENCES public.aula(id_aula) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: matricula_aula matricula_aula_id_estudiante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.matricula_aula
    ADD CONSTRAINT matricula_aula_id_estudiante_fkey FOREIGN KEY (id_estudiante) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: matricula_aula matricula_aula_id_invitacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.matricula_aula
    ADD CONSTRAINT matricula_aula_id_invitacion_fkey FOREIGN KEY (id_invitacion) REFERENCES public.invitacion_aula(id_invitacion) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: opcion_recurso opcion_recurso_id_opcion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.opcion_recurso
    ADD CONSTRAINT opcion_recurso_id_opcion_fkey FOREIGN KEY (id_opcion) REFERENCES public.opcion_respuesta(id_opcion) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: opcion_recurso opcion_recurso_id_recurso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.opcion_recurso
    ADD CONSTRAINT opcion_recurso_id_recurso_fkey FOREIGN KEY (id_recurso) REFERENCES public.recurso_multimedia(id_recurso) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: opcion_respuesta opcion_respuesta_id_conjunto_opciones_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.opcion_respuesta
    ADD CONSTRAINT opcion_respuesta_id_conjunto_opciones_fkey FOREIGN KEY (id_conjunto_opciones) REFERENCES public.conjunto_opciones(id_conjunto_opciones) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: plantilla_evaluacion plantilla_evaluacion_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.plantilla_evaluacion
    ADD CONSTRAINT plantilla_evaluacion_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: plantilla_evaluacion plantilla_evaluacion_id_modalidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.plantilla_evaluacion
    ADD CONSTRAINT plantilla_evaluacion_id_modalidad_fkey FOREIGN KEY (id_modalidad) REFERENCES public.modalidad_evaluacion(id_modalidad) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: pregunta pregunta_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.pregunta
    ADD CONSTRAINT pregunta_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: recurso_multimedia recurso_multimedia_id_subido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.recurso_multimedia
    ADD CONSTRAINT recurso_multimedia_id_subido_por_fkey FOREIGN KEY (id_subido_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: respuesta_intento respuesta_intento_id_intento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.respuesta_intento
    ADD CONSTRAINT respuesta_intento_id_intento_fkey FOREIGN KEY (id_intento) REFERENCES public.intento(id_intento) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: respuesta_intento respuesta_intento_id_item_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.respuesta_intento
    ADD CONSTRAINT respuesta_intento_id_item_fkey FOREIGN KEY (id_item) REFERENCES public.item_cuestionario(id_item) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: respuesta_intento respuesta_intento_id_opcion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.respuesta_intento
    ADD CONSTRAINT respuesta_intento_id_opcion_fkey FOREIGN KEY (id_opcion) REFERENCES public.opcion_respuesta(id_opcion) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sesion_cuestionario sesion_cuestionario_id_cuestionario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.sesion_cuestionario
    ADD CONSTRAINT sesion_cuestionario_id_cuestionario_fkey FOREIGN KEY (id_cuestionario) REFERENCES public.cuestionario(id_cuestionario) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sesion_refresco sesion_refresco_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.sesion_refresco
    ADD CONSTRAINT sesion_refresco_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: solicitud_acceso_institucional solicitud_acceso_institucional_id_institucion_creada_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.solicitud_acceso_institucional
    ADD CONSTRAINT solicitud_acceso_institucional_id_institucion_creada_fkey FOREIGN KEY (id_institucion_creada) REFERENCES public.institucion(id_institucion) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solicitud_acceso_institucional solicitud_acceso_institucional_id_revisada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.solicitud_acceso_institucional
    ADD CONSTRAINT solicitud_acceso_institucional_id_revisada_por_fkey FOREIGN KEY (id_revisada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: solicitud_servicio solicitud_servicio_id_servicio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.solicitud_servicio
    ADD CONSTRAINT solicitud_servicio_id_servicio_fkey FOREIGN KEY (id_servicio) REFERENCES public.servicio(id_servicio) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: solicitud_servicio solicitud_servicio_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.solicitud_servicio
    ADD CONSTRAINT solicitud_servicio_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitud_acceso_institucional(id_solicitud) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tarea tarea_id_evidencia_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.tarea
    ADD CONSTRAINT tarea_id_evidencia_fkey FOREIGN KEY (id_evidencia) REFERENCES public.evidencia(id_evidencia) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tema tema_id_componente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.tema
    ADD CONSTRAINT tema_id_componente_fkey FOREIGN KEY (id_componente) REFERENCES public.componente(id_componente) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: usuario usuario_id_rol_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.rol(id_rol) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: usuario_institucion usuario_institucion_id_institucion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.usuario_institucion
    ADD CONSTRAINT usuario_institucion_id_institucion_fkey FOREIGN KEY (id_institucion) REFERENCES public.institucion(id_institucion) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: usuario_institucion usuario_institucion_id_rol_institucional_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.usuario_institucion
    ADD CONSTRAINT usuario_institucion_id_rol_institucional_fkey FOREIGN KEY (id_rol_institucional) REFERENCES public.rol(id_rol) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: usuario_institucion usuario_institucion_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.usuario_institucion
    ADD CONSTRAINT usuario_institucion_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_estimulo version_estimulo_id_estimulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_estimulo
    ADD CONSTRAINT version_estimulo_id_estimulo_fkey FOREIGN KEY (id_estimulo) REFERENCES public.estimulo(id_estimulo) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_estimulo version_estimulo_id_fuente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_estimulo
    ADD CONSTRAINT version_estimulo_id_fuente_fkey FOREIGN KEY (id_fuente) REFERENCES public.fuente_contenido(id_fuente) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: version_estimulo_recurso version_estimulo_recurso_id_recurso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_estimulo_recurso
    ADD CONSTRAINT version_estimulo_recurso_id_recurso_fkey FOREIGN KEY (id_recurso) REFERENCES public.recurso_multimedia(id_recurso) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_estimulo_recurso version_estimulo_recurso_id_version_estimulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_estimulo_recurso
    ADD CONSTRAINT version_estimulo_recurso_id_version_estimulo_fkey FOREIGN KEY (id_version_estimulo) REFERENCES public.version_estimulo(id_version_estimulo) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: version_pregunta version_pregunta_id_conjunto_opciones_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_conjunto_opciones_fkey FOREIGN KEY (id_conjunto_opciones) REFERENCES public.conjunto_opciones(id_conjunto_opciones) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta version_pregunta_id_creada_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_creada_por_fkey FOREIGN KEY (id_creada_por) REFERENCES public.usuario(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta version_pregunta_id_dificultad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_dificultad_fkey FOREIGN KEY (id_dificultad) REFERENCES public.nivel_dificultad(id_dificultad) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta version_pregunta_id_fuente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_fuente_fkey FOREIGN KEY (id_fuente) REFERENCES public.fuente_contenido(id_fuente) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: version_pregunta version_pregunta_id_lote_importacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_lote_importacion_fkey FOREIGN KEY (id_lote_importacion) REFERENCES public.lote_importacion(id_lote_importacion) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: version_pregunta version_pregunta_id_pregunta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_pregunta_fkey FOREIGN KEY (id_pregunta) REFERENCES public.pregunta(id_pregunta) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta version_pregunta_id_tarea_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_tarea_fkey FOREIGN KEY (id_tarea) REFERENCES public.tarea(id_tarea) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta version_pregunta_id_tipo_pregunta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_tipo_pregunta_fkey FOREIGN KEY (id_tipo_pregunta) REFERENCES public.tipo_pregunta(id_tipo_pregunta) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta version_pregunta_id_version_estimulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta
    ADD CONSTRAINT version_pregunta_id_version_estimulo_fkey FOREIGN KEY (id_version_estimulo) REFERENCES public.version_estimulo(id_version_estimulo) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta_recurso version_pregunta_recurso_id_recurso_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta_recurso
    ADD CONSTRAINT version_pregunta_recurso_id_recurso_fkey FOREIGN KEY (id_recurso) REFERENCES public.recurso_multimedia(id_recurso) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta_recurso version_pregunta_recurso_id_version_pregunta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta_recurso
    ADD CONSTRAINT version_pregunta_recurso_id_version_pregunta_fkey FOREIGN KEY (id_version_pregunta) REFERENCES public.version_pregunta(id_version_pregunta) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: version_pregunta_tema version_pregunta_tema_id_tema_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta_tema
    ADD CONSTRAINT version_pregunta_tema_id_tema_fkey FOREIGN KEY (id_tema) REFERENCES public.tema(id_tema) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: version_pregunta_tema version_pregunta_tema_id_version_pregunta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: preicfes_app
--

ALTER TABLE ONLY public.version_pregunta_tema
    ADD CONSTRAINT version_pregunta_tema_id_version_pregunta_fkey FOREIGN KEY (id_version_pregunta) REFERENCES public.version_pregunta(id_version_pregunta) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict DMMAktfoX6lVeqKtsGfQkVR5GVhHuknE9OZyTEPNAEVcVEHvWqlihuprAaLiEWe

