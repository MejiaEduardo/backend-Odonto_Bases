/**
 * Verificacion de las consultas contra la base real.
 *
 * Instancia los servicios a mano (sin levantar Nest) y ejecuta sus metodos
 * contra una COPIA de la base. Sirve para comprobar que despues de las
 * migraciones 003, 004 y 005 ninguna consulta apunta a una columna que ya no
 * existe: el SQL es texto plano, asi que el compilador de TypeScript no lo
 * revisa.
 *
 * EJECUTAR (sobre la copia, nunca sobre odontologia):
 *   npx ts-node verificar-consultas.ts
 */
import { Pool } from 'pg';
import './src/database/tipos-pg';

import { CitasService } from './src/Citas/citas.service';
import { FacturaService } from './src/Factura/factura.service';
import { ExpedienteService } from './src/Expediente/expediente.service';
import { EmpleadoService } from './src/Empleado/empleado.service';
import { LogsService } from './src/logs/logs.service';
import { ModificarInfoService } from './src/EditarInformacion/modificarInfo.service';
import { ServiciosService } from './src/Servicios/Servicios.service';
import { EspecialidadService } from './src/Especialidad/especialidad.service';
import { RecordatorioService } from './src/Recordatorio/recordatorio.service';
import { AuthService } from './src/Auth/auth.service';

const BASE_DE_PRUEBA = process.env.DB_NAME_PRUEBA ?? 'prueba005';

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'odonto123',
  database: BASE_DE_PRUEBA,
});

// Lo unico que los servicios usan de DatabaseService es `pool`.
const db = { pool } as any;

// Dobles para las dependencias que no tocan la base.
const notificaciones = {
  notifyAll: () => {},
  notifyDoctor: () => {},
} as any;
const colaRabbit = { emit: () => {} } as any;
const jwt = { sign: () => 'token-de-prueba' } as any;

const citas = new CitasService(db, notificaciones);
const facturas = new FacturaService(db);
const expedientes = new ExpedienteService(db);
const empleados = new EmpleadoService(db);
const logs = new LogsService(db);
const modificar = new ModificarInfoService(db);
const servicios = new ServiciosService(db);
const especialidades = new EspecialidadService(db);
const recordatorios = new RecordatorioService(db, colaRabbit);
const auth = new AuthService(db, jwt);

let ok = 0;
let fallos = 0;

async function probar(nombre: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    const resumen = Array.isArray(r)
      ? `${r.length} fila(s)`
      : JSON.stringify(r ?? null).slice(0, 110);
    console.log(`  OK    ${nombre}  ->  ${resumen}`);
    ok++;
  } catch (e) {
    console.log(`  FALLA ${nombre}`);
    console.log(`        ${(e as Error).message}`);
    fallos++;
  }
}

async function main() {
  const { rows: chequeo } = await pool.query('SELECT current_database() AS db');
  if (chequeo[0].db === 'odontologia') {
    throw new Error('Esto NO se corre sobre la base real. Usa una copia.');
  }
  console.log(`Verificando consultas sobre la base "${chequeo[0].db}"\n`);

  // Ids reales de la copia
  const { rows: refs } = await pool.query(`
    SELECT
      (SELECT pa."personaId" FROM "Paciente" pa LIMIT 1)                        AS "personaPaciente",
      (SELECT e.id FROM "Empleado" e JOIN "Puesto" p ON p.id = e."puestoId"
        WHERE p.nombre = 'DOCTOR' LIMIT 1)                                      AS "doctorId",
      (SELECT id FROM "Cita" WHERE estado = 'COMPLETADA' LIMIT 1)               AS "citaCompletada",
      (SELECT id FROM "Cita" LIMIT 1)                                           AS "citaId",
      (SELECT id FROM "Factura" LIMIT 1)                                        AS "facturaId",
      (SELECT id FROM "Expediente" LIMIT 1)                                     AS "expedienteId",
      (SELECT id FROM "ServicioClinico" LIMIT 1)                                AS "servicioId",
      (SELECT e.id FROM "Empleado" e LIMIT 1)                                   AS "empleadoId",
      (SELECT u.correo FROM "User" u JOIN "Rol" r ON r.id = u."rolId"
        WHERE r.nombre = 'CLIENTE' LIMIT 1)                                     AS "correoCliente"
  `);
  const r = refs[0];
  console.log('Referencias:', JSON.stringify(r), '\n');

  console.log('AUTH');
  await probar('obtenerPerfil', () => auth.obtenerPerfil(r.correoCliente));
  await probar('validateUser (clave incorrecta)', () =>
    auth.validateUser({ correo: r.correoCliente, password: 'no-es' }),
  );

  console.log('\nCITAS');
  await probar('findAll', () => citas.findAll({}));
  await probar('findAll con filtros', () =>
    citas.findAll({ estado: 'CONFIRMADA', desdeHoy: true }),
  );
  await probar('findOne', () => citas.findOne(r.citaId));
  await probar('getCitasPorPaciente', () => citas.getCitasPorPaciente(r.personaPaciente));
  await probar('getCitasForDoctor', () => citas.getCitasForDoctor(r.doctorId));
  await probar('getHorasDisponibles', () => citas.getHorasDisponibles(r.doctorId, '2026-09-15'));
  await probar('getDoctoresDisponibles', () =>
    citas.getDoctoresDisponibles('2026-09-15', r.servicioId),
  );
  await probar('citasConfirmadas', () =>
    citas.citasConfirmadas(r.personaPaciente, r.doctorId),
  );
  await probar('marcarCancelacionVista', () => citas.marcarCancelacionVista(r.citaId));

  console.log('\nFACTURAS');
  await probar('citasFacturables', () => facturas.citasFacturables());
  await probar('citasFacturables con busqueda', () => facturas.citasFacturables('juan'));
  await probar('findAll', () => facturas.findAll());
  await probar('findAll con rango', () =>
    facturas.findAll('000', '2020-01-01', '2030-12-31'),
  );
  await probar('findOne', () => facturas.findOne(r.facturaId));
  await probar('reportes DIA', () => facturas.reportes('DIA'));
  await probar('reportes MES', () => facturas.reportes('MES'));

  console.log('\nEXPEDIENTES');
  await probar('findAll', () => expedientes.findAll());
  await probar('findOne', () => expedientes.findOne(r.expedienteId));
  await probar('findOne por paciente', () =>
    expedientes.findOne(r.personaPaciente, true),
  );
  await probar('getExpedientesPorDoctor', () =>
    expedientes.getExpedientesPorDoctor(r.doctorId),
  );
  await probar('getHistorialPaciente', () =>
    expedientes.getHistorialPaciente(r.personaPaciente),
  );

  console.log('\nEMPLEADOS');
  await probar('findAll', () => empleados.findAll());

  console.log('\nLOGS');
  await probar('findAll', () => logs.findAll());
  await probar('getLogsByEmpleado', () => logs.getLogsByEmpleado(r.empleadoId));

  console.log('\nSERVICIOS Y ESPECIALIDADES');
  await probar('servicios.findAll', () => servicios.findAll());
  await probar('especialidades.findAll', () => especialidades.findAll());

  console.log('\nMODIFICAR INFORMACION');
  await probar('buscarPorCorreo', () => modificar.buscarPorCorreo(r.correoCliente));

  console.log('\nRECORDATORIOS');
  await probar('procesarRecordatorios', () => recordatorios.procesarRecordatorios());

  // ---- Escrituras. Se hacen al final porque modifican la copia. ----
  console.log('\nESCRITURAS');
  await probar('signupUser (con segundo nombre)', () =>
    auth.signupUser({
      primerNombre: 'Ana',
      segundoNombre: 'Lucia',
      primerApellido: 'Mejia',
      segundoApellido: 'Portillo',
      correo: `prueba.${Date.now()}@correo.test`,
      password: 'Aa1!aaaa',
      dni: '0801-1999-54321',
      telefono: '+504 9988-7766',
      rtn: '08011999543210',
    }),
  );

  await probar('signupUser (sin segundo nombre)', () =>
    auth.signupUser({
      primerNombre: 'Beto',
      primerApellido: 'Zelaya',
      correo: `prueba2.${Date.now()}@correo.test`,
      password: 'Aa1!aaaa',
    }),
  );

  await probar('citas.create', () =>
    citas.create({
      fecha: '2026-11-20',
      hora: '09:00' as any,
      pacienteId: r.personaPaciente,
      doctorId: r.doctorId,
      servicioId: r.servicioId,
      estado: undefined as any,
    }),
  );

  await probar('citas.update', () =>
    citas.update(r.citaId, { fecha: '2026-11-21', hora: '10:00' as any }),
  );

  await probar('facturas.emitir (cita completada)', () =>
    facturas.emitir({ citaId: r.citaCompletada, rtnCliente: '08011999000011' }),
  );

  await probar('facturas.anular', () => facturas.anular(r.facturaId, 'Prueba de anulacion'));

  await probar('empleados.createEmpleado', () =>
    empleados.createEmpleado({
      primerNombre: 'Carla',
      segundoNombre: 'Isabel',
      primerApellido: 'Rivas',
      segundoApellido: 'Nunez',
      dni: '0801-1988-11223',
      telefono: '99887711',
      direccion: 'Tegucigalpa',
      fechaNac: new Date('1988-05-05'),
      activo: true,
      puesto: 'RECEPCIONISTA',
      salario: 18000,
      fechaIngreso: new Date(),
      correo: `empleado.${Date.now()}@clinica.test`,
      password: 'Aa1!aaaa',
      rol: 'RECEPCIONISTA',
    } as any),
  );

  await probar('modificar.completarDatosPorCorreo', () =>
    modificar.completarDatosPorCorreo(r.correoCliente, {
      segundoNombre: 'Alberto',
      telefono: '22334455',
    }),
  );

  console.log(`\n=== ${ok} consultas OK, ${fallos} con error ===`);
  await pool.end();
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
