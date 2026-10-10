/**
 * Columnas SQL con el contenido de una pregunta tal como lo ve quien la responde: opciones, estímulo y recursos.
 * Nunca incluye la clave de respuesta. Requiere `vp` (version_pregunta) en el FROM.
 */
export const studentQuestionContent = `
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', op.id_opcion, 'letra', op.letra, 'contenido', op.contenido,
              'recursos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rm.id_recurso, 'tipo', rm.tipo, 'url', rm.url,
                            'textoAlternativo', rm.texto_alternativo) ORDER BY orc.orden)
                           FROM opcion_recurso orc JOIN recurso_multimedia rm ON rm.id_recurso = orc.id_recurso
                          WHERE orc.id_opcion = op.id_opcion), '[]'::jsonb)) ORDER BY op.orden)
             FROM opcion_respuesta op WHERE op.id_conjunto_opciones = vp.id_conjunto_opciones), '[]'::jsonb) AS opciones,
  (SELECT jsonb_build_object('id', ve.id_version_estimulo, 'titulo', ve.titulo, 'contenido', ve.contenido,
            'recursos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rm.id_recurso, 'tipo', rm.tipo, 'url', rm.url,
                          'textoAlternativo', rm.texto_alternativo) ORDER BY ver.orden)
                         FROM version_estimulo_recurso ver JOIN recurso_multimedia rm ON rm.id_recurso = ver.id_recurso
                        WHERE ver.id_version_estimulo = ve.id_version_estimulo), '[]'::jsonb))
     FROM version_estimulo ve WHERE ve.id_version_estimulo = vp.id_version_estimulo) AS estimulo,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rm.id_recurso, 'tipo', rm.tipo, 'url', rm.url,
              'textoAlternativo', rm.texto_alternativo) ORDER BY vpr.orden)
             FROM version_pregunta_recurso vpr JOIN recurso_multimedia rm ON rm.id_recurso = vpr.id_recurso
            WHERE vpr.id_version_pregunta = vp.id_version_pregunta), '[]'::jsonb) AS recursos`;
