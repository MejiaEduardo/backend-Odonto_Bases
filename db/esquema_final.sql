-- ============================================================================
--  CLINICA ODONTOLOGICA - ESQUEMA FINAL
--  PostgreSQL 16
--
--  Crea la base completa desde cero, con las migraciones 003, 004 y 005 ya
--  aplicadas. Sirve como documentacion del modelo y para levantar un
--  entorno limpio.
--
--  OJO: este archivo crea la base VACIA, sin datos (salvo los catalogos).
--  Para corregir la base que ya existe usa 003, 004 y 005, no este archivo.
--
--  EJECUTAR CON (solo para un entorno nuevo):
--      docker exec odonto-db createdb -U postgres odonto_limpia
--      docker cp esquema_final.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odonto_limpia -f /tmp/esquema_final.sql
-- ============================================================================


-- ############################################################################
-- TIPOS
-- ############################################################################
-- Se usan ENUM solo donde el conjunto de valores lo define la logica de
-- negocio y no lo administra el usuario. Los roles y los puestos, que si
-- se administran, son tablas catalogo.

CREATE TYPE "EstadoCita" AS ENUM (
    'SOLICITADA',   -- el paciente la pidio, falta que la clinica la acepte
    'PENDIENTE',    -- agendada, aun sin confirmar
    'CONFIRMADA',   -- confirmada por la clinica
    'COMPLETADA',   -- ya se atendio (unico estado facturable)
    'CANCELADA'     -- anulada; su horario vuelve a quedar libre
);

CREATE TYPE "TipoToken" AS ENUM (
    'VERIFICACION_CORREO',
    'CAMBIO_PASSWORD'
);

CREATE TYPE "TipoRecordatorio" AS ENUM ('24H', '1H');

CREATE TYPE "TipoDocumento" AS ENUM (
    'FACTURA',
    'NOTA_CREDITO',   -- corrige a la baja: devoluciones, descuentos posteriores
    'NOTA_DEBITO'     -- corrige al alza: cargos adicionales
);

-- Una factura emitida no se borra: se anula y se conserva, porque el
-- correlativo tiene que poder rendirse ante el SAR.
CREATE TYPE "EstadoFactura" AS ENUM ('EMITIDA', 'ANULADA');


-- ############################################################################
-- FUNCIONES
-- ############################################################################

-- Mantiene updatedAt al dia sin depender de que el backend lo recuerde.
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END $$;

-- Toda columna empleadoId que represente al doctor debe apuntar a un
-- empleado con puesto DOCTOR.
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

-- El doctor asignado a una cita debe tener la especialidad que exige el
-- servicio. Un servicio sin especialidad asociada lo atiende cualquiera.
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

    IF NOT v_requiere THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS(
        SELECT 1
        FROM "ServicioEspecialidad" se
        JOIN "EspecialidadDoctor" ed ON ed."especialidadId" = se."especialidadId"
        WHERE se."servicioId" = NEW."servicioId"
          AND ed."empleadoId" = NEW."empleadoId"
    ) INTO v_tiene;

    IF NOT v_tiene THEN
        RAISE EXCEPTION
            'El doctor % no tiene la especialidad que requiere el servicio %.',
            NEW."empleadoId", NEW."servicioId";
    END IF;

    RETURN NEW;
END $$;

-- Reglas fiscales y de negocio de la factura.
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

    -- El RTN del cliente es obligatorio arriba de L.100.
    -- Solo en INSERT: las facturas emitidas antes de que el RTN se guardara
    -- tienen que poder seguir anulandose.
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

-- Una factura no se borra nunca: se anula y se conserva.
CREATE OR REPLACE FUNCTION fn_factura_no_se_borra()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'El documento % no se puede borrar: se anula (estado = ANULADA, con motivo y fecha).',
        OLD."numeroFactura";
END $$;


-- ############################################################################
-- CATALOGOS Y SEGURIDAD
-- ############################################################################

-- Nivel de acceso al sistema: responde "quien sos".
CREATE TABLE "Rol" (
    id          SERIAL       PRIMARY KEY,
    nombre      TEXT         NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rol_nombre_check" CHECK (btrim(nombre) <> '')
);

INSERT INTO "Rol" (id, nombre, descripcion) VALUES
    (1, 'ADMIN',         'Acceso total al sistema y a la configuracion'),
    (2, 'DOCTOR',        'Gestiona sus citas y los expedientes de sus pacientes'),
    (3, 'RECEPCIONISTA', 'Agenda citas, registra pacientes y emite facturas'),
    (4, 'CLIENTE',       'Paciente: solicita y consulta sus propias citas');

SELECT setval('"Rol_id_seq"', (SELECT max(id) FROM "Rol"));

-- Accion concreta sobre una seccion del software: responde "que podes hacer".
-- El rol solo es demasiado grueso: permite ver una pantalla completa o nada.
-- El permiso deja decir "puede ver pero no editar".
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

CREATE TABLE "RolPermiso" (
    "rolId"     INTEGER      NOT NULL,
    "permisoId" INTEGER      NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolPermiso_pkey"           PRIMARY KEY ("rolId", "permisoId"),
    CONSTRAINT "RolPermiso_rolId_fkey"     FOREIGN KEY ("rolId")     REFERENCES "Rol"(id)     ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "RolPermiso_permisoId_fkey" FOREIGN KEY ("permisoId") REFERENCES "Permiso"(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX "RolPermiso_permisoId_idx" ON "RolPermiso" ("permisoId");

INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 1, id FROM "Permiso" WHERE codigo IN (
    'dashboard.ver', 'empleados.ver', 'empleados.crear', 'empleados.editar',
    'servicios.ver', 'servicios.gestionar', 'citas.ver',
    'expedientes.ver', 'facturas.ver', 'perfil.propio.editar');

INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 2, id FROM "Permiso" WHERE codigo IN (
    'citas.propias.ver', 'expedientes.ver', 'expedientes.editar',
    'archivos.subir', 'servicios.ver', 'perfil.propio.editar');

INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 3, id FROM "Permiso" WHERE codigo IN (
    'pacientes.crear', 'citas.ver', 'citas.gestionar', 'expedientes.ver',
    'facturas.ver', 'facturas.emitir', 'servicios.ver', 'perfil.propio.editar');

INSERT INTO "RolPermiso" ("rolId", "permisoId")
SELECT 4, id FROM "Permiso" WHERE codigo IN (
    'citas.propias.ver', 'citas.propias.gestionar',
    'servicios.ver', 'perfil.propio.editar');

-- Cargo laboral del empleado. Es distinto del rol de acceso: un doctor
-- podria ser ademas administrador del sistema.
CREATE TABLE "Puesto" (
    id          SERIAL       PRIMARY KEY,
    nombre      TEXT         NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Puesto_nombre_check" CHECK (btrim(nombre) <> '')
);

INSERT INTO "Puesto" (id, nombre, descripcion) VALUES
    (1, 'DOCTOR',        'Odontologo que atiende pacientes'),
    (2, 'RECEPCIONISTA', 'Atencion al publico y agenda'),
    (3, 'ADMIN',         'Administracion de la clinica'),
    (4, 'OTRO',          'Otros cargos del personal');

SELECT setval('"Puesto_id_seq"', (SELECT max(id) FROM "Puesto"));


-- ############################################################################
-- PERSONAS Y ACCESO
-- ############################################################################

-- Entidad base: un empleado y un usuario son roles que asume una persona.
CREATE TABLE "Persona" (
    id                SERIAL       PRIMARY KEY,
    "primerNombre"    TEXT         NOT NULL,
    "segundoNombre"   TEXT,
    "primerApellido"  TEXT         NOT NULL,
    "segundoApellido" TEXT,
    -- Columna calculada: la mantiene PostgreSQL, no se puede desincronizar.
    "nombreCompleto"  TEXT GENERATED ALWAYS AS (
        "primerNombre"
        || COALESCE(' ' || "segundoNombre", '')
        || ' ' || "primerApellido"
        || COALESCE(' ' || "segundoApellido", '')
    ) STORED,
    dni               TEXT         UNIQUE,
    -- RTN: 14 digitos. Obligatorio en la factura arriba de L.100.
    rtn               TEXT         UNIQUE,
    telefono          TEXT,
    direccion         TEXT,
    "fechaNac"        DATE,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Persona_rtn_formato_check"      CHECK (rtn IS NULL OR rtn ~ '^[0-9]{14}$'),
    CONSTRAINT "Persona_primerNombre_check"     CHECK (btrim("primerNombre") <> ''),
    CONSTRAINT "Persona_primerApellido_check"   CHECK (btrim("primerApellido") <> ''),
    CONSTRAINT "Persona_segundoNombre_check"    CHECK ("segundoNombre"   IS NULL OR btrim("segundoNombre")   <> ''),
    CONSTRAINT "Persona_segundoApellido_check"  CHECK ("segundoApellido" IS NULL OR btrim("segundoApellido") <> ''),
    CONSTRAINT "Persona_dni_formato_check"      CHECK (dni      IS NULL OR dni      ~ '^[0-9]{13}$'),
    CONSTRAINT "Persona_telefono_formato_check" CHECK (telefono IS NULL OR telefono ~ '^[0-9]{8}$'),
    CONSTRAINT "Persona_fechaNac_check"         CHECK ("fechaNac" IS NULL OR "fechaNac" > DATE '1900-01-01')
);

-- password es opcional porque existe el login con Google.
CREATE TABLE "User" (
    id          SERIAL       PRIMARY KEY,
    correo      TEXT         NOT NULL,
    password    TEXT,
    "rolId"     INTEGER      NOT NULL DEFAULT 4,   -- 4 = CLIENTE
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    verificado  BOOLEAN      NOT NULL DEFAULT FALSE,
    "personaId" INTEGER      NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_rolId_fkey"     FOREIGN KEY ("rolId")     REFERENCES "Rol"(id)     ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "User_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "User_correo_formato_check"
        CHECK (correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Unico sin distinguir mayusculas: Juan@Mail.com y juan@mail.com son la misma cuenta.
CREATE UNIQUE INDEX "User_correo_key" ON "User" (lower(correo));

-- Links con expiracion, para verificar el correo y para cambiar la contrasena.
-- El backend valida si el token "sigue vivo" antes de dejar continuar.
CREATE TABLE "TokenAcceso" (
    id          SERIAL       PRIMARY KEY,
    "userId"    INTEGER      NOT NULL,
    token       TEXT         NOT NULL UNIQUE,
    tipo        "TipoToken"  NOT NULL,
    "expiraEn"  TIMESTAMP(3) NOT NULL,
    "usadoEn"   TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenAcceso_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "TokenAcceso_expiracion_check" CHECK ("expiraEn" > "createdAt"),
    CONSTRAINT "TokenAcceso_usadoEn_check"    CHECK ("usadoEn" IS NULL OR "usadoEn" >= "createdAt")
);

CREATE INDEX "TokenAcceso_userId_idx"   ON "TokenAcceso" ("userId");
CREATE INDEX "TokenAcceso_expiraEn_idx" ON "TokenAcceso" ("expiraEn");

-- Un usuario no puede tener dos tokens vivos del mismo tipo a la vez.
CREATE UNIQUE INDEX "TokenAcceso_vivo_key"
    ON "TokenAcceso" ("userId", tipo)
    WHERE "usadoEn" IS NULL;

CREATE TABLE "Empleado" (
    id             SERIAL        PRIMARY KEY,
    "personaId"    INTEGER       NOT NULL UNIQUE,
    "puestoId"     INTEGER       NOT NULL,
    salario        NUMERIC(12,2) NOT NULL,
    "fechaIngreso" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo         BOOLEAN       NOT NULL DEFAULT TRUE,
    "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empleado_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Empleado_puestoId_fkey"  FOREIGN KEY ("puestoId")  REFERENCES "Puesto"(id)  ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Empleado_salario_check"  CHECK (salario >= 0)
);

-- Quien se atiende en la clinica. Es el espejo de "Empleado": "Persona"
-- guarda lo que es cierto de cualquier ser humano, "Paciente" lo que es
-- cierto solo de quien se atiende aca. Sin esta tabla no habia forma de
-- saber que personas son pacientes, ni de dar de baja a uno.
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

-- Entradas y salidas. logout queda NULL mientras la sesion siga abierta.
CREATE TABLE "Logs" (
    id           SERIAL       PRIMARY KEY,
    "empleadoId" INTEGER      NOT NULL,
    login        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout       TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Logs_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Logs_logout_check"    CHECK (logout IS NULL OR logout >= login)
);


-- ############################################################################
-- SERVICIOS Y ESPECIALIDADES
-- ############################################################################

CREATE TABLE "Especialidad" (
    id          SERIAL       PRIMARY KEY,
    nombre      TEXT         NOT NULL UNIQUE,
    descripcion TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ServicioClinico" (
    id          SERIAL        PRIMARY KEY,
    nombre      TEXT          NOT NULL UNIQUE,
    descripcion TEXT,
    precio      NUMERIC(12,2) NOT NULL,
    activo      BOOLEAN       NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicioClinico_precio_check" CHECK (precio >= 0),
    CONSTRAINT "ServicioClinico_nombre_check" CHECK (btrim(nombre) <> '')
);

-- Tabla puente: que especialidades tiene cada doctor.
-- La columna se llama empleadoId porque apunta a "Empleado".
CREATE TABLE "EspecialidadDoctor" (
    "empleadoId"     INTEGER      NOT NULL,
    "especialidadId" INTEGER      NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EspecialidadDoctor_pkey" PRIMARY KEY ("empleadoId", "especialidadId"),
    CONSTRAINT "EspecialidadDoctor_empleadoId_fkey"     FOREIGN KEY ("empleadoId")     REFERENCES "Empleado"(id)     ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "EspecialidadDoctor_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "Especialidad"(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Tabla puente: que especialidad exige cada servicio.
CREATE TABLE "ServicioEspecialidad" (
    "servicioId"     INTEGER      NOT NULL,
    "especialidadId" INTEGER      NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicioEspecialidad_pkey" PRIMARY KEY ("servicioId", "especialidadId"),
    CONSTRAINT "ServicioEspecialidad_servicioId_fkey"     FOREIGN KEY ("servicioId")     REFERENCES "ServicioClinico"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "ServicioEspecialidad_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "Especialidad"(id)    ON UPDATE CASCADE ON DELETE RESTRICT
);


-- ############################################################################
-- CITAS
-- ############################################################################

-- "fechaHora" es UNA sola columna porque la fecha y la hora de una cita son
-- dos mitades del mismo hecho: separadas se pueden guardar a medias, obligan
-- a recomponerlas para cualquier calculo de intervalo y a ordenar siempre por
-- dos columnas.
-- "fecha" y "hora" siguen existiendo, pero GENERADAS: las mantiene PostgreSQL
-- y no se puede escribir en ellas, asi que no pueden desincronizarse. Sirven
-- para las consultas por dia y para la grilla de horarios.
CREATE TABLE "Cita" (
    id           SERIAL       PRIMARY KEY,
    "fechaHora"  TIMESTAMP(3) NOT NULL,
    fecha        DATE         GENERATED ALWAYS AS (("fechaHora")::DATE) STORED,
    hora         TIME         GENERATED ALWAYS AS (("fechaHora")::TIME) STORED,
    estado       "EstadoCita" NOT NULL DEFAULT 'PENDIENTE',
    "pacienteId" INTEGER      NOT NULL,
    "empleadoId" INTEGER      NOT NULL,   -- el doctor que atiende
    "servicioId" INTEGER      NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cita_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"(id)        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Cita_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"(id)        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Cita_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioClinico"(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Un doctor no puede tener dos citas activas a la misma hora.
-- El indice es PARCIAL: una cita cancelada libera su horario.
CREATE UNIQUE INDEX "Cita_empleado_fechaHora_key"
    ON "Cita" ("empleadoId", "fechaHora")
    WHERE estado <> 'CANCELADA'::"EstadoCita";

-- Un paciente tampoco puede estar en dos citas activas a la misma hora.
CREATE UNIQUE INDEX "Cita_paciente_fechaHora_key"
    ON "Cita" ("pacienteId", "fechaHora")
    WHERE estado <> 'CANCELADA'::"EstadoCita";

-- Recordatorios enviados. Antes eran dos columnas booleanas en "Cita"
-- (recordatorio1h y recordatorio24h): un grupo repetitivo que obligaba a
-- modificar la tabla para agregar un tipo nuevo.
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

-- Admite varias cancelaciones por cita: una cita puede agendarse y
-- cancelarse mas de una vez a lo largo de su vida.
CREATE TABLE "HistorialCancelacionCita" (
    id                  SERIAL         PRIMARY KEY,
    "citaId"            INTEGER        NOT NULL,
    "motivoCancelacion" TEXT           NOT NULL,
    "usuarioCancelaId"  INTEGER        NOT NULL,
    "rolCancelaId"      INTEGER        NOT NULL,
    "fechaCancelacion"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistoPorPaciente"  BOOLEAN        NOT NULL DEFAULT FALSE,
    "createdAt"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialCancelacionCita_citaId_fkey"           FOREIGN KEY ("citaId")           REFERENCES "Cita"(id) ON DELETE CASCADE,
    CONSTRAINT "HistorialCancelacionCita_usuarioCancelaId_fkey" FOREIGN KEY ("usuarioCancelaId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "HistorialCancelacionCita_rolCancelaId_fkey"     FOREIGN KEY ("rolCancelaId")     REFERENCES "Rol"(id)  ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "HistorialCancelacionCita_motivo_check"          CHECK (btrim("motivoCancelacion") <> '')
);


-- ############################################################################
-- EXPEDIENTES
-- ############################################################################

CREATE TABLE "Expediente" (
    id            SERIAL       PRIMARY KEY,
    "pacienteId"  INTEGER      NOT NULL UNIQUE,
    alergias      TEXT,
    enfermedades  TEXT,
    medicamentos  TEXT,
    observaciones TEXT,
    activo        BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expediente_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE "ExpedienteDetalle" (
    id                SERIAL       PRIMARY KEY,
    "expedienteId"    INTEGER      NOT NULL,
    fecha             TIMESTAMP(3) NOT NULL,
    motivo            TEXT,
    diagnostico       TEXT,
    tratamiento       TEXT,
    "planTratamiento" TEXT,
    "empleadoId"      INTEGER      NOT NULL,   -- el doctor que atendio
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpedienteDetalle_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "ExpedienteDetalle_empleadoId_fkey"   FOREIGN KEY ("empleadoId")   REFERENCES "Empleado"(id)   ON UPDATE CASCADE ON DELETE RESTRICT
);

-- filePath es la llave del archivo dentro de Firebase Storage: con ella se
-- genera el enlace de descarga y con ella se borra. Es calculada porque el
-- backend siempre la arma igual: `archivos/${storageName}`.
CREATE TABLE "ExpedienteArchivo" (
    id              SERIAL       PRIMARY KEY,
    "expedienteId"  INTEGER      NOT NULL,
    "nombreArchivo" TEXT         NOT NULL,
    "tipoArchivo"   TEXT,
    "storageName"   TEXT         NOT NULL UNIQUE,
    "filePath"      TEXT GENERATED ALWAYS AS ('archivos/' || "storageName") STORED,
    "creadoPorId"   INTEGER      NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpedienteArchivo_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "ExpedienteArchivo_creadoPorId_fkey"  FOREIGN KEY ("creadoPorId")  REFERENCES "Empleado"(id)   ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Tabla puente: que doctores tienen acceso a que expediente.
CREATE TABLE "ExpedienteDoctor" (
    "expedienteId" INTEGER      NOT NULL,
    "empleadoId"   INTEGER      NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpedienteDoctor_pkey" PRIMARY KEY ("expedienteId", "empleadoId"),
    CONSTRAINT "ExpedienteDoctor_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"(id) ON DELETE CASCADE,
    CONSTRAINT "ExpedienteDoctor_empleadoId_fkey"   FOREIGN KEY ("empleadoId")   REFERENCES "Empleado"(id)   ON DELETE RESTRICT
);


-- ############################################################################
-- FACTURACION
-- ############################################################################

-- Datos del negocio que la factura tiene que mostrar por ley: razon social,
-- RTN y direccion del punto de emision.
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

    CONSTRAINT "Emisor_razonSocial_check"     CHECK (btrim("razonSocial") <> ''),
    CONSTRAINT "Emisor_direccion_check"       CHECK (btrim(direccion)     <> ''),
    CONSTRAINT "Emisor_rtn_formato_check"     CHECK (rtn ~ '^[0-9]{14}$'),
    CONSTRAINT "Emisor_telefono_formato_check" CHECK (telefono IS NULL OR telefono ~ '^[0-9]{8}$')
);

-- Autorizacion del SAR. El CAI, el rango de correlativos y la fecha limite
-- de emision son datos del RANGO, no de cada factura: antes el CAI estaba
-- repetido identico en todas las filas de "Factura".
-- El emisor cuelga del rango porque el SAR autoriza un CAI a un emisor
-- concreto: todas las facturas del rango comparten emisor.
CREATE TABLE "RangoFacturacion" (
    id                   SERIAL       PRIMARY KEY,
    "emisorId"           INTEGER      NOT NULL,
    cai                  TEXT         NOT NULL UNIQUE,
    "numeroInicial"      TEXT         NOT NULL,
    "numeroFinal"        TEXT         NOT NULL,
    "fechaLimiteEmision" DATE         NOT NULL,
    activo               BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RangoFacturacion_emisorId_fkey"
        FOREIGN KEY ("emisorId") REFERENCES "Emisor"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "RangoFacturacion_cai_check"     CHECK (btrim(cai) <> ''),
    CONSTRAINT "RangoFacturacion_inicial_check" CHECK ("numeroInicial" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$'),
    CONSTRAINT "RangoFacturacion_final_check"   CHECK ("numeroFinal"   ~ '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$'),
    CONSTRAINT "RangoFacturacion_orden_check"   CHECK ("numeroFinal" >= "numeroInicial")
);

-- Los montos son NUMERIC, no punto flotante: en dinero los centavos importan.
-- subtotal, ISV y totalPagar se guardan aunque sean calculables, porque una
-- factura emitida es un documento legal: refleja lo que se cobro ese dia,
-- aunque despues cambien los precios de los servicios.
CREATE TABLE "Factura" (
    id                  SERIAL          PRIMARY KEY,
    "tipoDocumento"     "TipoDocumento" NOT NULL DEFAULT 'FACTURA',
    estado              "EstadoFactura" NOT NULL DEFAULT 'EMITIDA',
    "numeroFactura"     TEXT            NOT NULL UNIQUE,
    "rangoId"           INTEGER         NOT NULL,
    "fechaEmision"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pacienteId"        INTEGER         NOT NULL,
    -- Copia congelada del RTN al momento de emitir. No es redundancia: la
    -- factura es un documento legal y tiene que seguir diciendo lo que decia
    -- el dia que se emitio, aunque la persona cambie su RTN despues.
    "rtnCliente"        TEXT,
    "empleadoId"        INTEGER,                    -- el doctor que atendio
    "citaId"            INTEGER,
    -- Una nota de credito o de debito corrige a una factura anterior.
    "documentoOrigenId" INTEGER,
    subtotal            NUMERIC(12,2)   NOT NULL,
    descuentos          NUMERIC(12,2)   NOT NULL DEFAULT 0,
    -- Bases gravadas: sin ellas el pie de la factura no se puede reconstruir.
    "importeGravado15"  NUMERIC(12,2)   NOT NULL DEFAULT 0,
    "importeGravado18"  NUMERIC(12,2)   NOT NULL DEFAULT 0,
    "importeExonerado"  NUMERIC(12,2)   NOT NULL DEFAULT 0,
    "importeExento"     NUMERIC(12,2)   NOT NULL DEFAULT 0,
    isv15               NUMERIC(12,2)   NOT NULL DEFAULT 0,
    isv18               NUMERIC(12,2)   NOT NULL DEFAULT 0,
    "totalPagar"        NUMERIC(12,2)   NOT NULL,
    "motivoAnulacion"   TEXT,
    "fechaAnulacion"    TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Factura_rangoId_fkey"           FOREIGN KEY ("rangoId")           REFERENCES "RangoFacturacion"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Factura_pacienteId_fkey"        FOREIGN KEY ("pacienteId")        REFERENCES "Paciente"(id)         ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Factura_empleadoId_fkey"        FOREIGN KEY ("empleadoId")        REFERENCES "Empleado"(id)         ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "Factura_citaId_fkey"            FOREIGN KEY ("citaId")            REFERENCES "Cita"(id)             ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "Factura_documentoOrigenId_fkey" FOREIGN KEY ("documentoOrigenId") REFERENCES "Factura"(id)          ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT "Factura_numeroFactura_check"         CHECK (btrim("numeroFactura") <> ''),
    CONSTRAINT "Factura_numeroFactura_formato_check" CHECK ("numeroFactura" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{2}-[0-9]{8}$'),
    CONSTRAINT "Factura_rtnCliente_formato_check"    CHECK ("rtnCliente" IS NULL OR "rtnCliente" ~ '^[0-9]{14}$'),
    CONSTRAINT "Factura_montos_check"
        CHECK (subtotal           >= 0
           AND descuentos         >= 0
           AND "importeExonerado" >= 0
           AND "importeExento"    >= 0
           AND isv15              >= 0
           AND isv18              >= 0
           AND "totalPagar"       >= 0),
    CONSTRAINT "Factura_gravados_check"
        CHECK ("importeGravado15" >= 0 AND "importeGravado18" >= 0),

    -- El pie de la factura tiene que cuadrar. La tolerancia de un centavo es
    -- por el redondeo, no por permisividad.
    CONSTRAINT "Factura_cuadre_bases_check"
        CHECK (abs(("importeGravado15" + "importeGravado18"
                  + "importeExento"    + "importeExonerado")
                 - (subtotal - descuentos)) <= 0.01),
    CONSTRAINT "Factura_cuadre_isv_check"
        CHECK (abs(isv15 - ROUND("importeGravado15" * 0.15, 2)) <= 0.01
           AND abs(isv18 - ROUND("importeGravado18" * 0.18, 2)) <= 0.01),
    CONSTRAINT "Factura_cuadre_total_check"
        CHECK (abs("totalPagar" - (subtotal - descuentos + isv15 + isv18)) <= 0.01),

    -- Anulada exige motivo y fecha; emitida no puede tenerlos.
    CONSTRAINT "Factura_anulacion_check"
        CHECK ((estado = 'ANULADA'
                AND "motivoAnulacion" IS NOT NULL
                AND btrim("motivoAnulacion") <> ''
                AND "fechaAnulacion" IS NOT NULL)
           OR  (estado = 'EMITIDA'
                AND "motivoAnulacion" IS NULL
                AND "fechaAnulacion"  IS NULL)),

    -- Una nota siempre corrige a un documento anterior; una factura no.
    CONSTRAINT "Factura_documentoOrigen_check"
        CHECK (("tipoDocumento" =  'FACTURA' AND "documentoOrigenId" IS NULL)
           OR  ("tipoDocumento" <> 'FACTURA' AND "documentoOrigenId" IS NOT NULL)),
    CONSTRAINT "Factura_documentoOrigen_distinto_check"
        CHECK ("documentoOrigenId" IS NULL OR "documentoOrigenId" <> id)
);

-- Una cita solo puede tener UNA factura vigente. Si esa factura se anula, la
-- cita vuelve a quedar facturable. Mismo patron que el indice parcial que
-- libera el horario de una cita cancelada.
CREATE UNIQUE INDEX "Factura_citaId_key"
    ON "Factura" ("citaId")
    WHERE "citaId" IS NOT NULL
      AND estado = 'EMITIDA'::"EstadoFactura"
      AND "tipoDocumento" = 'FACTURA'::"TipoDocumento";

-- descripcion y precioUnitario se copian del servicio a proposito: son la
-- foto historica del precio al momento de facturar.
-- totalLinea es calculado. tasaISV reemplaza al booleano aplicaISV, que no
-- permitia saber que tasa se le habia aplicado a cada linea.
CREATE TABLE "DetalleFactura" (
    id               SERIAL        PRIMARY KEY,
    "facturaId"      INTEGER       NOT NULL,
    "servicioId"     INTEGER,
    descripcion      TEXT          NOT NULL,
    cantidad         INTEGER       NOT NULL,
    "precioUnitario" NUMERIC(12,2) NOT NULL,
    "totalLinea"     NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * "precioUnitario") STORED,
    "tasaISV"        NUMERIC(4,2)  NOT NULL DEFAULT 0.15,
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetalleFactura_facturaId_fkey"  FOREIGN KEY ("facturaId")  REFERENCES "Factura"(id)         ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "DetalleFactura_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioClinico"(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "DetalleFactura_cantidad_check"       CHECK (cantidad > 0),
    CONSTRAINT "DetalleFactura_precioUnitario_check" CHECK ("precioUnitario" >= 0),
    CONSTRAINT "DetalleFactura_descripcion_check"    CHECK (btrim(descripcion) <> ''),
    CONSTRAINT "DetalleFactura_tasaISV_check"        CHECK ("tasaISV" IN (0.00, 0.15, 0.18))
);


-- ############################################################################
-- INDICES EN CLAVES FORANEAS
-- ############################################################################
-- PostgreSQL crea el indice de la clave primaria automaticamente, pero NO el
-- de las claves foraneas. Sin ellos cada JOIN recorre la tabla entera.

CREATE INDEX "Cita_pacienteId_idx"                     ON "Cita" ("pacienteId");
CREATE INDEX "Cita_empleadoId_idx"                     ON "Cita" ("empleadoId");
CREATE INDEX "Cita_servicioId_idx"                     ON "Cita" ("servicioId");
CREATE INDEX "Cita_fechaHora_idx"                      ON "Cita" ("fechaHora");
CREATE INDEX "Cita_fecha_idx"                          ON "Cita" (fecha);
CREATE INDEX "Cita_estado_idx"                         ON "Cita" (estado);

CREATE INDEX "DetalleFactura_facturaId_idx"            ON "DetalleFactura" ("facturaId");
CREATE INDEX "DetalleFactura_servicioId_idx"           ON "DetalleFactura" ("servicioId");

CREATE INDEX "Factura_pacienteId_idx"                  ON "Factura" ("pacienteId");
CREATE INDEX "Factura_empleadoId_idx"                  ON "Factura" ("empleadoId");
CREATE INDEX "Factura_fechaEmision_idx"                ON "Factura" ("fechaEmision");
CREATE INDEX "Factura_rangoId_idx"                     ON "Factura" ("rangoId");
CREATE INDEX "Factura_estado_idx"                      ON "Factura" (estado);
CREATE INDEX "Factura_documentoOrigenId_idx"           ON "Factura" ("documentoOrigenId");
CREATE INDEX "RangoFacturacion_emisorId_idx"           ON "RangoFacturacion" ("emisorId");

CREATE INDEX "ExpedienteDetalle_expedienteId_idx"      ON "ExpedienteDetalle" ("expedienteId");
CREATE INDEX "ExpedienteDetalle_empleadoId_idx"        ON "ExpedienteDetalle" ("empleadoId");
CREATE INDEX "ExpedienteArchivo_expedienteId_idx"      ON "ExpedienteArchivo" ("expedienteId");
CREATE INDEX "ExpedienteArchivo_creadoPorId_idx"       ON "ExpedienteArchivo" ("creadoPorId");
CREATE INDEX "ExpedienteDoctor_empleadoId_idx"         ON "ExpedienteDoctor" ("empleadoId");

CREATE INDEX "EspecialidadDoctor_especialidadId_idx"   ON "EspecialidadDoctor" ("especialidadId");
CREATE INDEX "ServicioEspecialidad_especialidadId_idx" ON "ServicioEspecialidad" ("especialidadId");

CREATE INDEX "Logs_empleadoId_idx"                     ON "Logs" ("empleadoId");
CREATE INDEX "Empleado_puestoId_idx"                   ON "Empleado" ("puestoId");
CREATE INDEX "User_rolId_idx"                          ON "User" ("rolId");
CREATE INDEX "HistorialCancelacionCita_citaId_idx"     ON "HistorialCancelacionCita" ("citaId");
CREATE INDEX "HistorialCancelacionCita_usuarioCancelaId_idx"
    ON "HistorialCancelacionCita" ("usuarioCancelaId");

-- Busqueda de pacientes por nombre desde el frontend.
CREATE INDEX "Persona_nombreCompleto_idx" ON "Persona" (lower("nombreCompleto"));


-- ############################################################################
-- DATOS FISCALES PROVISIONALES
-- ############################################################################
-- No son un catalogo: son los datos reales del negocio. Se dejan cargados con
-- valores falsos para que un entorno nuevo pueda emitir facturas, pero HAY QUE
-- REEMPLAZARLOS por el RTN, la direccion y la autorizacion real del SAR antes
-- de usar el sistema de verdad.

INSERT INTO "Emisor" (id, "razonSocial", "nombreComercial", rtn, direccion, telefono, correo) VALUES
    (1,
     'CLINICA ODONTOLOGICA S. DE R.L.',
     'Clinica Odontologica',
     '00000000000000',
     'PROVISIONAL - direccion del punto de emision pendiente',
     '00000000',
     'facturacion@clinica.local');

SELECT setval('"Emisor_id_seq"', (SELECT max(id) FROM "Emisor"));

INSERT INTO "RangoFacturacion" (id, "emisorId", cai, "numeroInicial", "numeroFinal", "fechaLimiteEmision") VALUES
    (1, 1,
     'PROVISIONAL-CAI-PENDIENTE-DEL-SAR',
     '000-001-01-00000001',
     '000-001-01-00001000',
     (CURRENT_DATE + INTERVAL '1 year')::DATE);

SELECT setval('"RangoFacturacion_id_seq"', (SELECT max(id) FROM "RangoFacturacion"));


-- ############################################################################
-- TRIGGERS
-- ############################################################################

-- El empleado asignado como doctor debe tener puesto DOCTOR.
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

-- El doctor debe tener la especialidad que exige el servicio.
CREATE TRIGGER "trg_Cita_especialidad"
    BEFORE INSERT OR UPDATE OF "empleadoId", "servicioId" ON "Cita"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_especialidad_cita();

-- Rango autorizado, vigencia del CAI, RTN del cliente, anulacion, notas de
-- credito y coherencia con la cita facturada.
CREATE TRIGGER "trg_Factura_validar"
    BEFORE INSERT OR UPDATE ON "Factura"
    FOR EACH ROW EXECUTE FUNCTION fn_validar_factura();

-- Una factura no se borra: se anula.
CREATE TRIGGER "trg_Factura_no_borrar"
    BEFORE DELETE ON "Factura"
    FOR EACH ROW EXECUTE FUNCTION fn_factura_no_se_borra();

-- updatedAt automatico en todas las tablas.
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


-- ############################################################################
-- VISTAS
-- ############################################################################
-- Devuelven el rol y el puesto como texto y los datos fiscales ya resueltos,
-- para que el backend no tenga que armar los JOIN en cada consulta.

CREATE OR REPLACE VIEW "vw_Usuario" AS
SELECT
    u.id, u.correo, u.password,
    r.nombre AS rol, u."rolId",
    u.activo, u.verificado, u."personaId",
    p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
    p."nombreCompleto", p.dni, p.telefono, p.direccion, p."fechaNac",
    u."createdAt", u."updatedAt"
FROM "User" u
JOIN "Rol"     r ON r.id = u."rolId"
JOIN "Persona" p ON p.id = u."personaId";

CREATE OR REPLACE VIEW "vw_Empleado" AS
SELECT
    e.id, e."personaId",
    pu.nombre AS puesto, e."puestoId",
    e.salario, e."fechaIngreso", e.activo,
    p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
    p."nombreCompleto", p.dni, p.telefono
FROM "Empleado" e
JOIN "Puesto"  pu ON pu.id = e."puestoId"
JOIN "Persona" p  ON p.id  = e."personaId";

-- Permisos efectivos de cada usuario, en una sola consulta.
CREATE OR REPLACE VIEW "vw_PermisosUsuario" AS
SELECT
    u.id     AS "userId",
    u.correo,
    r.nombre AS rol,
    p.codigo AS permiso,
    p.modulo
FROM "User" u
JOIN "Rol"        r  ON r.id = u."rolId"
JOIN "RolPermiso" rp ON rp."rolId" = r.id
JOIN "Permiso"    p  ON p.id = rp."permisoId"
WHERE u.activo AND r.activo AND p.activo;

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
CREATE OR REPLACE VIEW "vw_Factura" AS
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
