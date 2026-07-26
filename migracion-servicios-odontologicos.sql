-- =====================================================================
--  MIGRACIÓN: catálogo odontológico  (versión 2, tolerante al estado real)
-- =====================================================================
--
--  MOTIVO
--  ------
--  Los datos de ejemplo venían de una clínica médica general: Cardiología,
--  Ginecología, Electrocardiograma, Ecografía, Vacunación... Nada de eso
--  tiene sentido en una clínica odontológica.
--
--  POR QUÉ FALLÓ LA VERSIÓN 1
--  --------------------------
--  1. "Especialidad" tiene un índice UNIQUE sobre `nombre`
--     ("Especialidad_nombre_key"). Si ya existe una fila llamada
--     "Endodoncia", renombrar otra al mismo nombre revienta con
--     duplicate key y aborta toda la transacción.
--
--  2. Los servicios se pueden haber borrado desde la interfaz. Si falta el
--     id 2 o el 3, el INSERT en "ServicioEspecialidad" viola la llave
--     foránea.
--
--  CÓMO LO RESUELVE ESTA VERSIÓN
--  -----------------------------
--  * Fusiona los duplicados por nombre antes de renombrar (repunta las
--    referencias y borra el sobrante).
--  * Renombra todo a un nombre temporal único antes de asignar el
--    definitivo, para que el orden de los UPDATE no provoque choques.
--  * Inserta los servicios que falten en lugar de suponer que existen.
--  * Solo crea relaciones entre filas que existan de verdad.
--
--  Correr:
--      docker cp migracion-servicios-odontologicos.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-servicios-odontologicos.sql
--
--  Es idempotente: se puede correr las veces que haga falta.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  0. Catálogo objetivo, en tablas temporales
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _especialidades (id INT, nombre TEXT, descripcion TEXT) ON COMMIT DROP;
INSERT INTO _especialidades VALUES
  (1,  'Ortodoncia',           'Corrige la alineación de los dientes y la mordida.'),
  (2,  'Endodoncia',           'Trata las infecciones del nervio dental (conductos).'),
  (3,  'Periodoncia',          'Cuida las encías y los huesos que sostienen el diente.'),
  (4,  'Odontopediatría',      'Atención dental especializada en niños.'),
  (5,  'Rehabilitación Oral',  'Restaura dientes dañados o perdidos con prótesis.'),
  (6,  'Cirugía Maxilofacial', 'Operaciones de cara, mandíbula y extracción de cordales.'),
  (7,  'Implantología',        'Colocación de implantes dentales.'),
  (8,  'Odontología Estética', 'Mejora la apariencia visual de la sonrisa (carillas, blanqueamiento).'),
  (9,  'Patología Bucal',      'Diagnostica lesiones, aftas y enfermedades de la boca.'),
  (10, 'Odontología Forense',  'Identificación de personas mediante registros dentales.');

CREATE TEMP TABLE _servicios (id INT, nombre TEXT, descripcion TEXT, precio NUMERIC, especialidad INT) ON COMMIT DROP;
INSERT INTO _servicios VALUES
  (1,  'Consulta y diagnóstico dental',   'Evaluación clínica completa con plan de tratamiento.',        400,   9),
  (2,  'Limpieza dental (profilaxis)',    'Eliminación de placa y sarro, con pulido dental.',            800,   3),
  (3,  'Extracción de muela del juicio',  'Cirugía de terceros molares (cordales) con anestesia local.', 3500,  6),
  (4,  'Tratamiento de conductos',        'Endodoncia para salvar una pieza con el nervio infectado.',   4000,  2),
  (5,  'Colocación de brackets',          'Ortodoncia fija metálica. No incluye los controles mensuales.', 12000, 1),
  (6,  'Blanqueamiento dental',           'Aclarado del esmalte con gel activado por luz LED.',          2800,  8),
  (7,  'Sellantes y flúor (niños)',       'Prevención de caries en molares infantiles.',                 600,   4),
  (8,  'Corona dental',                   'Prótesis fija de porcelana sobre un diente restaurado.',      5500,  5),
  (9,  'Implante dental',                 'Colocación de implante de titanio con su corona.',            18000, 7),
  (10, 'Resina dental (empaste)',         'Restauración estética de una pieza con caries.',              900,   5);

-- ---------------------------------------------------------------------
--  1. Fusionar especialidades duplicadas por nombre
--     Si alguien creó "Endodoncia" con otro id, sus referencias pasan al
--     id canónico y la fila sobrante se elimina. Sin esto, el UNIQUE
--     sobre `nombre` haría fallar el renombrado.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS _dup_esp;
CREATE TEMP TABLE _dup_esp ON COMMIT DROP AS
SELECT e.id AS id_viejo, c.id AS id_canonico
FROM "Especialidad" e
JOIN _especialidades c
  ON LOWER(TRIM(e.nombre)) = LOWER(TRIM(c.nombre))
WHERE e.id <> c.id;

UPDATE "EspecialidadDoctor" ed
SET "especialidadId" = d.id_canonico
FROM _dup_esp d
WHERE ed."especialidadId" = d.id_viejo
  AND NOT EXISTS (
    SELECT 1 FROM "EspecialidadDoctor" x
    WHERE x."doctorId" = ed."doctorId" AND x."especialidadId" = d.id_canonico
  );

DELETE FROM "EspecialidadDoctor" ed
USING _dup_esp d WHERE ed."especialidadId" = d.id_viejo;

UPDATE "ServicioEspecialidad" se
SET "especialidadId" = d.id_canonico
FROM _dup_esp d
WHERE se."especialidadId" = d.id_viejo
  AND NOT EXISTS (
    SELECT 1 FROM "ServicioEspecialidad" x
    WHERE x."servicioId" = se."servicioId" AND x."especialidadId" = d.id_canonico
  );

DELETE FROM "ServicioEspecialidad" se
USING _dup_esp d WHERE se."especialidadId" = d.id_viejo;

DELETE FROM "Especialidad" e USING _dup_esp d WHERE e.id = d.id_viejo;

-- ---------------------------------------------------------------------
--  2. Nombres temporales únicos
--     Evita choques mientras se reasignan los nombres definitivos.
-- ---------------------------------------------------------------------
UPDATE "Especialidad" SET nombre = '__tmp_esp_' || id;

-- ---------------------------------------------------------------------
--  3. Aplicar el catálogo de especialidades
--     Se insertan las que falten y se actualizan las que existan.
-- ---------------------------------------------------------------------
INSERT INTO "Especialidad" (id, nombre, descripcion, "updatedAt")
SELECT c.id, c.nombre, c.descripcion, CURRENT_TIMESTAMP
FROM _especialidades c
WHERE NOT EXISTS (SELECT 1 FROM "Especialidad" e WHERE e.id = c.id);

UPDATE "Especialidad" e
SET nombre = c.nombre,
    descripcion = c.descripcion,
    "updatedAt" = CURRENT_TIMESTAMP
FROM _especialidades c
WHERE e.id = c.id;

-- Las que sobran (id > 10) recuperan un nombre legible en vez del temporal
UPDATE "Especialidad"
SET nombre = 'Especialidad ' || id
WHERE nombre LIKE '__tmp_esp_%';

-- Y se eliminan si nadie las usa
DELETE FROM "Especialidad" e
WHERE e.id > 10
  AND NOT EXISTS (SELECT 1 FROM "EspecialidadDoctor" ed WHERE ed."especialidadId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "ServicioEspecialidad" se WHERE se."especialidadId" = e.id);

-- ---------------------------------------------------------------------
--  4. Aplicar el catálogo de servicios
--     Igual que arriba: insertar los que falten, actualizar los que estén.
-- ---------------------------------------------------------------------
INSERT INTO "ServicioClinico" (id, nombre, descripcion, precio, activo, "updatedAt")
SELECT c.id, c.nombre, c.descripcion, c.precio, true, CURRENT_TIMESTAMP
FROM _servicios c
WHERE NOT EXISTS (SELECT 1 FROM "ServicioClinico" s WHERE s.id = c.id);

UPDATE "ServicioClinico" s
SET nombre = c.nombre,
    descripcion = c.descripcion,
    precio = c.precio,
    activo = true,
    "updatedAt" = CURRENT_TIMESTAMP
FROM _servicios c
WHERE s.id = c.id;

-- Los servicios de prueba se desactivan (no se borran: pueden tener citas)
UPDATE "ServicioClinico" SET activo = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE id > 10;

DELETE FROM "ServicioEspecialidad" se
WHERE se."servicioId" > 10
  AND NOT EXISTS (SELECT 1 FROM "Cita" c WHERE c."servicioId" = se."servicioId")
  AND NOT EXISTS (SELECT 1 FROM "DetalleFactura" df WHERE df."servicioId" = se."servicioId");

DELETE FROM "ServicioClinico" s
WHERE s.id > 10
  AND NOT EXISTS (SELECT 1 FROM "Cita" c WHERE c."servicioId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM "DetalleFactura" df WHERE df."servicioId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM "ServicioEspecialidad" se WHERE se."servicioId" = s.id);

-- ---------------------------------------------------------------------
--  5. Relación servicio → especialidad
--     Solo para filas que existan realmente en ambas tablas.
-- ---------------------------------------------------------------------
DELETE FROM "ServicioEspecialidad" WHERE "servicioId" BETWEEN 1 AND 10;

INSERT INTO "ServicioEspecialidad" ("servicioId", "especialidadId")
SELECT c.id, c.especialidad
FROM _servicios c
WHERE EXISTS (SELECT 1 FROM "ServicioClinico" s WHERE s.id = c.id)
  AND EXISTS (SELECT 1 FROM "Especialidad" e WHERE e.id = c.especialidad)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
--  6. Reajustar las secuencias
--     Si se insertaron ids explícitos, el contador queda atrasado y el
--     siguiente INSERT automático chocaría con una clave existente.
-- ---------------------------------------------------------------------
SELECT setval(pg_get_serial_sequence('"Especialidad"', 'id'),
              GREATEST((SELECT MAX(id) FROM "Especialidad"), 1));
SELECT setval(pg_get_serial_sequence('"ServicioClinico"', 'id'),
              GREATEST((SELECT MAX(id) FROM "ServicioClinico"), 1));

COMMIT;

-- ---------------------------------------------------------------------
--  Comprobación
-- ---------------------------------------------------------------------
SELECT id, nombre AS especialidad, descripcion
FROM "Especialidad" ORDER BY id;

SELECT s.id, s.nombre AS servicio, s.precio, s.activo,
       string_agg(e.nombre, ', ') AS especialidades
FROM "ServicioClinico" s
LEFT JOIN "ServicioEspecialidad" se ON se."servicioId" = s.id
LEFT JOIN "Especialidad" e ON e.id = se."especialidadId"
GROUP BY s.id, s.nombre, s.precio, s.activo
ORDER BY s.id;
