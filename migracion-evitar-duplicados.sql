-- =====================================================================
--  MIGRACIÓN: impedir pacientes duplicados
-- =====================================================================
--
--  EL PROBLEMA
--  -----------
--  En la lista de expedientes aparece "David Lopex" dos veces, con dos
--  ids de paciente distintos (21 y 22) y dos expedientes distintos (9 y
--  10). Son dos filas reales en "Persona", no un error de la consulta.
--
--  Por eso "el expediente que guardé no aparece": la consulta se guardó
--  en uno de los dos expedientes y se está mirando el otro.
--
--  POR QUÉ PASA
--  ------------
--  1. "Persona"."dni" está declarado como TEXT a secas, SIN restricción
--     UNIQUE. Nada a nivel de base impide dos personas con el mismo DNI.
--
--  2. La única defensa vive en el código de signup, y tiene dos huecos:
--       - solo comprueba el DNI `if (dni)`, así que quien se registra sin
--         DNI siempre crea una Persona nueva;
--       - la comprobación entera está dentro de `if (!isSocial)`, de modo
--         que el alta con Google la salta por completo.
--
--  3. "User"."correo" sí es único, pero eso no ayuda: la misma persona
--     con dos correos distintos genera dos Personas.
--
--  QUÉ HACE ESTA MIGRACIÓN
--  -----------------------
--  Pone la defensa donde no se puede esquivar: en la base.
--
--  NO fusiona ni borra nada. Los duplicados que ya existen se arreglan
--  aparte, después de mirar el diagnóstico, porque hay que decidir con
--  cuidado cuál fila conservar (la que tenga citas y consultas).
--
--  Correr:
--      docker cp migracion-evitar-duplicados.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-evitar-duplicados.sql
--
--  Es idempotente.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  1. Normalizar los DNI vacíos a NULL
--     Si hay filas con dni = '' (cadena vacía), el índice único las
--     consideraría iguales entre sí y la migración fallaría. En SQL el
--     "no tengo dato" se escribe NULL, no cadena vacía.
-- ---------------------------------------------------------------------
UPDATE "Persona"
SET dni = NULL
WHERE dni IS NOT NULL AND TRIM(dni) = '';

-- ---------------------------------------------------------------------
--  2. Índice único PARCIAL sobre el DNI
--
--     Es parcial (WHERE dni IS NOT NULL) por diseño: en PostgreSQL los
--     NULL nunca chocan entre sí en un índice único, pero dejarlo
--     explícito documenta la intención y mantiene el índice más pequeño.
--
--     Así, dos pacientes SIN DNI siguen pudiendo existir (recepción a
--     veces registra a alguien que no lleva la identidad encima), pero
--     dos con el MISMO DNI ya no.
--
--     Si esto falla, es que ya hay DNI repetidos: mirá el punto 2 del
--     diagnóstico y resolvelos antes de reintentar.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "Persona_dni_key"
  ON "Persona" (dni)
  WHERE dni IS NOT NULL;

-- ---------------------------------------------------------------------
--  3. Índice de apoyo para detectar homónimos
--     No es único a propósito: dos personas distintas pueden llamarse
--     igual de verdad. Sirve para que la advertencia que muestra el
--     backend al registrar sea rápida.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Persona_nombre_apellido_idx"
  ON "Persona" (LOWER(TRIM(nombre)), LOWER(TRIM(apellido)));

COMMIT;

-- ---------------------------------------------------------------------
--  Comprobación
-- ---------------------------------------------------------------------
\echo ''
\echo '--- Indices sobre Persona ---'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'Persona'
ORDER BY indexname;

\echo ''
\echo '--- Personas sin DNI (siguen permitidas, pero conviene completarlas) ---'
SELECT p.id, p.nombre || ' ' || p.apellido AS paciente, COALESCE(u.correo, '—') AS correo
FROM "Persona" p
LEFT JOIN "User" u ON u."personaId" = p.id
WHERE p.dni IS NULL
ORDER BY p.id;
