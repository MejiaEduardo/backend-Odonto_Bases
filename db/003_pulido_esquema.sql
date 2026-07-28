-- ============================================================================
--  MIGRACION 003 - PULIDO Y NORMALIZACION DEL ESQUEMA
--  Proyecto: Clinica Odontologica
--  Base:     PostgreSQL 16
--
--  Esta migracion corrige los problemas detectados en la auditoria del
--  esquema. Se ejecuta completa dentro de una transaccion: si cualquier
--  paso falla, NO se aplica ningun cambio.
--
--  La base corre en Docker: contenedor "odonto-db", base "odontologia".
--
--  1) RESPALDO PREVIO (obligatorio):
--     docker exec odonto-db pg_dump -U postgres -d odontologia > respaldo_previo.sql
--
--  2) APLICAR:
--     docker cp 003_pulido_esquema.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/003_pulido_esquema.sql
--
--  3) SI ALGO SALE MAL, REVERTIR:
--     docker cp 003_rollback.sql odonto-db:/tmp/
--     docker exec odonto-db psql -U postgres -d odontologia -f /tmp/003_rollback.sql
-- ============================================================================

BEGIN;

SET client_min_messages = WARNING;


-- ############################################################################
-- PARTE 1 - PERSONA: eliminar la duplicacion de nombre / apellido
-- ############################################################################
-- PROBLEMA: la tabla guardaba el mismo dato dos veces (nombre/apellido y
-- primerNombre/segundoNombre/primerApellido/segundoApellido). Es redundancia
-- pura: los dos juegos de columnas se desincronizan en cuanto alguien edita
-- uno solo. La migracion 002 copio los datos pero nunca elimino los viejos.
-- SOLUCION: se conservan las cuatro columnas nuevas y se elimina el par viejo.
-- Para no perder la comodidad de tener el nombre armado, se agrega la columna
-- calculada "nombreCompleto", que PostgreSQL mantiene sola y siempre correcta.
-- ----------------------------------------------------------------------------

-- 1.1 Rellenar las columnas nuevas para cualquier fila que se haya creado
--     despues de la migracion 002 y haya quedado en NULL.
UPDATE "Persona"
SET
    "primerNombre"    = COALESCE(NULLIF(btrim("primerNombre"), ''),
                                 NULLIF(split_part(btrim(nombre), ' ', 1), '')),
    "segundoNombre"   = COALESCE(NULLIF(btrim("segundoNombre"), ''),
                                 NULLIF(split_part(btrim(nombre), ' ', 2), '')),
    "primerApellido"  = COALESCE(NULLIF(btrim("primerApellido"), ''),
                                 NULLIF(split_part(btrim(apellido), ' ', 1), '')),
    "segundoApellido" = COALESCE(NULLIF(btrim("segundoApellido"), ''),
                                 NULLIF(split_part(btrim(apellido), ' ', 2), ''));

-- 1.2 Verificacion de seguridad: abortar si quedo alguien sin nombre.
DO $$
DECLARE
    v_faltantes INTEGER;
BEGIN
    SELECT count(*) INTO v_faltantes
    FROM "Persona"
    WHERE "primerNombre" IS NULL OR "primerApellido" IS NULL;

    IF v_faltantes > 0 THEN
        RAISE EXCEPTION
            'Migracion abortada: % persona(s) quedaron sin primerNombre o primerApellido.', v_faltantes;
    END IF;
END $$;

-- 1.3 Los nombres pasan a ser obligatorios.
ALTER TABLE "Persona"
    ALTER COLUMN "primerNombre"   SET NOT NULL,
    ALTER COLUMN "primerApellido" SET NOT NULL;

-- 1.4 Eliminar las columnas redundantes.
ALTER TABLE "Persona"
    DROP COLUMN nombre,
    DROP COLUMN apellido;

-- 1.5 Columna calculada: la mantiene PostgreSQL, no se puede desincronizar.
--     El backend y el frontend pueden seguir leyendo un solo campo.
ALTER TABLE "Persona"
    ADD COLUMN "nombreCompleto" TEXT
    GENERATED ALWAYS AS (
        "primerNombre"
        || COALESCE(' ' || "segundoNombre", '')
        || ' ' || "primerApellido"
        || COALESCE(' ' || "segundoApellido", '')
    ) STORED;

-- 1.6 Reglas de calidad de los nombres.
ALTER TABLE "Persona"
    ADD CONSTRAINT "Persona_primerNombre_check"
        CHECK (btrim("primerNombre") <> ''),
    ADD CONSTRAINT "Persona_primerApellido_check"
        CHECK (btrim("primerApellido") <> ''),
    ADD CONSTRAINT "Persona_segundoNombre_check"
        CHECK ("segundoNombre" IS NULL OR btrim("segundoNombre") <> ''),
    ADD CONSTRAINT "Persona_segundoApellido_check"
        CHECK ("segundoApellido" IS NULL OR btrim("segundoApellido") <> '');

-- 1.7 DNI unico. Sin esto la misma persona se puede registrar dos veces,
--     que es exactamente el bug que ya sufrio el proyecto.
--     UNIQUE en PostgreSQL permite varios NULL, asi que las personas sin
--     DNI cargado siguen siendo validas.
UPDATE "Persona" SET dni = NULLIF(btrim(dni), '');

ALTER TABLE "Persona"
    ADD CONSTRAINT "Persona_dni_key" UNIQUE (dni),
    ADD CONSTRAINT "Persona_dni_formato_check"
        CHECK (dni IS NULL OR dni ~ '^[0-9]{13}$');

-- 1.8 La fecha de nacimiento es una fecha, no un instante con hora.
ALTER TABLE "Persona"
    ALTER COLUMN "fechaNac" TYPE DATE USING "fechaNac"::date;

ALTER TABLE "Persona"
    ADD CONSTRAINT "Persona_fechaNac_check"
        CHECK ("fechaNac" IS NULL OR "fechaNac" > DATE '1900-01-01');

-- 1.9 Telefono: formato de Honduras (8 digitos) cuando venga cargado.
UPDATE "Persona" SET telefono = NULLIF(btrim(telefono), '');

ALTER TABLE "Persona"
    ADD CONSTRAINT "Persona_telefono_formato_check"
        CHECK (telefono IS NULL OR telefono ~ '^[0-9]{8}$');


-- ############################################################################
-- PARTE 2 - CATALOGOS: reemplazar los ENUM Rol y Puesto por tablas
-- ############################################################################
-- PROBLEMA: un ENUM de PostgreSQL es rigido (agregar un valor exige ALTER TYPE,
-- quitarlo es casi imposible) y ademas Rol y Puesto guardaban el mismo hecho
-- por duplicado, sin nada que los mantuviera de acuerdo.
-- SOLUCION: dos tablas catalogo independientes con significados distintos:
--   Rol    -> nivel de acceso al sistema (permisos)
--   Puesto -> cargo laboral del empleado (nomina, salario)
-- ----------------------------------------------------------------------------

-- 2.0 En PostgreSQL una tabla y un tipo comparten el mismo espacio de nombres,
--     asi que no se puede crear la tabla "Rol" mientras exista el ENUM "Rol".
--     Primero pasamos las columnas a TEXT, luego eliminamos los ENUM y recien
--     entonces creamos los catalogos.
ALTER TABLE "User"     ALTER COLUMN rol    DROP DEFAULT;
ALTER TABLE "User"     ALTER COLUMN rol    TYPE TEXT USING rol::text;
ALTER TABLE "Empleado" ALTER COLUMN puesto TYPE TEXT USING puesto::text;

DROP TYPE "Rol";
DROP TYPE "Puesto";

-- NOTA: el ENUM "EstadoCita" se mantiene a proposito. Los estados de una cita
-- son un conjunto cerrado que define la logica de negocio, no un catalogo que
-- el usuario administre. Ahi el ENUM si es la herramienta correcta.

-- 2.1 Catalogo de roles de acceso.
CREATE TABLE "Rol" (
    id          INTEGER      NOT NULL,
    nombre      TEXT         NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rol_pkey"        PRIMARY KEY (id),
    CONSTRAINT "Rol_nombre_key"  UNIQUE (nombre),
    CONSTRAINT "Rol_nombre_check" CHECK (btrim(nombre) <> '')
);

CREATE SEQUENCE "Rol_id_seq" AS INTEGER OWNED BY "Rol".id;
ALTER TABLE "Rol" ALTER COLUMN id SET DEFAULT nextval('"Rol_id_seq"');

INSERT INTO "Rol" (id, nombre, descripcion) VALUES
    (1, 'ADMIN',         'Acceso total al sistema y a la configuracion'),
    (2, 'DOCTOR',        'Gestiona sus citas y los expedientes de sus pacientes'),
    (3, 'RECEPCIONISTA', 'Agenda citas, registra pacientes y emite facturas'),
    (4, 'CLIENTE',       'Paciente: solicita y consulta sus propias citas');

SELECT setval('"Rol_id_seq"', (SELECT max(id) FROM "Rol"));

-- 2.2 Catalogo de puestos laborales.
CREATE TABLE "Puesto" (
    id          INTEGER      NOT NULL,
    nombre      TEXT         NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Puesto_pkey"         PRIMARY KEY (id),
    CONSTRAINT "Puesto_nombre_key"   UNIQUE (nombre),
    CONSTRAINT "Puesto_nombre_check" CHECK (btrim(nombre) <> '')
);

CREATE SEQUENCE "Puesto_id_seq" AS INTEGER OWNED BY "Puesto".id;
ALTER TABLE "Puesto" ALTER COLUMN id SET DEFAULT nextval('"Puesto_id_seq"');

INSERT INTO "Puesto" (id, nombre, descripcion) VALUES
    (1, 'DOCTOR',        'Odontologo que atiende pacientes'),
    (2, 'RECEPCIONISTA', 'Atencion al publico y agenda'),
    (3, 'ADMIN',         'Administracion de la clinica'),
    (4, 'OTRO',          'Otros cargos del personal');

SELECT setval('"Puesto_id_seq"', (SELECT max(id) FROM "Puesto"));

-- 2.3 User.rol (ENUM) -> User.rolId (FK).
ALTER TABLE "User" ADD COLUMN "rolId" INTEGER;

UPDATE "User" u
SET "rolId" = r.id
FROM "Rol" r
WHERE r.nombre = u.rol;

DO $$
DECLARE
    v_sin_rol INTEGER;
BEGIN
    SELECT count(*) INTO v_sin_rol FROM "User" WHERE "rolId" IS NULL;
    IF v_sin_rol > 0 THEN
        RAISE EXCEPTION 'Migracion abortada: % usuario(s) sin rol mapeado.', v_sin_rol;
    END IF;
END $$;

ALTER TABLE "User"
    ALTER COLUMN "rolId" SET NOT NULL,
    ALTER COLUMN "rolId" SET DEFAULT 4,      -- 4 = CLIENTE
    ADD CONSTRAINT "User_rolId_fkey"
        FOREIGN KEY ("rolId") REFERENCES "Rol"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "User" DROP COLUMN rol;

-- 2.4 Empleado.puesto (ENUM) -> Empleado.puestoId (FK).
ALTER TABLE "Empleado" ADD COLUMN "puestoId" INTEGER;

UPDATE "Empleado" e
SET "puestoId" = p.id
FROM "Puesto" p
WHERE p.nombre = e.puesto;

DO $$
DECLARE
    v_sin_puesto INTEGER;
BEGIN
    SELECT count(*) INTO v_sin_puesto FROM "Empleado" WHERE "puestoId" IS NULL;
    IF v_sin_puesto > 0 THEN
        RAISE EXCEPTION 'Migracion abortada: % empleado(s) sin puesto mapeado.', v_sin_puesto;
    END IF;
END $$;

ALTER TABLE "Empleado"
    ALTER COLUMN "puestoId" SET NOT NULL,
    ADD CONSTRAINT "Empleado_puestoId_fkey"
        FOREIGN KEY ("puestoId") REFERENCES "Puesto"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "Empleado" DROP COLUMN puesto;

-- 2.5 HistorialCancelacionCita.rolCancela (texto libre) -> FK al catalogo.
ALTER TABLE "HistorialCancelacionCita" ADD COLUMN "rolCancelaId" INTEGER;

UPDATE "HistorialCancelacionCita" h
SET "rolCancelaId" = r.id
FROM "Rol" r
WHERE r.nombre = upper(btrim(h."rolCancela"));

DO $$
DECLARE
    v_sin_rol INTEGER;
BEGIN
    SELECT count(*) INTO v_sin_rol
    FROM "HistorialCancelacionCita" WHERE "rolCancelaId" IS NULL;
    IF v_sin_rol > 0 THEN
        RAISE EXCEPTION 'Migracion abortada: % cancelacion(es) con rol desconocido.', v_sin_rol;
    END IF;
END $$;

ALTER TABLE "HistorialCancelacionCita"
    ALTER COLUMN "rolCancelaId" SET NOT NULL,
    ADD CONSTRAINT "HistorialCancelacionCita_rolCancelaId_fkey"
        FOREIGN KEY ("rolCancelaId") REFERENCES "Rol"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "HistorialCancelacionCita" DROP COLUMN "rolCancela";


-- ############################################################################
-- PARTE 3 - TIPOS DE DATOS CORRECTOS
-- ############################################################################

-- 3.1 Cita: la fecha y la hora estaban guardadas como TEXTO.
--     Asi no se puede ordenar, comparar ni calcular rangos de forma confiable,
--     y nada impide guardar '32/13/2026' o 'manana'.
ALTER TABLE "Cita"
    ALTER COLUMN fecha TYPE DATE USING fecha::date,
    ALTER COLUMN hora  TYPE TIME USING hora::time;

-- 3.2 Dinero: double precision es punto flotante binario y pierde centavos.
--     En facturacion el total deja de cuadrar con la suma de los detalles.
--     NUMERIC es decimal exacto.
ALTER TABLE "Empleado"
    ALTER COLUMN salario TYPE NUMERIC(12,2);

ALTER TABLE "ServicioClinico"
    ALTER COLUMN precio TYPE NUMERIC(12,2);

ALTER TABLE "Factura"
    ALTER COLUMN subtotal            TYPE NUMERIC(12,2),
    ALTER COLUMN descuentos          TYPE NUMERIC(12,2),
    ALTER COLUMN "importeExonerado"  TYPE NUMERIC(12,2),
    ALTER COLUMN "importeExento"     TYPE NUMERIC(12,2),
    ALTER COLUMN isv15               TYPE NUMERIC(12,2),
    ALTER COLUMN isv18               TYPE NUMERIC(12,2),
    ALTER COLUMN "totalPagar"        TYPE NUMERIC(12,2);

ALTER TABLE "DetalleFactura"
    ALTER COLUMN "precioUnitario" TYPE NUMERIC(12,2),
    ALTER COLUMN "totalLinea"     TYPE NUMERIC(12,2);

-- 3.3 DetalleFactura.totalLinea era un dato derivado guardado a mano
--     (cantidad * precioUnitario). Se convierte en columna calculada para que
--     no pueda quedar mal. Se valida primero que los datos actuales cuadren.
DO $$
DECLARE
    v_malos INTEGER;
BEGIN
    SELECT count(*) INTO v_malos
    FROM "DetalleFactura"
    WHERE "totalLinea" <> (cantidad * "precioUnitario");

    IF v_malos > 0 THEN
        RAISE EXCEPTION
            'Migracion abortada: % linea(s) de factura con totalLinea inconsistente.', v_malos;
    END IF;
END $$;

ALTER TABLE "DetalleFactura" DROP COLUMN "totalLinea";

ALTER TABLE "DetalleFactura"
    ADD COLUMN "totalLinea" NUMERIC(12,2)
    GENERATED ALWAYS AS (cantidad * "precioUnitario") STORED;


-- ############################################################################
-- PARTE 4 - REGLAS DE INTEGRIDAD
-- ############################################################################

-- 4.1 EL BUG MAS GRAVE: nada impedia agendar dos citas al mismo doctor
--     a la misma hora del mismo dia.
--     El indice es PARCIAL: las citas canceladas no bloquean el horario,
--     porque ese espacio queda libre otra vez.
CREATE UNIQUE INDEX "Cita_doctor_fecha_hora_key"
    ON "Cita" ("doctorId", fecha, hora)
    WHERE estado <> 'CANCELADA'::"EstadoCita";

-- 4.2 Un paciente tampoco puede estar en dos lugares a la vez.
CREATE UNIQUE INDEX "Cita_paciente_fecha_hora_key"
    ON "Cita" ("pacienteId", fecha, hora)
    WHERE estado <> 'CANCELADA'::"EstadoCita";

-- 4.3 Cita.doctorId apunta a Empleado, pero nada verificaba que ese empleado
--     fuera DOCTOR: se podia agendar una cita con la recepcionista.
--     Se resuelve con una funcion de validacion reutilizable.
CREATE OR REPLACE FUNCTION fn_validar_es_doctor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_puesto TEXT;
BEGIN
    IF NEW."doctorId" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT p.nombre INTO v_puesto
    FROM "Empleado" e
    JOIN "Puesto"  p ON p.id = e."puestoId"
    WHERE e.id = NEW."doctorId";

    IF v_puesto IS DISTINCT FROM 'DOCTOR' THEN
        RAISE EXCEPTION
            'El empleado % no tiene puesto DOCTOR (puesto actual: %).',
            NEW."doctorId", COALESCE(v_puesto, 'inexistente');
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER "trg_Cita_es_doctor"
    BEFORE INSERT OR UPDATE OF "doctorId" ON "Cita"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_Factura_es_doctor"
    BEFORE INSERT OR UPDATE OF "doctorId" ON "Factura"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_ExpedienteDetalle_es_doctor"
    BEFORE INSERT OR UPDATE OF "doctorId" ON "ExpedienteDetalle"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_ExpedienteDoctor_es_doctor"
    BEFORE INSERT OR UPDATE OF "doctorId" ON "ExpedienteDoctor"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

CREATE TRIGGER "trg_EspecialidadDoctor_es_doctor"
    BEFORE INSERT OR UPDATE OF "doctorId" ON "EspecialidadDoctor"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_es_doctor();

-- 4.4 Faltaba la clave foranea del usuario que cancela.
DELETE FROM "HistorialCancelacionCita"
WHERE "usuarioCancelaId" NOT IN (SELECT id FROM "User");

ALTER TABLE "HistorialCancelacionCita"
    ADD CONSTRAINT "HistorialCancelacionCita_usuarioCancelaId_fkey"
        FOREIGN KEY ("usuarioCancelaId") REFERENCES "User"(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    ADD CONSTRAINT "HistorialCancelacionCita_motivo_check"
        CHECK (btrim("motivoCancelacion") <> '');

-- 4.5 Montos y cantidades no pueden ser negativos.
ALTER TABLE "Empleado"
    ADD CONSTRAINT "Empleado_salario_check" CHECK (salario >= 0);

ALTER TABLE "ServicioClinico"
    ADD CONSTRAINT "ServicioClinico_precio_check" CHECK (precio >= 0),
    ADD CONSTRAINT "ServicioClinico_nombre_key"   UNIQUE (nombre),
    ADD CONSTRAINT "ServicioClinico_nombre_check" CHECK (btrim(nombre) <> '');

ALTER TABLE "DetalleFactura"
    ADD CONSTRAINT "DetalleFactura_cantidad_check"       CHECK (cantidad > 0),
    ADD CONSTRAINT "DetalleFactura_precioUnitario_check" CHECK ("precioUnitario" >= 0),
    ADD CONSTRAINT "DetalleFactura_descripcion_check"    CHECK (btrim(descripcion) <> '');

ALTER TABLE "Factura"
    ADD CONSTRAINT "Factura_montos_check"
        CHECK (subtotal           >= 0
           AND descuentos         >= 0
           AND "importeExonerado" >= 0
           AND "importeExento"    >= 0
           AND isv15              >= 0
           AND isv18              >= 0
           AND "totalPagar"       >= 0),
    ADD CONSTRAINT "Factura_numeroFactura_check" CHECK (btrim("numeroFactura") <> ''),
    ADD CONSTRAINT "Factura_cai_check"           CHECK (btrim(cai) <> '');

-- 4.6 Correo: el UNIQUE anterior distinguia mayusculas, asi que
--     'Juan@Mail.com' y 'juan@mail.com' se podian registrar como dos cuentas.
DROP INDEX "User_correo_key";

CREATE UNIQUE INDEX "User_correo_key" ON "User" (lower(correo));

ALTER TABLE "User"
    ADD CONSTRAINT "User_correo_formato_check"
        CHECK (correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');


-- ############################################################################
-- PARTE 5 - ARREGLOS MENORES
-- ############################################################################

-- 5.1 Logs.logout tenia DEFAULT CURRENT_TIMESTAMP: una sesion abierta quedaba
--     registrada con hora de salida igual a la de entrada. Debe ser NULL
--     hasta que el usuario realmente cierre sesion.
ALTER TABLE "Logs" ALTER COLUMN logout DROP DEFAULT;

ALTER TABLE "Logs"
    ADD CONSTRAINT "Logs_logout_check" CHECK (logout IS NULL OR logout >= login);

-- 5.2 HistorialCancelacionCita tenia UNIQUE en citaId: una tabla llamada
--     "historial" solo admitia un registro por cita. Ademas el UNIQUE y el
--     INDEX sobre la misma columna eran redundantes.
DROP INDEX "HistorialCancelacionCita_citaId_key";
-- se conserva "HistorialCancelacionCita_citaId_idx" (no unico)

-- 5.3 CodigoVerificacion tenia UNIQUE en userId: el segundo intento de
--     verificacion de un mismo usuario fallaba.
DROP INDEX "CodigoVerificacion_userId_key";

CREATE INDEX "CodigoVerificacion_userId_idx" ON "CodigoVerificacion" ("userId");

-- Los datos de prueba tienen fechaExpiracion ANTERIOR a fechaCreacion
-- (expiran 8 dias antes de haber sido creados). Se corrigen antes de
-- poner la restriccion que impide que vuelva a pasar.
UPDATE "CodigoVerificacion"
SET "fechaExpiracion" = "fechaCreacion" + INTERVAL '15 minutes'
WHERE "fechaExpiracion" <= "fechaCreacion";

ALTER TABLE "CodigoVerificacion"
    ADD CONSTRAINT "CodigoVerificacion_expiracion_check"
        CHECK ("fechaExpiracion" > "fechaCreacion");

-- 5.4 updatedAt tenia valor por defecto pero nada lo actualizaba nunca.
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END $$;

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
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()',
            'trg_' || t.table_name || '_updated_at', t.table_name);
    END LOOP;
END $$;

-- 5.5 Borrados en cascada donde corresponde: las filas hijas no tienen
--     sentido sin su padre.
ALTER TABLE "DetalleFactura"
    DROP CONSTRAINT "DetalleFactura_facturaId_fkey",
    ADD  CONSTRAINT "DetalleFactura_facturaId_fkey"
        FOREIGN KEY ("facturaId") REFERENCES "Factura"(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "ExpedienteDetalle"
    DROP CONSTRAINT "ExpedienteDetalle_expedienteId_fkey",
    ADD  CONSTRAINT "ExpedienteDetalle_expedienteId_fkey"
        FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "ExpedienteArchivo"
    DROP CONSTRAINT "ExpedienteArchivo_expedienteId_fkey",
    ADD  CONSTRAINT "ExpedienteArchivo_expedienteId_fkey"
        FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "CodigoVerificacion"
    DROP CONSTRAINT "CodigoVerificacion_userId_fkey",
    ADD  CONSTRAINT "CodigoVerificacion_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"(id)
        ON UPDATE CASCADE ON DELETE CASCADE;


-- ############################################################################
-- PARTE 6 - INDICES EN CLAVES FORANEAS
-- ############################################################################
-- PostgreSQL crea el indice de la clave primaria automaticamente, pero NO el
-- de las claves foraneas. Sin ellos cada JOIN recorre la tabla completa.
-- ----------------------------------------------------------------------------

CREATE INDEX "Cita_pacienteId_idx"               ON "Cita" ("pacienteId");
CREATE INDEX "Cita_doctorId_idx"                 ON "Cita" ("doctorId");
CREATE INDEX "Cita_servicioId_idx"               ON "Cita" ("servicioId");
CREATE INDEX "Cita_fecha_idx"                    ON "Cita" (fecha);
CREATE INDEX "Cita_estado_idx"                   ON "Cita" (estado);

CREATE INDEX "DetalleFactura_facturaId_idx"      ON "DetalleFactura" ("facturaId");
CREATE INDEX "DetalleFactura_servicioId_idx"     ON "DetalleFactura" ("servicioId");

CREATE INDEX "Factura_pacienteId_idx"            ON "Factura" ("pacienteId");
CREATE INDEX "Factura_doctorId_idx"              ON "Factura" ("doctorId");
CREATE INDEX "Factura_fechaEmision_idx"          ON "Factura" ("fechaEmision");

CREATE INDEX "ExpedienteDetalle_expedienteId_idx" ON "ExpedienteDetalle" ("expedienteId");
CREATE INDEX "ExpedienteDetalle_doctorId_idx"     ON "ExpedienteDetalle" ("doctorId");
CREATE INDEX "ExpedienteArchivo_expedienteId_idx" ON "ExpedienteArchivo" ("expedienteId");
CREATE INDEX "ExpedienteArchivo_creadoPorId_idx"  ON "ExpedienteArchivo" ("creadoPorId");
CREATE INDEX "ExpedienteDoctor_doctorId_idx"      ON "ExpedienteDoctor" ("doctorId");

CREATE INDEX "EspecialidadDoctor_especialidadId_idx" ON "EspecialidadDoctor" ("especialidadId");
CREATE INDEX "ServicioEspecialidad_especialidadId_idx" ON "ServicioEspecialidad" ("especialidadId");

CREATE INDEX "Logs_empleadoId_idx"               ON "Logs" ("empleadoId");
CREATE INDEX "Empleado_puestoId_idx"             ON "Empleado" ("puestoId");
CREATE INDEX "User_rolId_idx"                    ON "User" ("rolId");
CREATE INDEX "HistorialCancelacionCita_usuarioCancelaId_idx"
    ON "HistorialCancelacionCita" ("usuarioCancelaId");

-- Busqueda de pacientes por nombre desde el frontend.
CREATE INDEX "Persona_nombreCompleto_idx" ON "Persona" (lower("nombreCompleto"));


-- ############################################################################
-- PARTE 7 - VISTAS DE COMPATIBILIDAD
-- ############################################################################
-- Devuelven el rol y el puesto como texto, igual que antes de la migracion,
-- para que el backend no tenga que armar el JOIN en cada consulta.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "vw_Usuario" AS
SELECT
    u.id,
    u.correo,
    u.password,
    r.nombre AS rol,
    u."rolId",
    u.activo,
    u.verificado,
    u."personaId",
    p."primerNombre",
    p."segundoNombre",
    p."primerApellido",
    p."segundoApellido",
    p."nombreCompleto",
    p.dni,
    p.telefono,
    p.direccion,
    p."fechaNac",
    u."createdAt",
    u."updatedAt"
FROM "User" u
JOIN "Rol"     r ON r.id = u."rolId"
JOIN "Persona" p ON p.id = u."personaId";

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


-- ############################################################################
-- VERIFICACION FINAL
-- ############################################################################
DO $$
DECLARE
    v_personas  INTEGER;
    v_citas     INTEGER;
    v_usuarios  INTEGER;
    v_facturas  INTEGER;
BEGIN
    SELECT count(*) INTO v_personas FROM "Persona";
    SELECT count(*) INTO v_citas    FROM "Cita";
    SELECT count(*) INTO v_usuarios FROM "User";
    SELECT count(*) INTO v_facturas FROM "Factura";

    RAISE NOTICE 'Migracion 003 aplicada correctamente.';
    RAISE NOTICE 'Personas: % | Usuarios: % | Citas: % | Facturas: %',
        v_personas, v_usuarios, v_citas, v_facturas;
END $$;

COMMIT;

-- Recalcular estadisticas del planificador tras los cambios de tipo.
ANALYZE;
