-- Activa el único usuario cargado en el dump. Cambia la contraseña antes de usarlo:
-- el acceso inicial queda deliberadamente bloqueado hasta establecer un hash Argon2 válido.
UPDATE public.usuario
   SET estado = 'INACTIVO', fecha_actualizacion = CURRENT_TIMESTAMP
 WHERE correo = 'demo@preicfes.local';

INSERT INTO public.servicio (id_servicio, codigo, nombre, descripcion, activo) VALUES
('a0000000-0000-4000-8000-000000000001', 'PLATAFORMA', 'Plataforma educativa', 'Acceso al entorno educativo institucional', true),
('a0000000-0000-4000-8000-000000000002', 'SIMULACROS', 'Simulacros ICFES', 'Evaluaciones y simulacros para preparación ICFES', true),
('a0000000-0000-4000-8000-000000000003', 'ANALITICA', 'Analítica académica', 'Seguimiento de resultados y progreso institucional', true)
ON CONFLICT DO NOTHING;