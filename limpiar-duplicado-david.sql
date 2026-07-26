-- =====================================================================
--  Eliminar el "David Lopex" duplicado
-- =====================================================================
--
--  QUÉ DICE EL DIAGNÓSTICO
--  -----------------------
--   persona | dni             | correo                 | exp | consultas | citas | facturas
--   --------+-----------------+------------------------+-----+-----------+-------+---------
--      21   | 0801200518920   | david.lopex@gmail.com  |  9  |     0     |  19   |    1
--      22   | 0801-2005-18980 | david.lopex2@gmail.com | 10  |     0     |   0   |    0
--
--  La 21 es la buena: tiene 19 citas y 1 factura.
--  La 22 está completamente vacía, así que borrarla no pierde nada.
--
--  Nota: los DNI son NÚMEROS DISTINTOS, no el mismo con otro formato
--  (…18920 contra …18980). Fueron dos registros con datos tecleados
--  distintos, por eso el índice único sobre el DNI no habría evitado
--  este caso concreto. Sí evita el más común, que es repetir el mismo.
--
--  Correr:
--      docker cp limpiar-duplicado-david.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/limpiar-duplicado-david.sql
--
--  Seguro de repetir: si ya se borró, no hace nada.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  0. Red de seguridad
--     El borrado solo procede si la persona 22 sigue sin nada colgando.
--     Si en el rato entre el diagnóstico y esto le agendaron una cita o
--     le registraron una consulta, la transacción se aborta en vez de
--     destruir datos.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_citas      INT;
  v_consultas  INT;
  v_facturas   INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Persona" WHERE id = 22) THEN
    RAISE NOTICE 'La persona 22 ya no existe: no hay nada que borrar.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_citas     FROM "Cita" WHERE "pacienteId" = 22;
  SELECT COUNT(*) INTO v_consultas FROM "ExpedienteDetalle" d
    JOIN "Expediente" e ON e.id = d."expedienteId" WHERE e."pacienteId" = 22;
  SELECT COUNT(*) INTO v_facturas  FROM "Factura" f
    JOIN "Cita" c ON c.id = f."citaId" WHERE c."pacienteId" = 22;

  IF v_citas > 0 OR v_consultas > 0 OR v_facturas > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: la persona 22 ya tiene datos (citas=%, consultas=%, facturas=%). Hay que fusionarla, no borrarla.',
      v_citas, v_consultas, v_facturas;
  END IF;

  RAISE NOTICE 'Persona 22 verificada: sin citas, consultas ni facturas. Se procede.';
END $$;

-- ---------------------------------------------------------------------
--  1. Borrar en orden de dependencias (de la hoja a la raíz)
--     No se confía en ON DELETE CASCADE: no está declarado en todas las
--     llaves foráneas de este esquema.
-- ---------------------------------------------------------------------

-- Relación expediente-doctor
DELETE FROM "ExpedienteDoctor"
WHERE "expedienteId" IN (SELECT id FROM "Expediente" WHERE "pacienteId" = 22);

-- Archivos adjuntos del expediente
DELETE FROM "ExpedienteArchivo"
WHERE "expedienteId" IN (SELECT id FROM "Expediente" WHERE "pacienteId" = 22);

-- Detalles (ya comprobamos que son cero, pero por si acaso)
DELETE FROM "ExpedienteDetalle"
WHERE "expedienteId" IN (SELECT id FROM "Expediente" WHERE "pacienteId" = 22);

-- El expediente
DELETE FROM "Expediente" WHERE "pacienteId" = 22;

-- El código de verificación, si lo hubiera
DELETE FROM "CodigoVerificacion"
WHERE "userId" IN (SELECT id FROM "User" WHERE "personaId" = 22);

-- El usuario (david.lopex2@gmail.com)
DELETE FROM "User" WHERE "personaId" = 22;

-- Y la persona
DELETE FROM "Persona" WHERE id = 22;

COMMIT;

-- ---------------------------------------------------------------------
--  Comprobación
-- ---------------------------------------------------------------------
\echo ''
\echo '--- David Lopex despues de la limpieza (deberia quedar uno) ---'
SELECT p.id, p.nombre || ' ' || p.apellido AS paciente, p.dni,
       COALESCE(u.correo, '—') AS correo, e.id AS expediente
FROM "Persona" p
LEFT JOIN "User" u       ON u."personaId" = p.id
LEFT JOIN "Expediente" e ON e."pacienteId" = p.id
WHERE LOWER(p.nombre) = 'david' AND LOWER(p.apellido) = 'lopex';

\echo ''
\echo '--- Nombres repetidos que queden ---'
SELECT LOWER(TRIM(nombre)) || ' ' || LOWER(TRIM(apellido)) AS persona,
       COUNT(*) AS veces, array_agg(id ORDER BY id) AS ids
FROM "Persona"
GROUP BY 1
HAVING COUNT(*) > 1;

\echo ''
\echo '--- Totales ---'
SELECT (SELECT COUNT(*) FROM "Persona")    AS personas,
       (SELECT COUNT(*) FROM "User")       AS usuarios,
       (SELECT COUNT(*) FROM "Expediente") AS expedientes;
