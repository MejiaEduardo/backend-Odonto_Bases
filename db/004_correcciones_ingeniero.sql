-- ============================================================================
--  MIGRACION 004 - CORRECCIONES DEL INGENIERO + SEGUNDA AUDITORIA
--  Proyecto: Clinica Odontologica
--  Base:     PostgreSQL 16
--
--  Requiere que la migracion 003 ya este aplicada.
--
--  Cubre:
--    A) Lo que pidio el ingeniero en la revision grabada:
--       - tabla de permisos (no solo roles)
--       - campos de auditoria consistentes en todas las tablas
--       - nombres mnemonicos: doctorId -> empleadoId
--       - tabla de links con expiracion
--       - solo se puede facturar una cita COMPLETADA
--    B) Hallazgos de la segunda auditoria del esquema:
--       - recordatorios como grupo repetitivo
--       - filePath derivado
--       - CAI repetido en cada factura
--       - tasa de ISV no recuperable desde el detalle
--       - coherencia entre factura y cita
--       - doctor sin la especialidad que exige el servicio
--
--  1) RESPALDO PREVIO (obligatorio):
--     docker exec odonto-db pg_dump -U postgres -d odontologia > respaldo_previo_004.sql
--
--  2) APLICAR:
--     docker cp 004_correcciones_ingeniero.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/004_correcciones_ingeniero.sql
-- ============================================================================

BEGIN;

SET client_min_messages = WARNING;


-- ############################################################################
-- PARTE 1 - NOMBRES MNEMONICOS: doctorId -> empleadoId
-- ############################################################################
-- PEDIDO DEL INGENIERO:
--   "si a mi me dicen que tienen un campo que se llama doctor, quiere decir
--    que deben de tener una tabla que se llame doctores. Pero aqui lo que
--    tengo yo en vez de doctor es un empleado. Entonces, deberia llamarse
--    empleado I.D. Asi yo se automaticamente contra que lo voy a conectar."
--
-- La columna apunta a "Empleado", no a una tabla "Doctor" que no existe.
-- ----------------------------------------------------------------------------

ALTER TABLE "Cita"               RENAME COLUMN "doctorId" TO "empleadoId";
ALTER TABLE "Factura"            RENAME COLUMN "doctorId" TO "empleadoId";
ALTER TABLE "ExpedienteDetalle"  RENAME COLUMN "doctorId" TO "empleadoId";
ALTER TABLE "ExpedienteDoctor"   RENAME COLUMN "doctorId" TO "empleadoId";
ALTER TABLE "EspecialidadDoctor" RENAME COLUMN "doctorId" TO "empleadoId";

-- Los nombres de las restricciones e indices tambien deben reflejarlo.
ALTER TABLE "Cita"               RENAME CONSTRAINT "Cita_doctorId_fkey"               TO "Cita_empleadoId_fkey";
ALTER TABLE "Factura"            RENAME CONSTRAINT "Factura_doctorId_fkey"            TO "Factura_empleadoId_fkey";
ALTER TABLE "ExpedienteDetalle"  RENAME CONSTRAINT "ExpedienteDetalle_doctorId_fkey"  TO "ExpedienteDetalle_empleadoId_fkey";
ALTER TABLE "ExpedienteDoctor"   RENAME CONSTRAINT "ExpedienteDoctor_doctorId_fkey"   TO "ExpedienteDoctor_empleadoId_fkey";
ALTER TABLE "EspecialidadDoctor" RENAME CONSTRAINT "EspecialidadDoctor_doctorId_fkey" TO "EspecialidadDoctor_empleadoId_fkey";

ALTER INDEX "Cita_doctorId_idx"              RENAME TO "Cita_empleadoId_idx";
ALTER INDEX "Factura_doctorId_idx"           RENAME TO "Factura_empleadoId_idx";
ALTER INDEX "ExpedienteDetalle_doctorId_idx" RENAME TO "ExpedienteDetalle_empleadoId_idx";
ALTER INDEX "ExpedienteDoctor_doctorId_idx"  RENAME TO "ExpedienteDoctor_empleadoId_idx";
ALTER INDEX "Cita_doctor_fecha_hora_key"     RENAME TO "Cita_empleado_fecha_hora_key";

-- La funcion de validacion referenciaba la columna por nombre: hay que rehacerla.
DROP TRIGGER "trg_Cita_es_doctor"               ON "Cita";
DROP TRIGGER "trg_Factura_es_doctor"            ON "Factura";
DROP TRIGGER "trg_ExpedienteDetalle_es_doctor"  ON "ExpedienteDetalle";
DROP TRIGGER "trg_ExpedienteDoctor_es_doctor"   ON "ExpedienteDoctor";
DROP TRIGGER "trg_EspecialidadDoctor_es_doctor" ON "EspecialidadDoctor";

DROP FUNCTION fn_validar_es_doctor();

CREATE OR REPLACE FUNCTION fn_validar_es_doctor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_puesto TEXT;
BEGIN
    IF NEW."empleadoId" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT p.nombre INTO v_puesto
    FROM "Empleado" e
    JOIN "Puesto"  p ON p.id = e."puestoId"
    WHERE e.id = NEW."empleadoId";

    IF v_puesto IS DISTINCT FROM 'DOCTOR' THEN
        RAISE EXCEPTION
            'El empleado % no tiene puesto DOCTOR (puesto actual: %).',
            NEW."empleadoId", COALESCE(v_puesto, 'inexistente');
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER "trg_Cita_es_doctor"
    BEFORE INSERT OR UPDATE OF "empleadoId" ON "Cita"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_Factura_es_doctor"
    BEFORE INSERT OR UPDATE OF "empleadoId" ON "Factura"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_ExpedienteDetalle_es_doctor"
    BEFORE INSERT OR UPDATE OF "empleadoId" ON "ExpedienteDetalle"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_ExpedienteDoctor_es_doctor"
    BEFORE INSERT OR UPDATE OF "empleadoId" ON "ExpedienteDoctor"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_EspecialidadDoctor_es_doctor"
    BEFORE INSERT OR UPDATE OF "empleadoId" ON "EspecialidadDoctor"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

-- NOTA: "pacienteId" NO se renombra a "personaId" aunque apunte a Persona.
-- Cita y Factura tendrian dos columnas hacia Persona y el nombre generico
-- perderia significado. La solucion correcta para ese caso es una tabla
-- Paciente, que se documento como mejora pendiente.


-- ############################################################################
-- PARTE 2 - CAMPOS DE AUDITORIA CONSISTENTES
-- ############################################################################
-- PEDIDO DEL INGENIERO:
--   "Me llama la atencion porque tienen los campos de auditoria en unas
--    tablas y en otras tablas no hay campos de auditoria. [...] los campos
--    de auditoria o van o no van."
--
-- Faltaban en 6 tablas. Donde ya existia una fecha equivalente se la
-- renombra en vez de duplicarla.
-- ----------------------------------------------------------------------------

-- 2.1 EspecialidadDoctor y ExpedienteDoctor ya tenian "fechaAsociacion",
--     que es exactamente un createdAt con otro nombre. Se renombra: agregar
--     createdAt al lado habria sido duplicar el mismo dato.
ALTER TABLE "EspecialidadDoctor" RENAME COLUMN "fechaAsociacion" TO "createdAt";
ALTER TABLE "ExpedienteDoctor"   RENAME COLUMN "fechaAsociacion" TO "createdAt";

ALTER TABLE "EspecialidadDoctor"
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ExpedienteDoctor"
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "EspecialidadDoctor" SET "updatedAt" = "createdAt";
UPDATE "ExpedienteDoctor"   SET "updatedAt" = "createdAt";

-- 2.2 Empleado: se rellena con la fecha de ingreso, que es el dato real.
ALTER TABLE "Empleado"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Empleado" SET "createdAt" = "fechaIngreso", "updatedAt" = "fechaIngreso";

-- 2.3 Logs: se rellena con la hora de entrada.
ALTER TABLE "Logs"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Logs" SET "createdAt" = login, "updatedAt" = COALESCE(logout, login);

-- 2.4 HistorialCancelacionCita: se rellena con la fecha de cancelacion.
ALTER TABLE "HistorialCancelacionCita"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "HistorialCancelacionCita"
SET "createdAt" = "fechaCancelacion"::timestamp,
    "updatedAt" = "fechaCancelacion"::timestamp;

-- 2.5 ServicioEspecialidad no tenia ninguna fecha.
ALTER TABLE "ServicioEspecialidad"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- ############################################################################
-- PARTE 3 - TABLA DE PERMISOS
-- ############################################################################
-- PEDIDO DEL INGENIERO:
--   "los roles esta bien que vengan por un enum, pero yo prefiero una tabla
--    de permisos, porque con la tabla de permisos yo puedo ir uno a uno cada
--    una de las secciones del software. Cuando yo tengo un rol es bien
--    generico [...] Mientras que si ustedes dicen, ok, si quiero que mire la
--    pantalla, pero no quiero que edite nada. Entonces eso lo hago a nivel
--    de permisos."
--
-- El rol responde "quien sos". El permiso responde "que podes hacer".
-- ----------------------------------------------------------------------------

CREATE TABLE "Permiso" (
    id          SERIAL       PRIMARY KEY,
    codigo      TEXT         NOT NULL UNIQUE,
    modulo      TEXT         NOT NULL,
    descripcion TEXT         NOT NULL,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Permiso_codigo_check" CHECK (codigo ~ '^[a-z]+(\.[a-z]+)+$')
);

CREATE TABLE "RolPermiso" (
    "rolId"     INTEGER      NOT NULL,
    "permisoId" INTEGER      NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolPermiso_pkey"        PRIMARY KEY ("rolId", "permisoId"),
    CONSTRAINT "RolPermiso_rolId_fkey"     FOREIGN KEY ("rolId")     REFERENCES "Rol"(id)     ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "RolPermiso_permisoId_fkey" FOREIGN KEY ("permisoId") REFERENCES "Permiso"(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX "RolPermiso_permisoId_idx" ON "RolPermiso" ("permisoId");

-- Catalogo de permisos, deducido de lo que el ingeniero describio como
-- alcance de cada rol al inicio de la grabacion.
INSERT INTO "Permiso" (codigo, modulo, descripcion) VALUES
    ('dashboard.ver',            'Dashboard',   'Ver el panel de control de la clinica'),
    ('empleados.ver',            'Empleados',   'Ver la lista de empleados'),
    ('empleados.crear',          'Empleados',   'Contratar personal: doctores y recepcionistas'),
    ('empleados.editar',         'Empleados',   'Editar los datos de un empleado'),
    ('servicios.ver',            'Servicios',   'Ver el catalogo de servicios de la clinica'),
    ('servicios.gestionar',      'Servicios',   'Crear, editar y activar o desactivar servicios'),
    ('pacientes.crear',          'Pacientes',   'Crear el perfil de un cliente que llega a la clinica'),
    ('citas.ver',                'Citas',       'Ver todas las citas de la clinica'),
    ('citas.gestionar',          'Citas',       'Agendar, reprogramar y cancelar citas de cualquier cliente'),
    ('citas.propias.ver',        'Citas',       'Ver unicamente las citas propias'),
    ('citas.propias.gestionar',  'Citas',       'Solicitar y cancelar las citas propias'),
    ('expedientes.ver',          'Expedientes', 'Ver los expedientes de los clientes'),
    ('expedientes.editar',       'Expedientes', 'Editar el expediente de un cliente'),
    ('archivos.subir',           'Expedientes', 'Adjuntar archivos a un expediente'),
    ('facturas.ver',             'Facturas',    'Ver las facturas emitidas'),
    ('facturas.emitir',          'Facturas',    'Emitir una factura sobre una cita completada'),
    ('perfil.propio.editar',     'Perfil',      'Editar el perfil propio');

-- ADMIN: "dirige la clinica [...] tendra acceso a contratar personal, como
-- ser doctores y recepcionistas [...] un dashboard para ver como se maneja
-- la clinica, ver la cantidad de facturas [...] gestionar los servicios [...]
-- y ver los expedientes".
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 1, id FROM "Permiso" WHERE codigo IN (
    'dashboard.ver', 'empleados.ver', 'empleados.crear', 'empleados.editar',
    'servicios.ver', 'servicios.gestionar', 'citas.ver',
    'expedientes.ver', 'facturas.ver', 'perfil.propio.editar');

-- DOCTOR: "podra ver la lista de citas que tiene para atender en el dia,
-- ver los expedientes de los clientes y tambien podra editarlos. Es el
-- unico que puede editar los expedientes".
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 2, id FROM "Permiso" WHERE codigo IN (
    'citas.propias.ver', 'expedientes.ver', 'expedientes.editar',
    'archivos.subir', 'servicios.ver', 'perfil.propio.editar');

-- RECEPCIONISTA: "puede crear perfiles a los clientes [...] gestionar las
-- citas de los clientes, ver los expedientes, y puede facturar. Es la unica
-- opcion que puede facturar".
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 3, id FROM "Permiso" WHERE codigo IN (
    'pacientes.crear', 'citas.ver', 'citas.gestionar', 'expedientes.ver',
    'facturas.ver', 'facturas.emitir', 'servicios.ver', 'perfil.propio.editar');

-- CLIENTE: "podra crear su perfil [...] tendra acceso a gestionar las citas,
-- las cuales se mostraran, son los horarios disponibles, tambien podra
-- editar su perfil".
INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 4, id FROM "Permiso" WHERE codigo IN (
    'citas.propias.ver', 'citas.propias.gestionar',
    'servicios.ver', 'perfil.propio.editar');

-- Comprobacion: las dos exclusividades que el ingeniero remarco.
DO $$
DECLARE
    v_n INTEGER;
BEGIN
    SELECT count(*) INTO v_n FROM "RolPermiso" rp
    JOIN "Permiso" p ON p.id = rp."permisoId" WHERE p.codigo = 'facturas.emitir';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'facturas.emitir debe pertenecer solo a RECEPCIONISTA (tiene % roles).', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM "RolPermiso" rp
    JOIN "Permiso" p ON p.id = rp."permisoId" WHERE p.codigo = 'expedientes.editar';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'expedientes.editar debe pertenecer solo a DOCTOR (tiene % roles).', v_n;
    END IF;
END $$;

-- Vista para que el backend resuelva los permisos de un usuario en una consulta.
CREATE OR REPLACE VIEW "vw_PermisosUsuario" AS
SELECT
    u.id       AS "userId",
    u.correo,
    r.nombre   AS rol,
    p.codigo   AS permiso,
    p.modulo
FROM "User" u
JOIN "Rol"        r  ON r.id  = u."rolId"
JOIN "RolPermiso" rp ON rp."rolId" = r.id
JOIN "Permiso"    p  ON p.id  = rp."permisoId"
WHERE u.activo AND r.activo AND p.activo;


-- ############################################################################
-- PARTE 4 - LINKS CON EXPIRACION
-- ############################################################################
-- PEDIDO DEL INGENIERO:
--   "aqui lo que necesitan ustedes son links por tiempo. O links vivos o
--    links alive [...] Yo genero un link y voy a tener una tabla donde yo voy
--    a tener ese link por aqui y aqui le pongo cuando expira. [...] en el
--    backend va a validar si lo que nosotros le mandamos esta vivo o no."
--
-- "CodigoVerificacion" ya hacia la mitad del trabajo pero solo servia para
-- verificar la cuenta. Se generaliza a TokenAcceso, que cubre ambos usos.
-- ----------------------------------------------------------------------------

CREATE TYPE "TipoToken" AS ENUM (
    'VERIFICACION_CORREO',
    'CAMBIO_PASSWORD'
);

CREATE TABLE "TokenAcceso" (
    id          SERIAL       PRIMARY KEY,
    "userId"    INTEGER      NOT NULL,
    token       TEXT         NOT NULL,
    tipo        "TipoToken"  NOT NULL,
    "expiraEn"  TIMESTAMP(3) NOT NULL,
    "usadoEn"   TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenAcceso_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "TokenAcceso_token_key"       UNIQUE (token),
    CONSTRAINT "TokenAcceso_expiracion_check" CHECK ("expiraEn" > "createdAt"),
    CONSTRAINT "TokenAcceso_usadoEn_check"    CHECK ("usadoEn" IS NULL OR "usadoEn" >= "createdAt")
);

CREATE INDEX "TokenAcceso_userId_idx" ON "TokenAcceso" ("userId");
CREATE INDEX "TokenAcceso_expiraEn_idx" ON "TokenAcceso" ("expiraEn");

-- Un usuario no puede tener dos tokens vivos del mismo tipo a la vez.
CREATE UNIQUE INDEX "TokenAcceso_vivo_key"
    ON "TokenAcceso" ("userId", tipo)
    WHERE "usadoEn" IS NULL;

-- Migrar los codigos existentes. Los ya usados no se pueden distinguir entre
-- si por el indice de arriba porque tienen usadoEn no nulo.
INSERT INTO "TokenAcceso" ("userId", token, tipo, "expiraEn", "usadoEn", "createdAt", "updatedAt")
SELECT
    cv."userId",
    cv.codigo || '-' || cv.id,          -- el codigo solo no es unico entre usuarios
    'VERIFICACION_CORREO',
    cv."fechaExpiracion",
    CASE WHEN cv.usado THEN cv."fechaCreacion" ELSE NULL END,
    cv."fechaCreacion",
    cv."fechaCreacion"
FROM "CodigoVerificacion" cv;

DROP TABLE "CodigoVerificacion";


-- ############################################################################
-- PARTE 5 - RECORDATORIOS: eliminar el grupo repetitivo
-- ############################################################################
-- HALLAZGO DE AUDITORIA: "Cita" tenia recordatorio1h y recordatorio24h, dos
-- columnas para el mismo hecho con distinto parametro. Agregar un recordatorio
-- de 48 horas obligaba a modificar la tabla. Es un grupo repetitivo, que es
-- justo lo que la primera forma normal prohibe.
-- ----------------------------------------------------------------------------

CREATE TYPE "TipoRecordatorio" AS ENUM ('24H', '1H');

CREATE TABLE "RecordatorioCita" (
    id          SERIAL             PRIMARY KEY,
    "citaId"    INTEGER            NOT NULL,
    tipo        "TipoRecordatorio" NOT NULL,
    "enviadoEn" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordatorioCita_citaId_fkey"
        FOREIGN KEY ("citaId") REFERENCES "Cita"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "RecordatorioCita_citaId_tipo_key" UNIQUE ("citaId", tipo)
);

CREATE INDEX "RecordatorioCita_citaId_idx" ON "RecordatorioCita" ("citaId");

INSERT INTO "RecordatorioCita" ("citaId", tipo)
SELECT id, '24H' FROM "Cita" WHERE recordatorio24h;

INSERT INTO "RecordatorioCita" ("citaId", tipo)
SELECT id, '1H'  FROM "Cita" WHERE recordatorio1h;

ALTER TABLE "Cita"
    DROP COLUMN recordatorio1h,
    DROP COLUMN recordatorio24h;


-- ############################################################################
-- PARTE 6 - ExpedienteArchivo.filePath: dato derivado
-- ############################################################################
-- HALLAZGO DE AUDITORIA: todos los valores son '/archivos/expedientes/<id>/',
-- siempre deducibles del expedienteId. Se convierte en columna calculada.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    v_malos INTEGER;
BEGIN
    SELECT count(*) INTO v_malos
    FROM "ExpedienteArchivo"
    WHERE "filePath" <> '/archivos/expedientes/' || "expedienteId" || '/';

    IF v_malos > 0 THEN
        RAISE EXCEPTION
            'Migracion abortada: % archivo(s) con filePath fuera del patron esperado. Revisar antes de convertir la columna.', v_malos;
    END IF;
END $$;

ALTER TABLE "ExpedienteArchivo" DROP COLUMN "filePath";

ALTER TABLE "ExpedienteArchivo"
    ADD COLUMN "filePath" TEXT
    GENERATED ALWAYS AS ('/archivos/expedientes/' || "expedienteId" || '/') STORED;


-- ############################################################################
-- PARTE 7 - FACTURACION
-- ############################################################################

-- 7.1 El CAI estaba repetido identico en cada factura.
-- No es un dato de la factura: es un dato del rango de facturacion autorizado
-- por el SAR, junto con el rango de correlativos y la fecha limite de emision.
-- Ninguno de esos dos ultimos existia, y ambos son obligatorios
-- (Acuerdo 481-2017, regimen de facturacion).

CREATE TABLE "RangoFacturacion" (
    id                    SERIAL       PRIMARY KEY,
    cai                   TEXT         NOT NULL,
    "numeroInicial"       TEXT         NOT NULL,
    "numeroFinal"         TEXT         NOT NULL,
    "fechaLimiteEmision"  DATE         NOT NULL,
    activo                BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RangoFacturacion_cai_key" UNIQUE (cai),
    CONSTRAINT "RangoFacturacion_cai_check"    CHECK (btrim(cai) <> ''),
    CONSTRAINT "RangoFacturacion_inicial_check" CHECK ("numeroInicial" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$'),
    CONSTRAINT "RangoFacturacion_final_check"   CHECK ("numeroFinal"   ~ '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$'),
    CONSTRAINT "RangoFacturacion_orden_check"   CHECK ("numeroFinal" >= "numeroInicial")
);

-- Se crea un rango por cada CAI distinto que ya existiera en las facturas.
-- OJO: numeroFinal y fechaLimiteEmision son valores provisionales. Hay que
-- reemplazarlos por los que figuren en la autorizacion real del SAR.
INSERT INTO "RangoFacturacion" (cai, "numeroInicial", "numeroFinal", "fechaLimiteEmision")
SELECT DISTINCT
    f.cai,
    '000-001-01-00000001',
    '000-001-01-00001000',
    (CURRENT_DATE + INTERVAL '1 year')::date
FROM "Factura" f;

ALTER TABLE "Factura" ADD COLUMN "rangoId" INTEGER;

UPDATE "Factura" f
SET "rangoId" = r.id
FROM "RangoFacturacion" r
WHERE r.cai = f.cai;

DO $$
DECLARE
    v_sin_rango INTEGER;
BEGIN
    SELECT count(*) INTO v_sin_rango FROM "Factura" WHERE "rangoId" IS NULL;
    IF v_sin_rango > 0 THEN
        RAISE EXCEPTION 'Migracion abortada: % factura(s) sin rango asignado.', v_sin_rango;
    END IF;
END $$;

ALTER TABLE "Factura"
    ALTER COLUMN "rangoId" SET NOT NULL,
    ADD CONSTRAINT "Factura_rangoId_fkey"
        FOREIGN KEY ("rangoId") REFERENCES "RangoFacturacion"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    ADD CONSTRAINT "Factura_numeroFactura_formato_check"
        CHECK ("numeroFactura" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$');

ALTER TABLE "Factura" DROP COLUMN cai;

CREATE INDEX "Factura_rangoId_idx" ON "Factura" ("rangoId");

-- 7.2 aplicaISV era un booleano, pero la factura guarda isv15 e isv18.
-- No habia forma de saber que tasa se le aplico a cada linea, asi que el
-- impuesto no era recalculable desde el detalle. Ahora se guarda la tasa.
ALTER TABLE "DetalleFactura" ADD COLUMN "tasaISV" NUMERIC(4,2);

UPDATE "DetalleFactura" SET "tasaISV" = CASE WHEN "aplicaISV" THEN 0.15 ELSE 0.00 END;

ALTER TABLE "DetalleFactura"
    ALTER COLUMN "tasaISV" SET NOT NULL,
    ALTER COLUMN "tasaISV" SET DEFAULT 0.15,
    ADD CONSTRAINT "DetalleFactura_tasaISV_check"
        CHECK ("tasaISV" IN (0.00, 0.15, 0.18));

ALTER TABLE "DetalleFactura" DROP COLUMN "aplicaISV";

-- 7.3 La factura no puede emitirse fuera del rango ni vencido el CAI.
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

CREATE TRIGGER "trg_Factura_validar"
    BEFORE INSERT OR UPDATE ON "Factura"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_factura();


-- ############################################################################
-- PARTE 8 - EL DOCTOR DEBE TENER LA ESPECIALIDAD QUE EXIGE EL SERVICIO
-- ############################################################################
-- El ingeniero describio para que sirven esas tablas:
--   "hay servicios odontologicos que requieren una especialidad de un doctor.
--    Entonces eso es lo que se brinda para poder ver si se puede dar, si en
--    ese momento tenemos un doctor disponible para ese servicio o no."
--
-- Pero nada lo validaba: 8 de las 9 citas activas tenian un doctor sin la
-- especialidad del servicio. Primero se corrigen los datos, despues se
-- activa la regla.
-- ----------------------------------------------------------------------------

-- 8.1 Corregir los datos: se le acredita a cada doctor la especialidad de los
--     servicios que ya venia atendiendo.
INSERT INTO "EspecialidadDoctor" ("empleadoId", "especialidadId")
SELECT DISTINCT c."empleadoId", se."especialidadId"
FROM "Cita" c
JOIN "ServicioEspecialidad" se ON se."servicioId" = c."servicioId"
ON CONFLICT DO NOTHING;

-- 8.2 Activar la regla.
CREATE OR REPLACE FUNCTION fn_validar_especialidad_cita()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_requiere BOOLEAN;
    v_tiene    BOOLEAN;
BEGIN
    SELECT EXISTS(SELECT 1 FROM "ServicioEspecialidad" WHERE "servicioId" = NEW."servicioId")
      INTO v_requiere;

    -- Un servicio sin especialidad asociada lo puede atender cualquier doctor.
    IF NOT v_requiere THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS(
        SELECT 1
        FROM "ServicioEspecialidad" se
        JOIN "EspecialidadDoctor" ed
          ON ed."especialidadId" = se."especialidadId"
        WHERE se."servicioId"  = NEW."servicioId"
          AND ed."empleadoId"  = NEW."empleadoId"
    ) INTO v_tiene;

    IF NOT v_tiene THEN
        RAISE EXCEPTION
            'El doctor % no tiene la especialidad que requiere el servicio %.',
            NEW."empleadoId", NEW."servicioId";
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER "trg_Cita_especialidad"
    BEFORE INSERT OR UPDATE OF "empleadoId", "servicioId" ON "Cita"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_especialidad_cita();


-- ############################################################################
-- PARTE 9 - TRIGGERS DE updatedAt PARA LAS TABLAS NUEVAS Y MODIFICADAS
-- ############################################################################

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables tb
          ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name  = 'updatedAt'
          AND tb.table_type  = 'BASE TABLE'
          AND NOT EXISTS (
              SELECT 1 FROM information_schema.triggers tr
              WHERE tr.trigger_schema = 'public'
                AND tr.event_object_table = c.table_name
                AND tr.trigger_name = 'trg_' || c.table_name || '_updated_at')
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()',
            'trg_' || t.table_name || '_updated_at', t.table_name);
    END LOOP;
END $$;


-- ############################################################################
-- PARTE 10 - ACTUALIZAR LAS VISTAS AL NUEVO ESQUEMA
-- ############################################################################

CREATE OR REPLACE VIEW "vw_Empleado" AS
SELECT
    e.id,
    e."personaId",
    pu.nombre AS puesto,
    e."puestoId",
    e.salario,
    e."fechaIngreso",
    e.activo,
    p."primerNombre",
    p."segundoNombre",
    p."primerApellido",
    p."segundoApellido",
    p."nombreCompleto",
    p.dni,
    p.telefono
FROM "Empleado" e
JOIN "Puesto"  pu ON pu.id = e."puestoId"
JOIN "Persona" p  ON p.id  = e."personaId";

-- Factura con los datos fiscales del rango, tal como deben imprimirse.
CREATE OR REPLACE VIEW "vw_Factura" AS
SELECT
    f.id,
    f."numeroFactura",
    r.cai,
    r."numeroInicial"      AS "rangoDesde",
    r."numeroFinal"        AS "rangoHasta",
    r."fechaLimiteEmision",
    f."fechaEmision",
    f."pacienteId",
    p."nombreCompleto"     AS paciente,
    p.dni,
    f."empleadoId",
    f."citaId",
    f.subtotal,
    f.descuentos,
    f."importeExonerado",
    f."importeExento",
    f.isv15,
    f.isv18,
    f."totalPagar"
FROM "Factura" f
JOIN "RangoFacturacion" r ON r.id = f."rangoId"
JOIN "Persona"          p ON p.id = f."pacienteId";


-- ############################################################################
-- VERIFICACION FINAL
-- ############################################################################
DO $$
DECLARE
    v_permisos      INTEGER;
    v_rolpermisos   INTEGER;
    v_recordatorios INTEGER;
    v_tokens        INTEGER;
    v_rangos        INTEGER;
    v_doctorid      INTEGER;
    v_sin_auditoria INTEGER;
BEGIN
    SELECT count(*) INTO v_permisos      FROM "Permiso";
    SELECT count(*) INTO v_rolpermisos   FROM "RolPermiso";
    SELECT count(*) INTO v_recordatorios FROM "RecordatorioCita";
    SELECT count(*) INTO v_tokens        FROM "TokenAcceso";
    SELECT count(*) INTO v_rangos        FROM "RangoFacturacion";

    SELECT count(*) INTO v_doctorid
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'doctorId';

    SELECT count(*) INTO v_sin_auditoria
    FROM (
        SELECT t.tablename
        FROM pg_tables t
        JOIN information_schema.columns c
          ON c.table_name = t.tablename AND c.table_schema = 'public'
        WHERE t.schemaname = 'public'
        GROUP BY t.tablename
        HAVING NOT bool_or(c.column_name = 'createdAt')
            OR NOT bool_or(c.column_name = 'updatedAt')
    ) x;

    IF v_doctorid > 0 THEN
        RAISE EXCEPTION 'Quedaron % columnas llamadas doctorId.', v_doctorid;
    END IF;

    IF v_sin_auditoria > 0 THEN
        RAISE EXCEPTION 'Quedaron % tablas sin campos de auditoria.', v_sin_auditoria;
    END IF;

    RAISE NOTICE 'Migracion 004 aplicada correctamente.';
    RAISE NOTICE 'Permisos: % | Asignaciones rol-permiso: %', v_permisos, v_rolpermisos;
    RAISE NOTICE 'Recordatorios: % | Tokens: % | Rangos de facturacion: %',
        v_recordatorios, v_tokens, v_rangos;
    RAISE NOTICE 'Columnas doctorId restantes: % | Tablas sin auditoria: %',
        v_doctorid, v_sin_auditoria;
END $$;

COMMIT;

ANALYZE;
