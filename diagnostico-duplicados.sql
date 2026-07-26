-- =====================================================================
--  DIAGNÓSTICO de pacientes duplicados  (SOLO LECTURA, no cambia nada)
-- =====================================================================
--
--  Correr:
--      docker cp diagnostico-duplicados.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/diagnostico-duplicados.sql
--
--  Pegame la salida y con eso decidimos cómo fusionar sin perder datos.
-- =====================================================================

\echo '========== 1. PERSONAS CON EL MISMO NOMBRE =========='
SELECT
  LOWER(TRIM(p.nombre)) || ' ' || LOWER(TRIM(p.apellido)) AS persona,
  COUNT(*)                                                AS veces,
  array_agg(p.id ORDER BY p.id)                           AS ids_persona,
  array_agg(COALESCE(p.dni, '(sin dni)') ORDER BY p.id)   AS dnis,
  array_agg(COALESCE(u.correo, '(sin usuario)') ORDER BY p.id) AS correos
FROM "Persona" p
LEFT JOIN "User" u ON u."personaId" = p.id
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY veces DESC, persona;

\echo ''
\echo '========== 2. DNI REPETIDO (deberia ser imposible) =========='
SELECT dni, COUNT(*) AS veces, array_agg(id ORDER BY id) AS ids_persona
FROM "Persona"
WHERE dni IS NOT NULL AND TRIM(dni) <> ''
GROUP BY dni
HAVING COUNT(*) > 1;

\echo ''
\echo '========== 3. QUE TIENE COLGANDO CADA PERSONA DUPLICADA =========='
-- Para decidir cual conservar: la que tenga citas, consultas o facturas.
WITH dup AS (
  SELECT p.id
  FROM "Persona" p
  WHERE (LOWER(TRIM(p.nombre)), LOWER(TRIM(p.apellido))) IN (
    SELECT LOWER(TRIM(nombre)), LOWER(TRIM(apellido))
    FROM "Persona"
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
  )
)
SELECT
  p.id                                        AS persona_id,
  p.nombre || ' ' || p.apellido               AS nombre,
  COALESCE(p.dni, '—')                        AS dni,
  COALESCE(u.correo, '—')                     AS correo,
  e.id                                        AS expediente_id,
  (SELECT COUNT(*) FROM "ExpedienteDetalle" d WHERE d."expedienteId" = e.id) AS consultas,
  (SELECT COUNT(*) FROM "Cita" c WHERE c."pacienteId" = p.id)                AS citas,
  (SELECT COUNT(*) FROM "Factura" f
     JOIN "Cita" c2 ON c2.id = f."citaId" WHERE c2."pacienteId" = p.id)      AS facturas,
  p."createdAt"                               AS creado
FROM "Persona" p
JOIN dup        ON dup.id = p.id
LEFT JOIN "User" u       ON u."personaId" = p.id
LEFT JOIN "Expediente" e ON e."pacienteId" = p.id
ORDER BY LOWER(p.nombre), LOWER(p.apellido), p.id;

\echo ''
\echo '========== 4. DONDE QUEDO CADA CONSULTA GUARDADA =========='
SELECT
  d.id                          AS consulta_id,
  d."expedienteId",
  e."pacienteId",
  p.nombre || ' ' || p.apellido AS paciente,
  d.fecha,
  LEFT(COALESCE(d.motivo, ''), 40)      AS motivo,
  LEFT(COALESCE(d.diagnostico, ''), 40) AS diagnostico
FROM "ExpedienteDetalle" d
JOIN "Expediente" e ON e.id = d."expedienteId"
JOIN "Persona" p    ON p.id = e."pacienteId"
ORDER BY d.id DESC
LIMIT 30;

\echo ''
\echo '========== 5. EXPEDIENTES SIN NINGUNA CONSULTA =========='
SELECT e.id AS expediente_id, e."pacienteId", p.nombre || ' ' || p.apellido AS paciente
FROM "Expediente" e
JOIN "Persona" p ON p.id = e."pacienteId"
WHERE NOT EXISTS (SELECT 1 FROM "ExpedienteDetalle" d WHERE d."expedienteId" = e.id)
ORDER BY e.id;

\echo ''
\echo '========== 6. RESUMEN =========='
SELECT
  (SELECT COUNT(*) FROM "Persona")            AS personas,
  (SELECT COUNT(*) FROM "User")               AS usuarios,
  (SELECT COUNT(*) FROM "Expediente")         AS expedientes,
  (SELECT COUNT(*) FROM "ExpedienteDetalle")  AS consultas;
