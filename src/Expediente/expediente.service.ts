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

@Injectable()
export class ExpedienteService {
  constructor(private readonly db: DatabaseService) {}

  // crea un nuevo expediente
  async create(createExpedienteDto: CreateExpedienteDto) {
    const { doctorId, pacienteId, alergias, enfermedades, medicamentos, observaciones, activo } =
      createExpedienteDto;

    // validar que la persona exista
    const persona = await this.db.pool.query(
      'SELECT id FROM "Persona" WHERE id = $1',
      [pacienteId],
    );
    if (persona.rowCount === 0) {
      throw new NotFoundException(
        `No se encontro la persona con ID ${pacienteId}`,
      );
    }

    // validar que el expediente no exista
    const existente = await this.db.pool.query(
      'SELECT id FROM "Expediente" WHERE "pacienteId" = $1',
      [pacienteId],
    );
    if (existente.rowCount && existente.rowCount > 0) {
      throw new BadRequestException(
        `El expediente para el paciente con ID ${pacienteId} ya existe`,
      );
    }

    // validar que el doctor exista y tenga el puesto correcto
    const doctor = await this.db.pool.query(
      'SELECT id, puesto FROM "Empleado" WHERE id = $1',
      [doctorId],
    );
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
         ("pacienteId", alergias, enfermedades, medicamentos, observaciones, activo, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         RETURNING *`,
        [
          pacienteId,
          alergias ?? null,
          enfermedades ?? null,
          medicamentos ?? null,
          observaciones ?? null,
          activo ?? true,
        ],
      );

      await client.query(
        'INSERT INTO "ExpedienteDoctor" ("expedienteId", "doctorId") VALUES ($1, $2)',
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
      `SELECT e.*, p.nombre, p.apellido, p.dni, u.correo
       FROM "Expediente" e
       JOIN "Persona" p ON p.id = e."pacienteId"
       LEFT JOIN "User" u ON u."personaId" = p.id
       ORDER BY LOWER(p.nombre), LOWER(p.apellido), e.id`,
    );
    return result.rows;
  }

  async findOne(id: number, idPaciente = false) {
    const columna = idPaciente ? '"pacienteId"' : 'id';

    const result = await this.db.pool.query(
      `SELECT e.*, p.nombre, p.apellido, p.dni, u.correo
       FROM "Expediente" e
       JOIN "Persona" p ON p.id = e."pacienteId"
       LEFT JOIN "User" u ON u."personaId" = p.id
       WHERE e.${columna} = $1`,
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
      `SELECT p.nombre, p.apellido
       FROM "ExpedienteDoctor" ed
       JOIN "Empleado" emp ON emp.id = ed."doctorId"
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
      nombrePaciente: `${expediente.nombre} ${expediente.apellido}`,
      doctores: doctores.rows.map((d) => ({
        nombre: `${d.nombre} ${d.apellido}`,
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
      `SELECT e.*, p.nombre, p.apellido
       FROM "ExpedienteDoctor" ed
       JOIN "Expediente" e ON e.id = ed."expedienteId"
       JOIN "Persona" p ON p.id = e."pacienteId"
       WHERE ed."doctorId" = $1`,
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
    if (updateExpedienteDto.pacienteId) {
      const persona = await this.db.pool.query(
        'SELECT id FROM "Persona" WHERE id = $1',
        [updateExpedienteDto.pacienteId],
      );
      if (persona.rowCount === 0) {
        throw new BadRequestException(
          `El ID de paciente ${updateExpedienteDto.pacienteId} no corresponde a una persona existente`,
        );
      }

      // un paciente solo puede tener un expediente
      if (updateExpedienteDto.pacienteId !== actual.rows[0].pacienteId) {
        const duplicado = await this.db.pool.query(
          'SELECT id FROM "Expediente" WHERE "pacienteId" = $1',
          [updateExpedienteDto.pacienteId],
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
      const doctor = await this.db.pool.query(
        'SELECT id, puesto FROM "Empleado" WHERE id = $1',
        [updateExpedienteDto.doctorId],
      );
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

    const mapa = {
      pacienteId: '"pacienteId"',
      alergias: 'alergias',
      enfermedades: 'enfermedades',
      medicamentos: 'medicamentos',
      observaciones: 'observaciones',
      activo: 'activo',
    };

    for (const [clave, columna] of Object.entries(mapa)) {
      if (updateExpedienteDto[clave] !== undefined) {
        campos.push(`${columna} = $${i}`);
        valores.push(updateExpedienteDto[clave]);
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
         ("expedienteId", fecha, motivo, diagnostico, tratamiento, "planTratamiento", "doctorId", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
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
          SET estado = 'COMPLETADA', "updatedAt" = CURRENT_TIMESTAMP
          FROM "Expediente" e
          WHERE e.id = $1
            AND c."pacienteId" = e."pacienteId"
            AND c."doctorId" = $2
            AND c.fecha = $3
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
    const result = await this.db.pool.query(
      `SELECT ed.*, p.nombre, p.apellido
       FROM "ExpedienteDetalle" ed
       JOIN "Expediente" e ON e.id = ed."expedienteId"
       JOIN "Empleado" emp ON emp.id = ed."doctorId"
       JOIN "Persona" p ON p.id = emp."personaId"
       WHERE e."pacienteId" = $1
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