CREATE TYPE "Rol" AS ENUM ('ADMIN', 'DOCTOR', 'RECEPCIONISTA', 'CLIENTE');

-- CreateEnum
CREATE TYPE "Puesto" AS ENUM ('DOCTOR', 'RECEPCIONISTA', 'ADMIN', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('PENDIENTE', 'COMPLETADA', 'CANCELADA', 'CONFIRMADA');

-- CreateTable
CREATE TABLE "Persona" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "dni" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "fechaNac" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "correo" TEXT NOT NULL,
    "password" TEXT,
    "rol" "Rol" NOT NULL DEFAULT 'CLIENTE',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "personaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoVerificacion" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaExpiracion" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CodigoVerificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empleado" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "puesto" "Puesto" NOT NULL,
    "salario" DOUBLE PRECISION NOT NULL,
    "fechaIngreso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Especialidad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Especialidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EspecialidadDoctor" (
    "doctorId" INTEGER NOT NULL,
    "especialidadId" INTEGER NOT NULL,
    "fechaAsociacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EspecialidadDoctor_pkey" PRIMARY KEY ("doctorId","especialidadId")
);

-- CreateTable
CREATE TABLE "ServicioEspecialidad" (
    "servicioId" INTEGER NOT NULL,
    "especialidadId" INTEGER NOT NULL,

    CONSTRAINT "ServicioEspecialidad_pkey" PRIMARY KEY ("servicioId","especialidadId")
);

-- CreateTable
CREATE TABLE "ServicioClinico" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioClinico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expediente" (
    "id" SERIAL NOT NULL,
    "pacienteId" INTEGER NOT NULL,
    "alergias" TEXT,
    "enfermedades" TEXT,
    "medicamentos" TEXT,
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expediente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpedienteDoctor" (
    "expedienteId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "fechaAsociacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpedienteDoctor_pkey" PRIMARY KEY ("expedienteId","doctorId")
);

-- CreateTable
CREATE TABLE "ExpedienteDetalle" (
    "id" SERIAL NOT NULL,
    "expedienteId" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "diagnostico" TEXT,
    "tratamiento" TEXT,
    "planTratamiento" TEXT,
    "doctorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpedienteDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpedienteArchivo" (
    "id" SERIAL NOT NULL,
    "expedienteId" INTEGER NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "tipoArchivo" TEXT,
    "creadoPorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "filePath" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,

    CONSTRAINT "ExpedienteArchivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cita" (
    "id" SERIAL NOT NULL,
    "fecha" TEXT NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'PENDIENTE',
    "pacienteId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "servicioId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hora" TEXT NOT NULL,
    "recordatorio1h" BOOLEAN NOT NULL DEFAULT false,
    "recordatorio24h" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialCancelacionCita" (
    "id" SERIAL NOT NULL,
    "citaId" INTEGER NOT NULL,
    "motivoCancelacion" TEXT NOT NULL,
    "usuarioCancelaId" INTEGER NOT NULL,
    "rolCancela" VARCHAR(50) NOT NULL,
    "fechaCancelacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialCancelacionCita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Logs" (
    "id" SERIAL NOT NULL,
    "empleadoId" INTEGER NOT NULL,
    "login" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Factura" (
    "id" SERIAL NOT NULL,
    "numeroFactura" TEXT NOT NULL,
    "cai" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pacienteId" INTEGER NOT NULL,
    "doctorId" INTEGER,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "descuentos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importeExonerado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importeExento" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isv15" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isv18" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPagar" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "citaId" INTEGER,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetalleFactura" (
    "id" SERIAL NOT NULL,
    "facturaId" INTEGER NOT NULL,
    "servicioId" INTEGER,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DOUBLE PRECISION NOT NULL,
    "totalLinea" DOUBLE PRECISION NOT NULL,
    "aplicaISV" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetalleFactura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_correo_key" ON "User"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "User_personaId_key" ON "User"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoVerificacion_userId_key" ON "CodigoVerificacion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Empleado_personaId_key" ON "Empleado"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "Especialidad_nombre_key" ON "Especialidad"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Expediente_pacienteId_key" ON "Expediente"("pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpedienteArchivo_storageName_key" ON "ExpedienteArchivo"("storageName");

-- CreateIndex
CREATE UNIQUE INDEX "HistorialCancelacionCita_citaId_key" ON "HistorialCancelacionCita"("citaId");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_numeroFactura_key" ON "Factura"("numeroFactura");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_citaId_key" ON "Factura"("citaId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoVerificacion" ADD CONSTRAINT "CodigoVerificacion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EspecialidadDoctor" ADD CONSTRAINT "EspecialidadDoctor_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EspecialidadDoctor" ADD CONSTRAINT "EspecialidadDoctor_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "Especialidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEspecialidad" ADD CONSTRAINT "ServicioEspecialidad_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioClinico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEspecialidad" ADD CONSTRAINT "ServicioEspecialidad_especialidadId_fkey" FOREIGN KEY ("especialidadId") REFERENCES "Especialidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expediente" ADD CONSTRAINT "Expediente_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpedienteDoctor" ADD CONSTRAINT "ExpedienteDoctor_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExpedienteDoctor" ADD CONSTRAINT "ExpedienteDoctor_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExpedienteDetalle" ADD CONSTRAINT "ExpedienteDetalle_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpedienteDetalle" ADD CONSTRAINT "ExpedienteDetalle_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpedienteArchivo" ADD CONSTRAINT "ExpedienteArchivo_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpedienteArchivo" ADD CONSTRAINT "ExpedienteArchivo_expedienteId_fkey" FOREIGN KEY ("expedienteId") REFERENCES "Expediente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioClinico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialCancelacionCita" ADD CONSTRAINT "HistorialCancelacionCita_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Logs" ADD CONSTRAINT "Logs_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleFactura" ADD CONSTRAINT "DetalleFactura_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "Factura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleFactura" ADD CONSTRAINT "DetalleFactura_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioClinico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
