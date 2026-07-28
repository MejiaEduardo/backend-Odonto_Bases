-- ============================================================================
--  ROLLBACK DE LA MIGRACION 005
--  Devuelve el esquema al estado en que lo dejo la migracion 004.
--
--  APLICAR:
--     docker cp 005_rollback.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/005_rollback.sql
--
--  ADVERTENCIA - datos que NO se pueden devolver, porque en el modelo viejo
--  no existia donde guardarlos. Si los usaste, se pierden:
--     - "Persona".rtn y "Factura"."rtnCliente"
--     - los datos del "Emisor"
--     - "importeGravado15" / "importeGravado18"
--     - el tipo y el estado del documento: las notas de credito y de debito
--       DESAPARECEN y las facturas anuladas vuelven a figurar como emitidas
--     - "Paciente"."fechaRegistro" y "Paciente".activo
--
--  El rollback se detiene si encuentra notas de credito o de debito, o mas de
--  una factura para la misma cita: en el modelo viejo no caben.
-- ============================================================================

BEGIN;

SET client_min_messages = WARNING;


-- ############################################################################
-- COMPROBACIONES PREVIAS
-- ############################################################################
DO $$
DECLARE
    v_notas   INTEGER;
    v_dobles  INTEGER;
BEGIN
    SELECT count(*) INTO v_notas FROM "Factura" WHERE "tipoDocumento" <> 'FACTURA';
    IF v_notas > 0 THEN
        RAISE EXCEPTION
            'Hay % notas de credito o debito. El modelo de la 004 no las contempla: no se puede revertir sin perderlas.', v_notas;
    END IF;

    SELECT count(*) INTO v_dobles
    FROM (SELECT "citaId" FROM "Factura" WHERE "citaId" IS NOT NULL
          GROUP BY "citaId" HAVING count(*) > 1) x;
    IF v_dobles > 0 THEN
        RAISE EXCEPTION
            'Hay % citas con mas de una factura (por refacturacion tras anular). El modelo de la 004 solo admite una.', v_dobles;
    END IF;
END $$;


-- ############################################################################
-- VISTAS
-- ############################################################################

DROP VIEW IF EXISTS "vw_Cita";
DROP VIEW IF EXISTS "vw_Paciente";
DROP VIEW IF EXISTS "vw_Factura";


-- ############################################################################
-- PARTE 6 INVERSA - TIPO Y ESTADO DEL DOCUMENTO
-- ############################################################################

DROP TRIGGER IF EXISTS "trg_Factura_no_borrar" ON "Factura";
DROP FUNCTION IF EXISTS fn_factura_no_se_borra();

ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_anulacion_check";
ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_documentoOrigen_check";
ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_documentoOrigen_distinto_check";
ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_documentoOrigenId_fkey";

DROP INDEX IF EXISTS "Factura_citaId_key";
DROP INDEX IF EXISTS "Factura_documentoOrigenId_idx";
DROP INDEX IF EXISTS "Factura_estado_idx";

ALTER TABLE "Factura"
    DROP COLUMN IF EXISTS "tipoDocumento",
    DROP COLUMN IF EXISTS estado,
    DROP COLUMN IF EXISTS "motivoAnulacion",
    DROP COLUMN IF EXISTS "fechaAnulacion",
    DROP COLUMN IF EXISTS "documentoOrigenId";

CREATE UNIQUE INDEX "Factura_citaId_key" ON "Factura" ("citaId");

DROP TYPE IF EXISTS "TipoDocumento";
DROP TYPE IF EXISTS "EstadoFactura";

-- fn_validar_factura tal como la dejo la migracion 004.
CREATE OR REPLACE FUNCTION fn_validar_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    r        RECORD;
    v_cita   RECORD;
BEGIN
    -- Rango y vigencia del CAI
    SELECT * INTO r FROM "RangoFacturacion" WHERE id = NEW."rangoId";

    IF NEW."numeroFactura" < r."numeroInicial" OR NEW."numeroFactura" > r."numeroFinal" THEN
        RAISE EXCEPTION
            'El numero % esta fuera del rango autorizado (% a %).',
            NEW."numeroFactura", r."numeroInicial", r."numeroFinal";
    END IF;

    IF NEW."fechaEmision"::date > r."fechaLimiteEmision" THEN
        RAISE EXCEPTION
            'El CAI vencio el %. No se puede emitir la factura.', r."fechaLimiteEmision";
    END IF;

    -- Solo se factura una cita COMPLETADA, y los datos deben coincidir con ella.
    IF NEW."citaId" IS NOT NULL THEN
        SELECT * INTO v_cita FROM "Cita" WHERE id = NEW."citaId";

        IF v_cita.estado <> 'COMPLETADA' THEN
            RAISE EXCEPTION
                'Solo se puede facturar una cita COMPLETADA. La cita % esta en estado %.',
                NEW."citaId", v_cita.estado;
        END IF;

        IF NEW."pacienteId" <> v_cita."pacienteId" THEN
            RAISE EXCEPTION
                'El paciente de la factura (%) no coincide con el de la cita % (%).',
                NEW."pacienteId", NEW."citaId", v_cita."pacienteId";
        END IF;

        IF NEW."empleadoId" IS NOT NULL AND NEW."empleadoId" <> v_cita."empleadoId" THEN
            RAISE EXCEPTION
                'El doctor de la factura (%) no coincide con el de la cita % (%).',
                NEW."empleadoId", NEW."citaId", v_cita."empleadoId";
        END IF;
    END IF;

    RETURN NEW;
END $$;


-- ############################################################################
-- PARTE 5 INVERSA - IMPORTES GRAVADOS
-- ############################################################################

ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_cuadre_total_check";
ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_cuadre_isv_check";
ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_cuadre_bases_check";
ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_gravados_check";

ALTER TABLE "Factura"
    DROP COLUMN IF EXISTS "importeGravado15",
    DROP COLUMN IF EXISTS "importeGravado18";


-- ############################################################################
-- PARTE 4 INVERSA - RTN DEL CLIENTE
-- ############################################################################

ALTER TABLE "Factura" DROP CONSTRAINT IF EXISTS "Factura_rtnCliente_formato_check";
ALTER TABLE "Factura" DROP COLUMN IF EXISTS "rtnCliente";

ALTER TABLE "Persona" DROP CONSTRAINT IF EXISTS "Persona_rtn_formato_check";
ALTER TABLE "Persona" DROP CONSTRAINT IF EXISTS "Persona_rtn_key";
ALTER TABLE "Persona" DROP COLUMN IF EXISTS rtn;


-- ############################################################################
-- PARTE 3 INVERSA - EMISOR
-- ############################################################################

ALTER TABLE "RangoFacturacion" DROP CONSTRAINT IF EXISTS "RangoFacturacion_emisorId_fkey";
DROP INDEX IF EXISTS "RangoFacturacion_emisorId_idx";
ALTER TABLE "RangoFacturacion" DROP COLUMN IF EXISTS "emisorId";

DROP TRIGGER IF EXISTS "trg_Emisor_updated_at" ON "Emisor";
DROP TABLE IF EXISTS "Emisor";


-- ############################################################################
-- PARTE 2 INVERSA - ENTIDAD PACIENTE
-- ############################################################################
-- "pacienteId" vuelve a ser un id de Persona.
-- Mismo orden que en la migracion: primero Cita, despues Factura, por el
-- trigger que compara las dos. Y los indices unicos sobre "pacienteId" se
-- bajan mientras dura el remapeo, por la misma razon que en la 005.

DROP INDEX "Cita_paciente_fechaHora_key";
DROP INDEX "Expediente_pacienteId_key";

ALTER TABLE "Cita" DROP CONSTRAINT "Cita_pacienteId_fkey";
UPDATE "Cita" c
SET "pacienteId" = pa."personaId"
FROM "Paciente" pa
WHERE pa.id = c."pacienteId";
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_pacienteId_fkey"
    FOREIGN KEY ("pacienteId") REFERENCES "Persona"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Factura" DROP CONSTRAINT "Factura_pacienteId_fkey";
UPDATE "Factura" f
SET "pacienteId" = pa."personaId"
FROM "Paciente" pa
WHERE pa.id = f."pacienteId";
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_pacienteId_fkey"
    FOREIGN KEY ("pacienteId") REFERENCES "Persona"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Expediente" DROP CONSTRAINT "Expediente_pacienteId_fkey";
UPDATE "Expediente" e
SET "pacienteId" = pa."personaId"
FROM "Paciente" pa
WHERE pa.id = e."pacienteId";
ALTER TABLE "Expediente" ADD CONSTRAINT "Expediente_pacienteId_fkey"
    FOREIGN KEY ("pacienteId") REFERENCES "Persona"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE UNIQUE INDEX "Expediente_pacienteId_key" ON "Expediente" ("pacienteId");

DROP TRIGGER IF EXISTS "trg_Paciente_updated_at" ON "Paciente";
DROP TABLE IF EXISTS "Paciente";


-- ############################################################################
-- PARTE 1 INVERSA - CITA: "fechaHora" -> "fecha" + "hora"
-- ############################################################################

ALTER TABLE "Cita" DROP COLUMN fecha;
ALTER TABLE "Cita" DROP COLUMN hora;

ALTER TABLE "Cita" ADD COLUMN fecha DATE;
ALTER TABLE "Cita" ADD COLUMN hora  TIME;

UPDATE "Cita" SET fecha = "fechaHora"::DATE,
                  hora  = "fechaHora"::TIME;

ALTER TABLE "Cita" ALTER COLUMN fecha SET NOT NULL;
ALTER TABLE "Cita" ALTER COLUMN hora  SET NOT NULL;

DROP INDEX IF EXISTS "Cita_empleado_fechaHora_key";
DROP INDEX IF EXISTS "Cita_paciente_fechaHora_key";
DROP INDEX IF EXISTS "Cita_fechaHora_idx";
DROP INDEX IF EXISTS "Cita_fecha_idx";

ALTER TABLE "Cita" DROP COLUMN "fechaHora";

CREATE UNIQUE INDEX "Cita_empleado_fecha_hora_key"
    ON "Cita" ("empleadoId", fecha, hora)
    WHERE estado <> 'CANCELADA'::"EstadoCita";

CREATE UNIQUE INDEX "Cita_paciente_fecha_hora_key"
    ON "Cita" ("pacienteId", fecha, hora)
    WHERE estado <> 'CANCELADA'::"EstadoCita";

CREATE INDEX "Cita_fecha_idx" ON "Cita" (fecha);


-- ############################################################################
-- VISTAS DE LA 004
-- ############################################################################

CREATE OR REPLACE VIEW "vw_Factura" AS
SELECT
    f.id, f."numeroFactura",
    r.cai,
    r."numeroInicial" AS "rangoDesde",
    r."numeroFinal"   AS "rangoHasta",
    r."fechaLimiteEmision",
    f."fechaEmision",
    f."pacienteId", p."nombreCompleto" AS paciente, p.dni,
    f."empleadoId", f."citaId",
    f.subtotal, f.descuentos, f."importeExonerado", f."importeExento",
    f.isv15, f.isv18, f."totalPagar"
FROM "Factura" f
JOIN "RangoFacturacion" r ON r.id = f."rangoId"
JOIN "Persona"          p ON p.id = f."pacienteId";


SET client_min_messages = NOTICE;

DO $$
BEGIN
    RAISE NOTICE 'Rollback de la migracion 005 aplicado. El esquema quedo como en la 004.';
END $$;

COMMIT;

ANALYZE;
