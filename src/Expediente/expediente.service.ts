import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { CreateExpedienteDto } from './dto/create-expediente.dto';
import { UpdateExpedienteDto } from './dto/update-expediente.dto';
import { CreateExpedienteDetalleDto } from './dto/create-expediente-detalle.dto';
import { DatabaseService } from '../database/datebaseService.service';
import { idPacienteDesdePersona } from '../common/pacientes';
import { nombreSql, apellidoSql } from '../common/nombres';

/**
 * Expedientes.
 *
 * Desde la migracion 005 "Expediente" apunta a "Paciente", no a "Persona".
 * La API sigue recibiendo y devolviendo `pacienteId` como id de PERSONA, que
 * es lo que tiene el frontend; la traduccion se hace en el borde.
 *
 * El puesto del empleado tampoco es texto: es "puestoId" contra el catalogo
 * "Puesto" (migracion 003).
 */

/** Consulta reutilizable: puesto del empleado resuelto como texto. */
const PUESTO_DE_EMPLEADO = `
  SELECT e.id, pu.nombre AS puesto
  FROM "Empleado" e
  JOIN "Puesto" pu ON pu.id = e."puestoId"
  WHERE e.id = $1
`;

@Injectable()
export class ExpedienteService {
  constructor(private readonly db: DatabaseService) {}

  // crea un nuevo expediente
  async create(createExpedienteDto: CreateExpedienteDto) {
    const { doctorId, pacienteId, alergias, enfermedades, medicamentos, observaciones, activo } =
      createExpedienteDto;

    // `pacienteId` llega como id de PERSONA: se traduce (y se registra como
    // paciente si todavia no lo estaba).
    const idPaciente = await idPacienteDesdePersona(this.db.pool, pacienteId);
    if (idPaciente === null) {
      throw new NotFoundException(
        `No se encontro la persona con ID ${pacienteId}`,
      );
    }

    // validar que el expediente no exista
    const existente = await this.db.pool.query(
      'SELECT id FROM "Expediente" WHERE "pacienteId" = $1',
      [idPaciente],
    );
    if (existente.rowCount && existente.rowCount > 0) {
      throw new BadRequestException(
        `El expediente para el paciente con ID ${pacienteId} ya existe`,
      );
    }

    // validar que el doctor exista y tenga el puesto correcto
    const doctor = await this.db.pool.query(PUESTO_DE_EMPLEADO, [doctorId]);
    if (doctor.rowCount === 0 || doctor.rows[0].puesto !== 'DOCTOR') {
      throw new NotFoundException(
        `No se encontro un doctor valido con ID ${doctorId}`,
      );
    }

    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      const nuevo = await client.query(
        `INSERT INTO "Expediente"
         ("pacienteId", alergias, enfermedades, medicamentos, observaciones, activo)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          idPaciente,
          alergias ?? null,
          enfermedades ?? null,
          medicamentos ?? null,
          observaciones ?? null,
          activo ?? true,
        ],
      );

      await client.query(
        'INSERT INTO "ExpedienteDoctor" ("expedienteId", "empleadoId") VALUES ($1, $2)',
        [nuevo.rows[0].id, doctorId],
      );

      await client.query('COMMIT');
      return this.findOne(nuevo.rows[0].id);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al crear expediente', error);
      throw new InternalServerErrorException(
        'Error desconocido al crear el expediente o su relacion con el doctor',
      );
    } finally {
      client.release();
    }
  }

  async findAll() {
    const result = await this.db.pool.query(
      /*
       * Se agregan dni y correo porque en la lista aparecian dos fichas
       * con el mismo nombre y no habia forma de saber cual era cual: solo
       * se veian los numeros internos de expediente y paciente.
       *
       * El orden es alfabetico para que los homonimos queden pegados y
       * salten a la vista en lugar de quedar dispersos por la lista.
       */
      /*
       * Se devuelve `pacienteId` como id de PERSONA para no romper las
       * pantallas, y ademas `pacienteRegistroId` con el id real de "Paciente".
       */
      `SELECT e.id, e.alergias, e.enfermedades, e.medicamentos, e.observaciones,
              e.activo, e."createdAt", e."updatedAt",
              pa."personaId" AS "pacienteId",
              e."pacienteId" AS "pacienteRegistroId",
              p."primerNombre", p."segundoNombre",
              p."primerApellido", p."segundoApellido",
              p."nombreCompleto",
              ${nombreSql('p')}   AS nombre,
              ${apellidoSql('p')} AS apellido,
              p.dni, u.correo
       FROM "Expediente" e
       JOIN "Paciente" pa ON pa.id = e."pacienteId"
       JOIN "Persona"  p  ON p.id  = pa."personaId"
       LEFT JOIN "User" u ON u."personaId" = p.id
       ORDER BY LOWER(p."nombreCompleto"), e.id`,
    );
    return result.rows;
  }

  /**
   * @param id           id del expediente, o id de PERSONA si idPaciente=true
   * @param idPaciente   busca por paciente en vez de por expediente
   */
  async findOne(id: number, idPaciente = false) {
    // Cuando se busca por paciente, el id que llega es de Persona.
    const filtro = idPaciente ? 'pa."personaId" = $1' : 'e.id = $1';

    const result = await this.db.pool.query(
      `SELECT e.*, pa."personaId",
              p."nombreCompleto",
              ${nombreSql('p')}   AS nombre,
              ${apellidoSql('p')} AS apellido,
              p.dni, u.correo
       FROM "Expediente" e
       JOIN "Paciente" pa ON pa.id = e."pacienteId"
       JOIN "Persona"  p  ON p.id  = pa."personaId"
       LEFT JOIN "User" u ON u."personaId" = p.id
       WHERE ${filtro}`,
      [id],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException(`Expediente con ID ${id} no encontrado`);
    }

    const expediente = result.rows[0];

    const detalles = await this.db.pool.query(
      'SELECT * FROM "ExpedienteDetalle" WHERE "expedienteId" = $1 ORDER BY fecha DESC',
      [expediente.id],
    );

    const doctores = await this.db.pool.query(
      `SELECT p."nombreCompleto"
       FROM "ExpedienteDoctor" ed
       JOIN "Empleado" emp ON emp.id = ed."empleadoId"
       JOIN "Persona" p ON p.id = emp."personaId"
       WHERE ed."expedienteId" = $1`,
      [expediente.id],
    );

    const archivos = await this.db.pool.query(
      `SELECT id, "nombreArchivo", "tipoArchivo", "filePath"
       FROM "ExpedienteArchivo"
       WHERE "expedienteId" = $1`,
      [expediente.id],
    );

    return {
      id: expediente.id,
      pacienteId: expediente.personaId,
      nombrePaciente: expediente.nombreCompleto,
      doctores: doctores.rows.map((d) => ({
        nombre: d.nombreCompleto,
      })),
      alergias: expediente.alergias,
      enfermedades: expediente.enfermedades,
      medicamentos: expediente.medicamentos,
      observaciones: expediente.observaciones,
      activo: expediente.activo,
      archivos: archivos.rows,
      detalles: detalles.rows,
    };
  }

  // obtener los expedientes por doctor
  async getExpedientesPorDoctor(id: number) {
    const result = await this.db.pool.query(
      `SELECT e.id, e.alergias, e.enfermedades, e.medicamentos, e.observaciones,
              e.activo, e."createdAt", e."updatedAt",
              pa."personaId" AS "pacienteId",
              p."nombreCompleto",
              ${nombreSql('p')}   AS nombre,
              ${apellidoSql('p')} AS apellido
       FROM "ExpedienteDoctor" ed
       JOIN "Expediente" e ON e.id = ed."expedienteId"
       JOIN "Paciente" pa  ON pa.id = e."pacienteId"
       JOIN "Persona"  p   ON p.id  = pa."personaId"
       WHERE ed."empleadoId" = $1`,
      [id],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException(
        `No tiene pacientes o expedientes asignados el doctor con ID ${id}`,
      );
    }

    return result.rows;
  }

  // actualizar un expediente por su id
  async update(id: number, updateExpedienteDto: UpdateExpedienteDto) {
    const actual = await this.db.pool.query(
      'SELECT * FROM "Expediente" WHERE id = $1',
      [id],
    );
    if (actual.rowCount === 0) {
      throw new NotFoundException(`No se encontro el expediente con ID ${id}`);
    }

    // validar paciente si se intenta modificar
    let nuevoIdPaciente: number | null = null;
    if (updateExpedienteDto.pacienteId) {
      // El DTO trae un id de PERSONA: se traduce al id de "Paciente".
      nuevoIdPaciente = await idPacienteDesdePersona(
        this.db.pool,
        updateExpedienteDto.pacienteId,
      );
      if (nuevoIdPaciente === null) {
        throw new BadRequestException(
          `El ID de paciente ${updateExpedienteDto.pacienteId} no corresponde a una persona existente`,
        );
      }

      // un paciente solo puede tener un expediente
      if (nuevoIdPaciente !== actual.rows[0].pacienteId) {
        const duplicado = await this.db.pool.query(
          'SELECT id FROM "Expediente" WHERE "pacienteId" = $1',
          [nuevoIdPaciente],
        );
        if (duplicado.rowCount && duplicado.rowCount > 0) {
          throw new BadRequestException(
            `Ya existe un expediente para el paciente con ID ${updateExpedienteDto.pacienteId}`,
          );
        }
      }
    }

    // validar doctor si se intenta modificar
    if (updateExpedienteDto.doctorId) {
      const doctor = await this.db.pool.query(PUESTO_DE_EMPLEADO, [
        updateExpedienteDto.doctorId,
      ]);
      if (doctor.rowCount === 0 || doctor.rows[0].puesto !== 'DOCTOR') {
        throw new BadRequestException(
          `El ID de doctor ${updateExpedienteDto.doctorId} no corresponde a un empleado con puesto DOCTOR`,
        );
      }
    }

    // armar el update dinamico solo con los campos enviados
    const campos: string[] = [];
    const valores: any[] = [];
    let i = 1;

    const nuevosValores: Record<string, unknown> = {
      '"pacienteId"': nuevoIdPaciente ?? undefined,
      alergias: updateExpedienteDto.alergias,
      enfermedades: updateExpedienteDto.enfermedades,
      medicamentos: updateExpedienteDto.medicamentos,
      observaciones: updateExpedienteDto.observaciones,
      activo: updateExpedienteDto.activo,
    };

    for (const [columna, valor] of Object.entries(nuevosValores)) {
      if (valor !== undefined) {
        campos.push(`${columna} = $${i}`);
        valores.push(valor);
        i++;
      }
    }

    if (campos.length === 0) {
      throw new BadRequestException('No se enviaron campos para actualizar');
    }

    campos.push(`"updatedAt" = CURRENT_TIMESTAMP`);
    valores.push(id);

    try {
      const result = await this.db.pool.query(
        `UPDATE "Expediente" SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`,
        valores,
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error al actualizar expediente', error);
      throw new InternalServerErrorException(
        'Ocurrio un error desconocido al intentar actualizar el expediente',
      );
    }
  }

  // eliminar un expediente por su id
  /* async remove(id: number) {
    const result = await this.db.pool.query(
      'DELETE FROM "Expediente" WHERE id = $1 RETURNING id',
      [id],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException(`No se encontro el expediente con ID ${id}`);
    }

    return { message: 'Expediente eliminado correctamente' };
  }
  */

  async crearExpedienteDetalle(data: CreateExpedienteDetalleDto) {
    const expediente = await this.db.pool.query(
      'SELECT id FROM "Expediente" WHERE id = $1',
      [data.expedienteId],
    );
    if (expediente.rowCount === 0) {
      throw new NotFoundException(
        `El expediente con ID ${data.expedienteId} no existe`,
      );
    }

    const doctor = await this.db.pool.query(
      'SELECT id FROM "Empleado" WHERE id = $1',
      [data.doctorId],
    );
    if (doctor.rowCount === 0) {
      throw new NotFoundException(
        `El doctor con ID ${data.doctorId} no existe`,
      );
    }

    try {
      const result = await this.db.pool.query(
        `INSERT INTO "ExpedienteDetalle"
         ("expedienteId", fecha, motivo, diagnostico, tratamiento, "planTratamiento", "empleadoId")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.expedienteId,
          data.fecha,
          data.motivo ?? null,
          data.diagnostico ?? null,
          data.tratamiento ?? null,
          data.planTratamiento ?? null,
          data.doctorId,
        ],
      );
      const detalle = result.rows[0];

      /*
       * Al registrar la consulta, la cita correspondiente se marca como
       * COMPLETADA automaticamente. Es lo que habilita a recepcion para
       * facturarla: solo se pueden facturar citas completadas.
       *
       * Se busca la cita de ESE paciente con ESE doctor en la fecha del
       * detalle que siga activa. Si no hay ninguna (p. ej. el doctor
       * documenta algo sin cita previa), simplemente no se hace nada:
       * el detalle del expediente se guarda igual.
       */
      try {
        const { rows: citas } = await this.db.pool.query(
          `
          UPDATE "Cita" c
          SET estado = 'COMPLETADA'
          FROM "Expediente" e
          WHERE e.id = $1
            AND c."pacienteId" = e."pacienteId"
            AND c."empleadoId" = $2
            AND c.fecha = $3::date
            AND c.estado IN ('PENDIENTE', 'CONFIRMADA')
          RETURNING c.id
          `,
          [data.expedienteId, data.doctorId, String(data.fecha).split('T')[0]],
        );

        if (citas.length > 0) {
          console.log(`Cita ${citas[0].id} marcada como COMPLETADA al registrar la consulta.`);
        }
      } catch (e) {
        // No se interrumpe el guardado del expediente por esto
        console.error('No se pudo completar la cita asociada:', e);
      }

      return detalle;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Error interno al crear el detalle del expediente',
      );
    }
  }

  // obtener el historial completo de un paciente por su id
  async getHistorialPaciente(pacienteId: number) {
    // `pacienteId` llega como id de PERSONA.
    const result = await this.db.pool.query(
      `SELECT ed.*, p."nombreCompleto",
              ${nombreSql('p')}   AS nombre,
              ${apellidoSql('p')} AS apellido
       FROM "ExpedienteDetalle" ed
       JOIN "Expediente" e  ON e.id  = ed."expedienteId"
       JOIN "Paciente"   pa ON pa.id = e."pacienteId"
       JOIN "Empleado" emp  ON emp.id = ed."empleadoId"
       JOIN "Persona" p     ON p.id  = emp."personaId"
       WHERE pa."personaId" = $1
       ORDER BY ed.fecha DESC`,
      [pacienteId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException(
        `No se encontro historial para el paciente con ID ${pacienteId}`,
      );
    }

    return result.rows;
  }
}