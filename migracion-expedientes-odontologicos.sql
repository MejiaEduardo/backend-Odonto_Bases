-- =====================================================================
--  MIGRACIÓN: expedientes de prueba con contenido odontológico
-- =====================================================================
--
--  MOTIVO
--  ------
--  Los datos de ejemplo venían de una clínica médica general. Ya se
--  corrigieron los servicios y las especialidades, pero los EXPEDIENTES
--  quedaron con contenido que no tiene nada que ver con odontología:
--
--      "Dolor de pecho"          -> "Hipertensión arterial"
--      "Dificultad respiratoria" -> "Crisis asmática leve"
--      "Control glucémico"       -> "Ajuste de metformina"
--      "Dolor de cabeza intenso" -> "Migraña crónica / Sumatriptán"
--      "Dolor abdominal"         -> "Gastritis crónica / Omeprazol"
--
--  Al abrir un expediente en la demostración, es la primera incoherencia
--  que salta a la vista.
--
--  Esta migración los reemplaza por diagnósticos dentales reales: caries,
--  pulpitis, periodontitis, bruxismo, recesión gingival.
--
--  NOTA: se conservan a propósito las enfermedades sistémicas en los
--  antecedentes (por ejemplo la diabetes del paciente 11 con su
--  metformina). En una ficha odontológica eso SÍ se registra, porque
--  cambia el tratamiento: cicatrización lenta, cuidado en extracciones.
--
--  Correr:
--      docker cp migracion-expedientes-odontologicos.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-expedientes-odontologicos.sql
--
--  Es idempotente: se puede correr las veces que haga falta.
--  Solo toca los expedientes 1..8 y los detalles 1..10, que son los del
--  seed. Nada de lo que hayan capturado a mano se pierde.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  1. Antecedentes de los expedientes del seed
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _exp (id INT, alergias TEXT, enfermedades TEXT, medicamentos TEXT, observaciones TEXT)
  ON COMMIT DROP;
INSERT INTO _exp VALUES
  (1, 'Penicilina',                'Enfermedad periodontal',              'Enjuague de clorhexidina', 'Requiere limpiezas cada 6 meses'),
  (2, 'Ninguna',                   'Ninguna',                             'Ninguno',                  'Sin antecedentes relevantes'),
  (3, 'Látex',                     'Bruxismo',                            'Ninguno',                  'Usa placa de descarga nocturna'),
  (4, 'Ninguna',                   'Diabetes tipo 2',                     'Metformina 850mg',         'Diabético: cicatrización lenta, cuidado en extracciones'),
  (5, 'Anestesia con epinefrina',  'Ninguna',                             'Ninguno',                  'Usar anestésico sin vasoconstrictor'),
  (6, 'Ninguna',                   'Sensibilidad dentinaria',             'Pasta desensibilizante',   'Evitar bebidas muy frías'),
  (7, 'Aspirina',                  'Gingivitis crónica',                  'Ninguno',                  'Refuerzo de técnica de cepillado'),
  (8, 'Ninguna',                   'Ninguna',                             'Ninguno',                  'Paciente sano, chequeo anual');

UPDATE "Expediente" e
SET alergias      = t.alergias,
    enfermedades  = t.enfermedades,
    medicamentos  = t.medicamentos,
    observaciones = t.observaciones,
    "updatedAt"   = CURRENT_TIMESTAMP
FROM _exp t
WHERE e.id = t.id;

-- ---------------------------------------------------------------------
--  2. Consultas del seed
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _det (id INT, motivo TEXT, diagnostico TEXT, tratamiento TEXT, plan TEXT)
  ON COMMIT DROP;
INSERT INTO _det VALUES
  (1,  'Sangrado de encías al cepillarse',          'Periodontitis leve, cálculo subgingival',      'Raspado y alisado radicular por cuadrantes', 'Control periodontal en 1 mes'),
  (2,  'Chequeo de rutina',                         'Sin hallazgos relevantes',                     'Profilaxis y aplicación de flúor',           'Chequeo anual'),
  (3,  'Desgaste en molares y dolor mandibular',    'Bruxismo nocturno',                            'Ajuste de placa de descarga',                'Revisión del desgaste en 3 meses'),
  (4,  'Molestia al masticar del lado derecho',     'Caries oclusal en pieza 46',                   'Resina compuesta en pieza 46',               'Control en 6 meses'),
  (5,  'Dolor intenso y espontáneo en pieza 36',    'Pulpitis irreversible',                        'Inicio de tratamiento de conductos',         'Segunda sesión de endodoncia en 8 días'),
  (6,  'Sensibilidad al frío en el sector anterior','Recesión gingival con exposición dentinaria',  'Aplicación de barniz desensibilizante',      'Reevaluar en 1 mes'),
  (7,  'Inflamación de encías y mal aliento',       'Gingivitis por placa bacteriana',              'Profilaxis y enjuague de clorhexidina',      'Refuerzo de higiene, control en 3 meses'),
  (8,  'Chequeo anual',                             'Paciente sano',                                'Ninguno',                                    'Próximo chequeo en 1 año'),
  (9,  'Control periodontal',                       'Encías sin sangrado, evolución favorable',     'Pulido y refuerzo de higiene',               'Mantenimiento cada 6 meses'),
  (10, 'Control de restauración',                   'Resina en buen estado, sin filtración',        'Ninguno',                                    'Control anual');

UPDATE "ExpedienteDetalle" d
SET motivo            = t.motivo,
    diagnostico       = t.diagnostico,
    tratamiento       = t.tratamiento,
    "planTratamiento" = t.plan,
    "updatedAt"       = CURRENT_TIMESTAMP
FROM _det t
WHERE d.id = t.id;

-- ---------------------------------------------------------------------
--  3. Borrar los registros de prueba con texto inapropiado
--
--     Se busca por CONTENIDO y no por id, para que siga funcionando
--     aunque los identificadores hayan cambiado. Los textos escritos a
--     mano mientras se probaba la aplicación no deberían quedar en un
--     proyecto que se publica.
-- ---------------------------------------------------------------------
DELETE FROM "ExpedienteDetalle"
WHERE LOWER(COALESCE(motivo, ''))      LIKE '%desgarre de ano%'
   OR LOWER(COALESCE(diagnostico, '')) LIKE '%amputacion%'
   OR LOWER(COALESCE(diagnostico, '')) LIKE '%amputación%';

COMMIT;

-- ---------------------------------------------------------------------
--  Comprobación
-- ---------------------------------------------------------------------
\echo ''
\echo '--- Consultas registradas (todas deben ser dentales) ---'
SELECT d.id, p.nombre || ' ' || p.apellido AS paciente,
       d.motivo, d.diagnostico
FROM "ExpedienteDetalle" d
JOIN "Expediente" e ON e.id = d."expedienteId"
JOIN "Persona" p    ON p.id = e."pacienteId"
ORDER BY d.id;

\echo ''
\echo '--- Antecedentes de los expedientes ---'
SELECT e.id, p.nombre || ' ' || p.apellido AS paciente,
       e.alergias, e.enfermedades, e.observaciones
FROM "Expediente" e
JOIN "Persona" p ON p.id = e."pacienteId"
ORDER BY e.id;

\echo ''
\echo '--- Quedo algun termino que no sea odontologico? (deberia dar 0) ---'
SELECT COUNT(*) AS registros_sospechosos
FROM "ExpedienteDetalle"
WHERE motivo || ' ' || COALESCE(diagnostico, '') || ' ' || COALESCE(tratamiento, '')
      ~* '(hipertensi|asma|salbutamol|gastritis|omeprazol|migra|sumatript|glucémico|mariscos|desgarre|amputa)';
