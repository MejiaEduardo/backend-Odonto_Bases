-- ============================================================================
--  MIGRACION 005 - ENTIDAD PACIENTE, FECHA/HORA DE LA CITA Y PUNTO 6.2 FISCAL
--  Proyecto: Clinica Odontologica
--  Base:     PostgreSQL 16
--
--  Requiere que las migraciones 003 y 004 ya esten aplicadas.
--
--  Cubre:
--    PARTE 1  Cita: "fecha" + "hora" se unifican en "fechaHora" (TIMESTAMP).
--             "fecha" y "hora" siguen existiendo, pero como columnas
--             GENERADAS: las mantiene PostgreSQL y no se pueden desincronizar.
--
--    PARTE 2  Entidad "Paciente" propia. Cita, Factura y Expediente dejan de
--             apuntar a "Persona" y apuntan a "Paciente".
--
--    PARTE 3  Punto 6.2 - RTN del emisor: tabla "Emisor" con la razon social,
--             el RTN y la direccion del punto de emision.
--
--    PARTE 4  Punto 6.2 - RTN del cliente: "Persona".rtn y el RTN copiado en
--             la factura, obligatorio cuando el total supera L.100.
--
--    PARTE 5  Punto 6.2 - Importes gravados por tasa (base de cada ISV).
--
--    PARTE 6  Punto 6.2 - Tipo y estado del documento: una factura se anula,
--             no se borra; notas de credito y de debito.
--
--    PARTE 7  Vistas actualizadas.
--
--  1) RESPALDO PREVIO (obligatorio):
--     docker exec odonto-db pg_dump -U postgres -d odontologia > respaldo_previo_005.sql
--
--  2) APLICAR:
--     docker cp 005_paciente_y_fiscal.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/005_paciente_y_fiscal.sql
--
--  Todo corre dentro de una transaccion: si algo falla no se aplica nada.
--  En DataGrip usa el modo de transaccion "Manual", no "Auto".
-- ============================================================================

BEGIN;

SET client_min_messages = WARNING;


-- ############################################################################
-- PARTE 1 - CITA: "fecha" + "hora"  ->  "fechaHora"
-- ############################################################################
-- Guardar la fecha y la hora por separado no rompe ninguna forma normal: los
-- dos valores son atomicos y los dos dependen por completo de la clave. El
-- problema es otro y es real:
--
--   1. Son dos mitades de UN solo hecho ("cuando es la cita"). Separadas se
--      pueden guardar a medias o quedar incoherentes.
--   2. Todo calculo de intervalo obliga a recomponerlas: "las citas de las
--      proximas 24 horas" cruzando la medianoche no se resuelve comparando
--      fecha y hora por separado sin escribir una condicion con OR.
--   3. Ordenar cronologicamente exige ORDER BY con dos columnas siempre.
--
-- Se unifican en "fechaHora". "fecha" y "hora" se recrean como columnas
-- GENERADAS para que las consultas por dia y las grillas de horarios sigan
-- funcionando igual. Una columna generada no es redundancia: la calcula el
-- motor y no se puede escribir, asi que no puede desincronizarse.
-- ----------------------------------------------------------------------------

ALTER TABLE "Cita" ADD COLUMN "fechaHora" TIMESTAMP(3);

UPDATE "Cita" SET "fechaHora" = (fecha + hora)::TIMESTAMP(3);

ALTER TABLE "Cita" ALTER COLUMN "fechaHora" SET NOT NULL;

-- Los indices que usaban las columnas viejas hay que rehacerlos.
DROP INDEX "Cita_empleado_fecha_hora_key";
DROP INDEX "Cita_paciente_fecha_hora_key";
DROP INDEX "Cita_fecha_idx";

ALTER TABLE "Cita" DROP COLUMN fecha;
ALTER TABLE "Cita" DROP COLUMN hora;

ALTER TABLE "Cita" ADD COLUMN fecha DATE GENERATED ALWAYS AS (("fechaHora")::DATE) STORED;
ALTER TABLE "Cita" ADD COLUMN hora  TIME GENERATED ALWAYS AS (("fechaHora")::TIME) STORED;

-- Un doctor no puede tener dos citas activas al mismo tiempo.
-- Sigue siendo PARCIAL: una cita cancelada libera su horario.
CREATE UNIQUE INDEX "Cita_empleado_fechaHora_key"
    ON "Cita" ("empleadoId", "fechaHora")
    WHERE estado <> 'CANCELADA'::"EstadoCita";

-- "Cita_paciente_fechaHora_key" se crea en la PARTE 2, despues del remapeo
-- de "pacienteId".

CREATE INDEX "Cita_fechaHora_idx" ON "Cita" ("fechaHora");
CREATE INDEX "Cita_fecha_idx"     ON "Cita" (fecha);


-- ############################################################################
-- PARTE 2 - ENTIDAD "PACIENTE"
-- ############################################################################
-- Antes "Cita", "Factura" y "Expediente" apuntaban directamente a "Persona",
-- mientras que el empleado si tenia tabla propia. Eso tenia dos consecuencias:
--
--   - No habia forma de saber que personas son pacientes. Habia que deducirlo
--     preguntando "aparece en alguna cita?", que no es lo mismo: un paciente
--     registrado que todavia no agendo nada era invisible.
--   - Nada impedia agendarle una cita a una persona que solo existe como
--     empleado, ni distinguir "dado de alta" de "dado de baja" como paciente.
--
-- "Persona" guarda lo que es cierto de cualquier ser humano (nombre, DNI,
-- telefono). "Paciente" guarda lo que es cierto solo de quien se atiende en
-- la clinica. Es exactamente la misma relacion que ya existia entre "Persona"
-- y "Empleado", asi que el modelo queda simetrico.
-- ----------------------------------------------------------------------------

CREATE TABLE "Paciente" (
    id              SERIAL       PRIMARY KEY,
    "personaId"     INTEGER      NOT NULL UNIQUE,
    "fechaRegistro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paciente_personaId_fkey"
        FOREIGN KEY ("personaId") REFERENCES "Persona"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX "Paciente_activo_idx" ON "Paciente" (activo);

-- Es paciente toda persona que ya aparece en una cita, en una factura o en un
-- expediente, mas todo usuario con rol CLIENTE aunque todavia no tenga citas.
INSERT INTO "Paciente" ("personaId", "fechaRegistro", "createdAt")
SELECT p.id, p."createdAt", p."createdAt"
FROM "Persona" p
WHERE p.id IN (SELECT "pacienteId" FROM "Cita")
   OR p.id IN (SELECT "pacienteId" FROM "Factura")
   OR p.id IN (SELECT "pacienteId" FROM "Expediente")
   OR p.id IN (SELECT u."personaId"
               FROM "User" u
               JOIN "Rol" r ON r.id = u."rolId"
               WHERE r.nombre = 'CLIENTE')
ORDER BY p.id;

-- Remapeo de las claves foraneas: "pacienteId" pasa de ser un id de Persona
-- a ser un id de Paciente.
--
-- ORDEN IMPORTANTE: primero "Cita" y despues "Factura". El trigger
-- trg_Factura_validar compara Factura."pacienteId" con Cita."pacienteId";
-- si se hiciera al reves, la comparacion mezclaria ids viejos con nuevos.
--
-- Cada UPDATE ve una foto consistente de la tabla, asi que no hay riesgo de
-- que un id se remapee dos veces aunque los numeros se solapen.
--
-- Los indices UNICOS que incluyen "pacienteId" tienen que estar bajados
-- mientras dura el remapeo: PostgreSQL verifica la unicidad fila por fila, no
-- al final del UPDATE, y a mitad del recorrido un id nuevo puede chocar con
-- uno viejo que todavia no se remapeo. Se vuelven a crear mas abajo.

DROP INDEX "Expediente_pacienteId_key";

ALTER TABLE "Cita" DROP CONSTRAINT "Cita_pacienteId_fkey";
UPDATE "Cita" c
SET "pacienteId" = pa.id
FROM "Paciente" pa
WHERE pa."personaId" = c."pacienteId";
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_pacienteId_fkey"
    FOREIGN KEY ("pacienteId") REFERENCES "Paciente"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Factura" DROP CONSTRAINT "Factura_pacienteId_fkey";
UPDATE "Factura" f
SET "pacienteId" = pa.id
FROM "Paciente" pa
WHERE pa."personaId" = f."pacienteId";
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_pacienteId_fkey"
    FOREIGN KEY ("pacienteId") REFERENCES "Paciente"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Expediente" DROP CONSTRAINT "Expediente_pacienteId_fkey";
UPDATE "Expediente" e
SET "pacienteId" = pa.id
FROM "Paciente" pa
WHERE pa."personaId" = e."pacienteId";
ALTER TABLE "Expediente" ADD CONSTRAINT "Expediente_pacienteId_fkey"
    FOREIGN KEY ("pacienteId") REFERENCES "Paciente"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- Se vuelven a levantar los indices unicos.
CREATE UNIQUE INDEX "Cita_paciente_fechaHora_key"
    ON "Cita" ("pacienteId", "fechaHora")
    WHERE estado <> 'CANCELADA'::"EstadoCita";

CREATE UNIQUE INDEX "Expediente_pacienteId_key" ON "Expediente" ("pacienteId");


-- ############################################################################
-- PARTE 3 - PUNTO 6.2: RTN DEL EMISOR
-- ############################################################################
-- No existia ninguna tabla con los datos del negocio. El regimen de
-- facturacion de Honduras (Acuerdo 481-2017 del SAR) exige que toda factura
-- muestre la razon social, el RTN y la direccion del punto de emision.
--
-- El emisor cuelga del RANGO y no de la factura: el SAR autoriza un CAI a un
-- emisor concreto, y todas las facturas de ese rango comparten emisor. Poner
-- el emisor en cada factura seria repetir el mismo dato en cada fila, que es
-- justo lo que se corrigio con el CAI en la migracion 004.
-- ----------------------------------------------------------------------------

CREATE TABLE "Emisor" (
    id                SERIAL       PRIMARY KEY,
    "razonSocial"     TEXT         NOT NULL,
    "nombreComercial" TEXT,
    rtn               TEXT         NOT NULL UNIQUE,
    direccion         TEXT         NOT NULL,
    telefono          TEXT,
    correo            TEXT,
    activo            BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Emisor_razonSocial_check" CHECK (btrim("razonSocial") <> ''),
    CONSTRAINT "Emisor_direccion_check"   CHECK (btrim(direccion)     <> ''),
    -- El RTN hondureno son 14 digitos.
    CONSTRAINT "Emisor_rtn_formato_check" CHECK (rtn ~ '^[0-9]{14}$'),
    CONSTRAINT "Emisor_telefono_formato_check" CHECK (telefono IS NULL OR telefono ~ '^[0-9]{8}$')
);

-- OJO: datos PROVISIONALES, igual que el rango de facturacion de la 004.
-- Hay que reemplazarlos por los reales antes de usar el sistema de verdad.
INSERT INTO "Emisor" (id, "razonSocial", "nombreComercial", rtn, direccion, telefono, correo) VALUES
    (1,
     'CLINICA ODONTOLOGICA S. DE R.L.',
     'Clinica Odontologica',
     '00000000000000',
     'PROVISIONAL - direccion del punto de emision pendiente',
     '00000000',
     'facturacion@clinica.local');

SELECT setval('"Emisor_id_seq"', (SELECT max(id) FROM "Emisor"));

ALTER TABLE "RangoFacturacion" ADD COLUMN "emisorId" INTEGER;
UPDATE "RangoFacturacion" SET "emisorId" = 1;
ALTER TABLE "RangoFacturacion" ALTER COLUMN "emisorId" SET NOT NULL;
ALTER TABLE "RangoFacturacion" ADD CONSTRAINT "RangoFacturacion_emisorId_fkey"
    FOREIGN KEY ("emisorId") REFERENCES "Emisor"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX "RangoFacturacion_emisorId_idx" ON "RangoFacturacion" ("emisorId");


-- ############################################################################
-- PARTE 4 - PUNTO 6.2: RTN DEL CLIENTE
-- ############################################################################
-- "Persona" tenia DNI pero no RTN. El RTN es obligatorio en la factura cuando
-- la compra supera los L.100.
--
-- Se guarda en dos lugares a proposito y NO es redundancia:
--   - "Persona".rtn es el dato vigente de la persona, y cambia si ella lo
--     cambia.
--   - "Factura"."rtnCliente" es la copia congelada del RTN al momento de
--     emitir. Una factura es un documento legal: tiene que seguir diciendo lo
--     que decia el dia que se emitio, igual que ya pasa con el precio de cada
--     linea del detalle.
-- ----------------------------------------------------------------------------

ALTER TABLE "Persona" ADD COLUMN rtn TEXT;
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_rtn_key" UNIQUE (rtn);
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_rtn_formato_check"
    CHECK (rtn IS NULL OR rtn ~ '^[0-9]{14}$');

ALTER TABLE "Factura" ADD COLUMN "rtnCliente" TEXT;
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_rtnCliente_formato_check"
    CHECK ("rtnCliente" IS NULL OR "rtnCliente" ~ '^[0-9]{14}$');

-- La obligatoriedad ("total > L.100 exige RTN") NO se pone como CHECK sino
-- dentro del trigger fn_validar_factura, y solo para INSERT. Motivo: un CHECK
-- se evalua tambien al ACTUALIZAR una fila vieja, asi que las diez facturas
-- que ya existen -- emitidas cuando el RTN ni siquiera se guardaba -- no se
-- podrian ni anular. La regla debe aplicar a lo que se emita de ahora en
-- adelante, no a lo que ya esta emitido. No se inventan RTN para rellenarlas.
-- Ver PARTE 6.


-- ############################################################################
-- PARTE 5 - PUNTO 6.2: IMPORTES GRAVADOS POR TASA
-- ############################################################################
-- La factura guardaba los impuestos (isv15, isv18) y los importes exento y
-- exonerado, pero no las BASES sobre las que se calculo cada impuesto. Sin
-- ellas el pie de la factura no cuadra y no se puede reconstruir el calculo,
-- que es justo lo que revisa el SAR.
--
-- La base de cada tasa se saca del detalle (cada linea ya tiene su "tasaISV"),
-- restandole la parte proporcional del descuento de cabecera.
-- ----------------------------------------------------------------------------

ALTER TABLE "Factura"
    ADD COLUMN "importeGravado15" NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "importeGravado18" NUMERIC(12,2) NOT NULL DEFAULT 0;

WITH bases AS (
    SELECT d."facturaId",
           COALESCE(SUM(d."totalLinea") FILTER (WHERE d."tasaISV" = 0.15), 0) AS l15,
           COALESCE(SUM(d."totalLinea") FILTER (WHERE d."tasaISV" = 0.18), 0) AS l18
    FROM "DetalleFactura" d
    GROUP BY d."facturaId"
)
UPDATE "Factura" f
SET "importeGravado15" = ROUND(b.l15 - f.descuentos *
        (CASE WHEN b.l15 + b.l18 > 0 THEN b.l15 / (b.l15 + b.l18) ELSE 0 END), 2),
    "importeGravado18" = ROUND(b.l18 - f.descuentos *
        (CASE WHEN b.l15 + b.l18 > 0 THEN b.l18 / (b.l15 + b.l18) ELSE 0 END), 2)
FROM bases b
WHERE b."facturaId" = f.id;

ALTER TABLE "Factura" ADD CONSTRAINT "Factura_gravados_check"
    CHECK ("importeGravado15" >= 0 AND "importeGravado18" >= 0);

-- El pie de la factura tiene que cuadrar. La tolerancia de un centavo es por
-- el redondeo, no por permisividad.
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_cuadre_bases_check"
    CHECK (abs(("importeGravado15" + "importeGravado18"
              + "importeExento"    + "importeExonerado")
             - (subtotal - descuentos)) <= 0.01);

ALTER TABLE "Factura" ADD CONSTRAINT "Factura_cuadre_isv_check"
    CHECK (abs(isv15 - ROUND("importeGravado15" * 0.15, 2)) <= 0.01
       AND abs(isv18 - ROUND("importeGravado18" * 0.18, 2)) <= 0.01);

ALTER TABLE "Factura" ADD CONSTRAINT "Factura_cuadre_total_check"
    CHECK (abs("totalPagar" - (subtotal - descuentos + isv15 + isv18)) <= 0.01);


-- ############################################################################
-- PARTE 6 - PUNTO 6.2: TIPO Y ESTADO DEL DOCUMENTO
-- ############################################################################
-- Una factura emitida no se borra nunca: se ANULA y se conserva, porque el
-- correlativo tiene que poder rendirse ante el SAR. Antes bastaba un DELETE.
--
-- Y no existian las notas de credito ni de debito, que son los documentos con
-- los que se corrige una factura ya emitida.
-- ----------------------------------------------------------------------------

CREATE TYPE "TipoDocumento" AS ENUM (
    'FACTURA',
    'NOTA_CREDITO',   -- corrige a la baja: devoluciones, descuentos posteriores
    'NOTA_DEBITO'     -- corrige al alza: cargos adicionales
);

CREATE TYPE "EstadoFactura" AS ENUM ('EMITIDA', 'ANULADA');

ALTER TABLE "Factura"
    ADD COLUMN "tipoDocumento"     "TipoDocumento" NOT NULL DEFAULT 'FACTURA',
    ADD COLUMN estado              "EstadoFactura" NOT NULL DEFAULT 'EMITIDA',
    ADD COLUMN "motivoAnulacion"   TEXT,
    ADD COLUMN "fechaAnulacion"    TIMESTAMP(3),
    ADD COLUMN "documentoOrigenId" INTEGER;

ALTER TABLE "Factura" ADD CONSTRAINT "Factura_documentoOrigenId_fkey"
    FOREIGN KEY ("documentoOrigenId") REFERENCES "Factura"(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX "Factura_documentoOrigenId_idx" ON "Factura" ("documentoOrigenId");
CREATE INDEX "Factura_estado_idx"            ON "Factura" (estado);

-- Anulada exige motivo y fecha; emitida no puede tenerlos.
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_anulacion_check"
    CHECK ((estado = 'ANULADA'
            AND "motivoAnulacion" IS NOT NULL
            AND btrim("motivoAnulacion") <> ''
            AND "fechaAnulacion" IS NOT NULL)
       OR  (estado = 'EMITIDA'
            AND "motivoAnulacion" IS NULL
            AND "fechaAnulacion"  IS NULL));

-- Una nota siempre corrige a un documento anterior; una factura no.
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_documentoOrigen_check"
    CHECK (("tipoDocumento" =  'FACTURA' AND "documentoOrigenId" IS NULL)
       OR  ("tipoDocumento" <> 'FACTURA' AND "documentoOrigenId" IS NOT NULL));

ALTER TABLE "Factura" ADD CONSTRAINT "Factura_documentoOrigen_distinto_check"
    CHECK ("documentoOrigenId" IS NULL OR "documentoOrigenId" <> id);

-- Una cita solo puede tener UNA factura vigente. Si esa factura se anula, la
-- cita vuelve a quedar facturable. Es el mismo patron del indice parcial que
-- libera el horario de una cita cancelada.
DROP INDEX "Factura_citaId_key";
CREATE UNIQUE INDEX "Factura_citaId_key"
    ON "Factura" ("citaId")
    WHERE "citaId" IS NOT NULL
      AND estado = 'EMITIDA'::"EstadoFactura"
      AND "tipoDocumento" = 'FACTURA'::"TipoDocumento";

-- Prohibir el borrado fisico.
CREATE OR REPLACE FUNCTION fn_factura_no_se_borra()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'El documento % no se puede borrar: se anula (estado = ANULADA, con motivo y fecha).',
        OLD."numeroFactura";
END $$;

CREATE TRIGGER "trg_Factura_no_borrar"
    BEFORE DELETE ON "Factura"
    FOR EACH ROW EXECUTE FUNCTION fn_factura_no_se_borra();

-- Reglas fiscales de la factura, ampliadas con la anulacion.
CREATE OR REPLACE FUNCTION fn_validar_factura()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    r      RECORD;
    v_cita RECORD;
    v_org  RECORD;
BEGIN
    -- Una vez anulada, la factura queda congelada.
    IF TG_OP = 'UPDATE' AND OLD.estado = 'ANULADA' THEN
        IF NEW.estado <> 'ANULADA' THEN
            RAISE EXCEPTION
                'El documento % ya esta anulado: no puede volver al estado %.',
                OLD."numeroFactura", NEW.estado;
        END IF;

        IF NEW."numeroFactura" <> OLD."numeroFactura"
           OR NEW.subtotal     <> OLD.subtotal
           OR NEW."totalPagar" <> OLD."totalPagar" THEN
            RAISE EXCEPTION
                'No se pueden modificar los importes del documento anulado %.',
                OLD."numeroFactura";
        END IF;
    END IF;

    -- PUNTO 6.2: el RTN del cliente es obligatorio arriba de L.100.
    -- Solo en INSERT: las facturas viejas se emitieron sin RTN y tienen que
    -- poder seguir anulandose.
    IF TG_OP = 'INSERT' AND NEW."totalPagar" > 100 AND NEW."rtnCliente" IS NULL THEN
        RAISE EXCEPTION
            'El RTN del cliente es obligatorio cuando el total supera L.100 (total: L.%).',
            NEW."totalPagar";
    END IF;

    IF NEW.estado = 'ANULADA' AND NEW."fechaAnulacion" < NEW."fechaEmision" THEN
        RAISE EXCEPTION
            'La fecha de anulacion (%) es anterior a la de emision (%).',
            NEW."fechaAnulacion", NEW."fechaEmision";
    END IF;

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

    -- Una nota de credito o de debito corrige a una FACTURA del mismo paciente.
    IF NEW."documentoOrigenId" IS NOT NULL THEN
        SELECT * INTO v_org FROM "Factura" WHERE id = NEW."documentoOrigenId";

        IF v_org."tipoDocumento" <> 'FACTURA' THEN
            RAISE EXCEPTION
                'El documento origen % no es una factura, es %.',
                v_org."numeroFactura", v_org."tipoDocumento";
        END IF;

        IF v_org."pacienteId" <> NEW."pacienteId" THEN
            RAISE EXCEPTION
                'La nota es del paciente % pero la factura origen es del paciente %.',
                NEW."pacienteId", v_org."pacienteId";
        END IF;
    END IF;

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

-- updatedAt automatico en las tablas nuevas.
CREATE TRIGGER "trg_Paciente_updated_at"
    BEFORE UPDATE ON "Paciente"
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER "trg_Emisor_updated_at"
    BEFORE UPDATE ON "Emisor"
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ############################################################################
-- PARTE 7 - VISTAS
-- ############################################################################

-- Paciente con los datos de la persona ya resueltos.
CREATE OR REPLACE VIEW "vw_Paciente" AS
SELECT
    pa.id, pa."personaId", pa."fechaRegistro", pa.activo,
    p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
    p."nombreCompleto", p.dni, p.rtn, p.telefono, p.direccion, p."fechaNac",
    u.id     AS "userId",
    u.correo,
    pa."createdAt", pa."updatedAt"
FROM "Paciente" pa
JOIN "Persona" p ON p.id = pa."personaId"
LEFT JOIN "User" u ON u."personaId" = pa."personaId";

-- Cita con el paciente y el doctor ya resueltos.
CREATE OR REPLACE VIEW "vw_Cita" AS
SELECT
    c.id,
    c."fechaHora",
    c.fecha,
    c.hora,
    c.estado,
    c."pacienteId",
    pp."nombreCompleto" AS paciente,
    pp.dni              AS "dniPaciente",
    c."empleadoId",
    pe."nombreCompleto" AS doctor,
    c."servicioId",
    s.nombre            AS servicio,
    s.precio            AS "precioServicio",
    c."createdAt", c."updatedAt"
FROM "Cita" c
JOIN "Paciente"        pa ON pa.id = c."pacienteId"
JOIN "Persona"         pp ON pp.id = pa."personaId"
JOIN "Empleado"        e  ON e.id  = c."empleadoId"
JOIN "Persona"         pe ON pe.id = e."personaId"
JOIN "ServicioClinico" s  ON s.id  = c."servicioId";

-- Factura con los datos fiscales completos, tal como deben imprimirse.
-- Se borra y se vuelve a crear porque cambian las columnas y su orden:
-- CREATE OR REPLACE VIEW solo permite agregar columnas al final.
DROP VIEW IF EXISTS "vw_Factura";
CREATE VIEW "vw_Factura" AS
SELECT
    f.id,
    f."tipoDocumento",
    f.estado,
    f."numeroFactura",
    f."documentoOrigenId",
    em."razonSocial"       AS "emisorRazonSocial",
    em."nombreComercial"   AS "emisorNombreComercial",
    em.rtn                 AS "emisorRtn",
    em.direccion           AS "emisorDireccion",
    r.cai,
    r."numeroInicial"      AS "rangoDesde",
    r."numeroFinal"        AS "rangoHasta",
    r."fechaLimiteEmision",
    f."fechaEmision",
    f."pacienteId",
    p."nombreCompleto"     AS paciente,
    p.dni,
    f."rtnCliente",
    f."empleadoId",
    f."citaId",
    f.subtotal,
    f.descuentos,
    f."importeGravado15",
    f."importeGravado18",
    f."importeExento",
    f."importeExonerado",
    f.isv15,
    f.isv18,
    f."totalPagar",
    f."motivoAnulacion",
    f."fechaAnulacion"
FROM "Factura" f
JOIN "RangoFacturacion" r  ON r.id  = f."rangoId"
JOIN "Emisor"           em ON em.id = r."emisorId"
JOIN "Paciente"         pa ON pa.id = f."pacienteId"
JOIN "Persona"          p  ON p.id  = pa."personaId";


-- ############################################################################
-- VERIFICACION FINAL
-- ############################################################################
SET client_min_messages = NOTICE;

DO $$
DECLARE
    v_citas       INTEGER;
    v_pacientes   INTEGER;
    v_facturas    INTEGER;
    v_huerfanas   INTEGER;
    v_desfase     INTEGER;
    v_descuadre   INTEGER;
BEGIN
    SELECT count(*) INTO v_citas     FROM "Cita";
    SELECT count(*) INTO v_pacientes FROM "Paciente";
    SELECT count(*) INTO v_facturas  FROM "Factura";

    -- Ninguna cita, factura o expediente puede quedar apuntando a la nada.
    SELECT count(*) INTO v_huerfanas
    FROM (
        SELECT c."pacienteId" FROM "Cita"       c LEFT JOIN "Paciente" pa ON pa.id = c."pacienteId" WHERE pa.id IS NULL
        UNION ALL
        SELECT f."pacienteId" FROM "Factura"    f LEFT JOIN "Paciente" pa ON pa.id = f."pacienteId" WHERE pa.id IS NULL
        UNION ALL
        SELECT e."pacienteId" FROM "Expediente" e LEFT JOIN "Paciente" pa ON pa.id = e."pacienteId" WHERE pa.id IS NULL
    ) x;

    -- fecha y hora generadas deben coincidir con fechaHora.
    SELECT count(*) INTO v_desfase
    FROM "Cita"
    WHERE fecha <> "fechaHora"::DATE OR hora <> "fechaHora"::TIME;

    -- El pie de todas las facturas debe cuadrar.
    SELECT count(*) INTO v_descuadre
    FROM "Factura"
    WHERE abs(("importeGravado15" + "importeGravado18" + "importeExento" + "importeExonerado")
            - (subtotal - descuentos)) > 0.01;

    IF v_huerfanas > 0 THEN
        RAISE EXCEPTION 'Quedaron % referencias a pacientes inexistentes.', v_huerfanas;
    END IF;

    IF v_desfase > 0 THEN
        RAISE EXCEPTION 'Quedaron % citas con fecha/hora desfasada de fechaHora.', v_desfase;
    END IF;

    IF v_descuadre > 0 THEN
        RAISE EXCEPTION 'Quedaron % facturas cuyo pie no cuadra.', v_descuadre;
    END IF;

    RAISE NOTICE 'Migracion 005 aplicada correctamente.';
    RAISE NOTICE 'Citas: % | Pacientes creados: % | Facturas: %',
        v_citas, v_pacientes, v_facturas;
    RAISE NOTICE 'Referencias huerfanas: % | Citas desfasadas: % | Facturas descuadradas: %',
        v_huerfanas, v_desfase, v_descuadre;
    RAISE NOTICE 'RECORDA: el RTN y la direccion del Emisor son PROVISIONALES.';
END $$;

COMMIT;

ANALYZE;
