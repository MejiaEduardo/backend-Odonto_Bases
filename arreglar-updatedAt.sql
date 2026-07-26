-- =====================================================================
--  ARREGLAR updatedAt SIN VALOR POR DEFECTO
-- =====================================================================
--
--  PROBLEMA
--  --------
--  10 tablas tienen:
--      "updatedAt" TIMESTAMP(3) NOT NULL      <- sin DEFAULT
--
--  El esquema se generó con Prisma, donde el campo `@updatedAt` lo rellena
--  la librería en tiempo de ejecución. Pero este proyecto NO usa ORM: hace
--  SQL a mano. Como nadie rellena la columna, cualquier INSERT que no la
--  incluya explícitamente revienta con:
--
--      null value in column "updatedAt" violates not-null constraint
--
--  Fue lo que pasó al crear un empleado: el INSERT en "Persona" no incluía
--  updatedAt.
--
--  SOLUCIÓN
--  --------
--  Darle DEFAULT CURRENT_TIMESTAMP a las 10 columnas. Así los INSERT que
--  la omitan funcionan, y los que la envían siguen mandando (el valor
--  explícito gana sobre el default).
--
--  No borra ni modifica datos existentes: solo cambia el valor por defecto.
--
--  Correr:
--      docker cp arreglar-updatedAt.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/arreglar-updatedAt.sql
-- =====================================================================

ALTER TABLE "Persona"           ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User"              ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Especialidad"      ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ServicioClinico"   ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Expediente"        ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ExpedienteDetalle" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ExpedienteArchivo" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Cita"              ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Factura"           ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DetalleFactura"    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------
--  Comprobación: las 10 deben mostrar "now()" en la columna default
-- ---------------------------------------------------------------------
SELECT
  table_name        AS tabla,
  column_default    AS valor_por_defecto,
  CASE WHEN column_default IS NULL THEN 'FALTA' ELSE 'OK' END AS estado
FROM information_schema.columns
WHERE column_name = 'updatedAt'
  AND table_schema = 'public'
ORDER BY table_name;

-- =====================================================================
--  NOTA PARA EL EQUIPO
--  -------------------
--  Esto resuelve los INSERT. Para los UPDATE, la columna hay que
--  refrescarla a mano en cada consulta:
--
--      UPDATE "Persona" SET nombre = $1, "updatedAt" = CURRENT_TIMESTAMP ...
--
--  Si prefieren que sea automático, se puede agregar un trigger por tabla:
--
--      CREATE OR REPLACE FUNCTION set_updated_at()
--      RETURNS TRIGGER AS $$
--      BEGIN
--        NEW."updatedAt" = CURRENT_TIMESTAMP;
--        RETURN NEW;
--      END;
--      $$ LANGUAGE plpgsql;
--
--      CREATE TRIGGER trg_persona_updated_at
--        BEFORE UPDATE ON "Persona"
--        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--
--  Queda a criterio del equipo; no lo aplico para no cambiar el
--  comportamiento sin acuerdo.
-- =====================================================================
