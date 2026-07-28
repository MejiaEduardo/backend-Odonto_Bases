-- ============================================================================
--  REVERSION DE LA MIGRACION 003
--  Devuelve el esquema al estado anterior al pulido.
--
--  Los datos se recuperan casi por completo (nombre y apellido se rearman
--  desde las cuatro columnas, y los ENUM desde las tablas catalogo).
--  NO se recuperan: las fechas de CodigoVerificacion que estaban corruptas
--  y las filas huerfanas de HistorialCancelacionCita que se eliminaron.
--  Si necesitas el estado exacto, restaura el respaldo previo.
--
--  EJECUTAR CON:
--     docker cp 003_rollback.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/003_rollback.sql
-- ============================================================================

BEGIN;

SET client_min_messages = WARNING;

-- ---------------------------------------------------------------------------
-- Vistas y triggers
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS "vw_Usuario";
DROP VIEW IF EXISTS "vw_Empleado";

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT event_object_table AS tabla, trigger_name AS nombre
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND (trigger_name LIKE 'trg_%_updated_at' OR trigger_name LIKE 'trg_%_es_doctor')
        GROUP BY 1, 2
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t.nombre, t.tabla);
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS fn_set_updated_at();
DROP FUNCTION IF EXISTS fn_validar_es_doctor();

-- ---------------------------------------------------------------------------
-- Indices agregados
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "Cita_doctor_fecha_hora_key";
DROP INDEX IF EXISTS "Cita_paciente_fecha_hora_key";
DROP INDEX IF EXISTS "Cita_pacienteId_idx";
DROP INDEX IF EXISTS "Cita_doctorId_idx";
DROP INDEX IF EXISTS "Cita_servicioId_idx";
DROP INDEX IF EXISTS "Cita_fecha_idx";
DROP INDEX IF EXISTS "Cita_estado_idx";
DROP INDEX IF EXISTS "DetalleFactura_facturaId_idx";
DROP INDEX IF EXISTS "DetalleFactura_servicioId_idx";
DROP INDEX IF EXISTS "Factura_pacienteId_idx";
DROP INDEX IF EXISTS "Factura_doctorId_idx";
DROP INDEX IF EXISTS "Factura_fechaEmision_idx";
DROP INDEX IF EXISTS "ExpedienteDetalle_expedienteId_idx";
DROP INDEX IF EXISTS "ExpedienteDetalle_doctorId_idx";
DROP INDEX IF EXISTS "ExpedienteArchivo_expedienteId_idx";
DROP INDEX IF EXISTS "ExpedienteArchivo_creadoPorId_idx";
DROP INDEX IF EXISTS "ExpedienteDoctor_doctorId_idx";
DROP INDEX IF EXISTS "EspecialidadDoctor_especialidadId_idx";
DROP INDEX IF EXISTS "ServicioEspecialidad_especialidadId_idx";
DROP INDEX IF EXISTS "Logs_empleadoId_idx";
DROP INDEX IF EXISTS "Empleado_puestoId_idx";
DROP INDEX IF EXISTS "User_rolId_idx";
DROP INDEX IF EXISTS "HistorialCancelacionCita_usuarioCancelaId_idx";
DROP INDEX IF EXISTS "Persona_nombreCompleto_idx";
DROP INDEX IF EXISTS "CodigoVerificacion_userId_idx";

-- ---------------------------------------------------------------------------
-- Restricciones agregadas
-- ---------------------------------------------------------------------------
ALTER TABLE "Persona"
    DROP CONSTRAINT IF EXISTS "Persona_primerNombre_check",
    DROP CONSTRAINT IF EXISTS "Persona_primerApellido_check",
    DROP CONSTRAINT IF EXISTS "Persona_segundoNombre_check",
    DROP CONSTRAINT IF EXISTS "Persona_segundoApellido_check",
    DROP CONSTRAINT IF EXISTS "Persona_dni_key",
    DROP CONSTRAINT IF EXISTS "Persona_dni_formato_check",
    DROP CONSTRAINT IF EXISTS "Persona_fechaNac_check",
    DROP CONSTRAINT IF EXISTS "Persona_telefono_formato_check";

ALTER TABLE "Empleado"        DROP CONSTRAINT IF EXISTS "Empleado_salario_check";
ALTER TABLE "ServicioClinico"
    DROP CONSTRAINT IF EXISTS "ServicioClinico_precio_check",
    DROP CONSTRAINT IF EXISTS "ServicioClinico_nombre_key",
    DROP CONSTRAINT IF EXISTS "ServicioClinico_nombre_check";
ALTER TABLE "DetalleFactura"
    DROP CONSTRAINT IF EXISTS "DetalleFactura_cantidad_check",
    DROP CONSTRAINT IF EXISTS "DetalleFactura_precioUnitario_check",
    DROP CONSTRAINT IF EXISTS "DetalleFactura_descripcion_check";
ALTER TABLE "Factura"
    DROP CONSTRAINT IF EXISTS "Factura_montos_check",
    DROP CONSTRAINT IF EXISTS "Factura_numeroFactura_check",
    DROP CONSTRAINT IF EXISTS "Factura_cai_check";
ALTER TABLE "User"            DROP CONSTRAINT IF EXISTS "User_correo_formato_check";
ALTER TABLE "Logs"            DROP CONSTRAINT IF EXISTS "Logs_logout_check";
ALTER TABLE "CodigoVerificacion" DROP CONSTRAINT IF EXISTS "CodigoVerificacion_expiracion_check";
ALTER TABLE "HistorialCancelacionCita"
    DROP CONSTRAINT IF EXISTS "HistorialCancelacionCita_usuarioCancelaId_fkey",
    DROP CONSTRAINT IF EXISTS "HistorialCancelacionCita_motivo_check";

-- ---------------------------------------------------------------------------
-- Indices unicos originales
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "User_correo_key";
CREATE UNIQUE INDEX "User_correo_key" ON "User" (correo);

CREATE UNIQUE INDEX IF NOT EXISTS "HistorialCancelacionCita_citaId_key"
    ON "HistorialCancelacionCita" ("citaId");

CREATE UNIQUE INDEX IF NOT EXISTS "CodigoVerificacion_userId_key"
    ON "CodigoVerificacion" ("userId");

-- ---------------------------------------------------------------------------
-- ON DELETE originales (RESTRICT)
-- ---------------------------------------------------------------------------
ALTER TABLE "DetalleFactura"
    DROP CONSTRAINT "DetalleFactura_facturaId_fkey",
    ADD  CONSTRAINT "DetalleFactura_facturaId_fkey"
        FOREIGN KEY ("facturaId") REFERENCES "Factura"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "ExpedienteDetalle"
    DROP CONSTRAINT "ExpedienteDetalle_expedienteId_fkey",
    ADD  CONSTRAINT "ExpedienteDetalle_expedienteId_fkey"
        FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "ExpedienteArchivo"
    DROP CONSTRAINT "ExpedienteArchivo_expedienteId_fkey",
    ADD  CONSTRAINT "ExpedienteArchivo_expedienteId_fkey"
        FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "CodigoVerificacion"
    DROP CONSTRAINT "CodigoVerificacion_userId_fkey",
    ADD  CONSTRAINT "CodigoVerificacion_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Logs" ALTER COLUMN logout SET DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Tipos de datos originales
-- ---------------------------------------------------------------------------
ALTER TABLE "DetalleFactura" DROP COLUMN "totalLinea";
ALTER TABLE "DetalleFactura" ADD COLUMN "totalLinea" DOUBLE PRECISION;
UPDATE "DetalleFactura" SET "totalLinea" = cantidad * "precioUnitario";
ALTER TABLE "DetalleFactura" ALTER COLUMN "totalLinea" SET NOT NULL;

ALTER TABLE "DetalleFactura"
    ALTER COLUMN "precioUnitario" TYPE DOUBLE PRECISION;

ALTER TABLE "Factura"
    ALTER COLUMN subtotal           TYPE DOUBLE PRECISION,
    ALTER COLUMN descuentos         TYPE DOUBLE PRECISION,
    ALTER COLUMN "importeExonerado" TYPE DOUBLE PRECISION,
    ALTER COLUMN "importeExento"    TYPE DOUBLE PRECISION,
    ALTER COLUMN isv15              TYPE DOUBLE PRECISION,
    ALTER COLUMN isv18              TYPE DOUBLE PRECISION,
    ALTER COLUMN "totalPagar"       TYPE DOUBLE PRECISION;

ALTER TABLE "ServicioClinico" ALTER COLUMN precio  TYPE DOUBLE PRECISION;
ALTER TABLE "Empleado"        ALTER COLUMN salario TYPE DOUBLE PRECISION;

ALTER TABLE "Cita"
    ALTER COLUMN fecha TYPE TEXT USING to_char(fecha, 'YYYY-MM-DD'),
    ALTER COLUMN hora  TYPE TEXT USING to_char(hora,  'HH24:MI');

ALTER TABLE "Persona"
    ALTER COLUMN "fechaNac" TYPE TIMESTAMP(3) USING "fechaNac"::timestamp;

-- ---------------------------------------------------------------------------
-- Volver a los ENUM
-- ---------------------------------------------------------------------------
ALTER TABLE "HistorialCancelacionCita" ADD COLUMN "rolCancela" VARCHAR(50);
UPDATE "HistorialCancelacionCita" h SET "rolCancela" = r.nombre
FROM "Rol" r WHERE r.id = h."rolCancelaId";
ALTER TABLE "HistorialCancelacionCita"
    ALTER COLUMN "rolCancela" SET NOT NULL,
    DROP COLUMN "rolCancelaId";

ALTER TABLE "User"     ADD COLUMN rol    TEXT;
UPDATE "User" u SET rol = r.nombre FROM "Rol" r WHERE r.id = u."rolId";
ALTER TABLE "User" DROP COLUMN "rolId";

ALTER TABLE "Empleado" ADD COLUMN puesto TEXT;
UPDATE "Empleado" e SET puesto = p.nombre FROM "Puesto" p WHERE p.id = e."puestoId";
ALTER TABLE "Empleado" DROP COLUMN "puestoId";

DROP TABLE "Rol";
DROP TABLE "Puesto";

CREATE TYPE "Rol"    AS ENUM ('ADMIN', 'DOCTOR', 'RECEPCIONISTA', 'CLIENTE');
CREATE TYPE "Puesto" AS ENUM ('DOCTOR', 'RECEPCIONISTA', 'ADMIN', 'OTRO');

ALTER TABLE "User"
    ALTER COLUMN rol TYPE "Rol" USING rol::"Rol";
ALTER TABLE "User"
    ALTER COLUMN rol SET NOT NULL,
    ALTER COLUMN rol SET DEFAULT 'CLIENTE'::"Rol";

ALTER TABLE "Empleado"
    ALTER COLUMN puesto TYPE "Puesto" USING puesto::"Puesto";
ALTER TABLE "Empleado"
    ALTER COLUMN puesto SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Volver a nombre / apellido
-- ---------------------------------------------------------------------------
ALTER TABLE "Persona" DROP COLUMN "nombreCompleto";

ALTER TABLE "Persona"
    ADD COLUMN nombre   TEXT,
    ADD COLUMN apellido TEXT;

UPDATE "Persona" SET
    nombre   = "primerNombre"   || COALESCE(' ' || "segundoNombre",   ''),
    apellido = "primerApellido" || COALESCE(' ' || "segundoApellido", '');

ALTER TABLE "Persona"
    ALTER COLUMN nombre   SET NOT NULL,
    ALTER COLUMN apellido SET NOT NULL,
    ALTER COLUMN "primerNombre"   DROP NOT NULL,
    ALTER COLUMN "primerApellido" DROP NOT NULL;

COMMIT;

ANALYZE;
