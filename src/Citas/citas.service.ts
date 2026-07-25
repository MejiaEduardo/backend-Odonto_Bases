import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/datebaseService.service';
import { HorarioLaboral } from '../Enums/enums';
import { CreateCitaDto } from './dto/create.citas.dto';
import { UpdateCitaDto } from './dto/update.citas.dto';
import { HistorialCancelaDto } from './dto/historial-cancelaciones.dto';
import { NotificationService } from '../Notificaciones/notificaciones.service';


function normalizarHora(hora: string): string {
  if (!hora) return '';
  if (hora.startsWith('H')) {
    return hora.replace('H', '').replace('_', ':');
  }
  return hora;
}

@Injectable()
export class CitasService {
  constructor(
    private db: DatabaseService,
    private notificationService: NotificationService,
  ) {}

  private getFechaActualFormateada(): string {
    const ahora = new Date();
    const fechaLocal = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    return fechaLocal.toISOString().slice(0, 10);
  }

  async create(createCitaDto: CreateCitaDto) {
    const { fecha, hora, pacienteId, doctorId, servicioId } = createCitaDto;
    const horaNormalizada = normalizarHora(hora);

    const doctorExists = await this.db.pool.query(
      `SELECT id, "personaId" FROM "Empleado" WHERE id = $1`,
      [doctorId],
    );
    if (doctorExists.rows.length === 0) {
      return { message: 'Doctor no encontrado', code: 21 };
    }

    const pacienteExists = await this.db.pool.query(
      `SELECT id FROM "Persona" WHERE id = $1`,
      [pacienteId],
    );
    if (pacienteExists.rows.length === 0) {
      return { message: 'Paciente no encontrado', code: 22 };
    }

    if (isNaN(new Date(fecha).getTime())) {
      return { message: 'Formato de fecha inválido', code: 23 };
    }

    const fechaConvertida = new Date(fecha);
    const fechaActual = new Date();
    fechaActual.setDate(fechaActual.getDate() - 1);
    if (fechaConvertida < fechaActual) {
      return { message: 'No se puede agendar una cita en el pasado', code: 25 };
    }

    if (!hora || !Object.values(HorarioLaboral).includes(hora as HorarioLaboral)) {
      return { message: 'Hora inválida', code: 26 };
    }

    const citaExistente = await this.db.pool.query(
      `
      SELECT id FROM "Cita"
      WHERE fecha = $1 AND "doctorId" = $2 AND hora = $3 AND estado != 'CANCELADA'
      LIMIT 1
      `,
      [fecha, doctorId, horaNormalizada],
    );
    if (citaExistente.rows.length > 0) {
      console.error('DEBUG: Doctor Ocupado. Se ejecutará el return.');
      return { message: 'El doctor ya tiene una cita en ese horario', code: 24 };
    }

    const citaPaciente = await this.db.pool.query(
      `
      SELECT id FROM "Cita"
      WHERE fecha = $1 AND hora = $2 AND "pacienteId" = $3 AND estado != 'CANCELADA'
      LIMIT 1
      `,
      [fecha, horaNormalizada, pacienteId],
    );
    if (citaPaciente.rows.length > 0) {
      return { message: 'El paciente ya tiene una cita en ese horario', code: 28 };
    }

    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `
        INSERT INTO "Cita"
          (fecha, hora, "pacienteId", "doctorId", "servicioId", estado, "updatedAt")
        VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', CURRENT_TIMESTAMP)
        RETURNING id, fecha, hora, "pacienteId", "doctorId", "servicioId", estado
        `,
        [fecha, horaNormalizada, pacienteId, doctorId, servicioId],
      );
      const nuevaCita = inserted.rows[0];

      // id de la Persona asociada al doctor, para notificar
      const doctorPersonaId = doctorExists.rows[0].personaId;

      // Expediente del paciente (si existe) para vincular al doctor
      const expedienteResult = await client.query(
        `SELECT id FROM "Expediente" WHERE "pacienteId" = $1`,
        [pacienteId],
      );
      const expedienteId = expedienteResult.rows[0]?.id ?? 0;

      // Vincular doctor <-> expediente si aún no existía esa relación
      await client.query(
        `
        INSERT INTO "ExpedienteDoctor" ("expedienteId", "doctorId")
        VALUES ($1, $2)
        ON CONFLICT ("expedienteId", "doctorId") DO NOTHING
        `,
        [expedienteId, doctorId],
      );

      await client.query('COMMIT');

      // Notificar al doctor sobre la nueva cita
      this.notificationService.notifyDoctor(doctorPersonaId, 'updateCitasDoctor', doctorId);

      return { message: nuevaCita, code: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al crear la cita:', error);
      return { message: 'Error interno del servidor', code: 500 };
    } finally {
      client.release();
    }
  }

  // OBTENER TODAS LAS CITAS
  async findAll(filtros: { fecha?: string }) {
    const params: any[] = [];
    let whereClause = '';

    if (filtros.fecha) {
      // "fecha" es TEXT; se asume formato 'YYYY-MM-DD' (comparación exacta del día)
      params.push(filtros.fecha);
      whereClause = `WHERE c.fecha = $1`;
    }

    const { rows } = await this.db.pool.query(
      `
      SELECT
        c.*,
        json_build_object('id', d.id, 'personaId', d."personaId") AS doctor,
        json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio,
        json_build_object('id', pac.id, 'nombre', pac.nombre, 'apellido', pac.apellido) AS paciente
      FROM "Cita" c
      JOIN "Empleado" d ON d.id = c."doctorId"
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      JOIN "Persona" pac ON pac.id = c."pacienteId"
      ${whereClause}
      ORDER BY c.hora ASC
      `,
      params,
    );

    return rows;
  }

  async getDoctoresDisponibles(fecha: string, servicioId: number) {
    const horariosLaborales = Object.values(HorarioLaboral) as string[];

    const servicioEspecialidades = await this.db.pool.query(
      `SELECT "especialidadId" FROM "ServicioEspecialidad" WHERE "servicioId" = $1`,
      [servicioId],
    );

    if (servicioEspecialidades.rows.length === 0) {
      return [];
    }

    const especialidadIdsRequeridas = servicioEspecialidades.rows.map(
      (r) => r.especialidadId,
    );

    const doctoresAptos = await this.db.pool.query(
      `
      SELECT e.id, p.nombre, p.apellido
      FROM "Empleado" e
      JOIN "Persona" p ON p.id = e."personaId"
      WHERE e.puesto = 'DOCTOR'
        AND e.activo = true
        AND EXISTS (
          SELECT 1 FROM "EspecialidadDoctor" ed
          WHERE ed."doctorId" = e.id
            AND ed."especialidadId" = ANY($1::int[])
        )
      `,
      [especialidadIdsRequeridas],
    );

    const doctorIdsAptos = doctoresAptos.rows.map((d) => d.id);
    if (doctorIdsAptos.length === 0) {
      return [];
    }

    const citasDelDia = await this.db.pool.query(
      `
      SELECT "doctorId", hora
      FROM "Cita"
      WHERE "doctorId" = ANY($1::int[]) AND fecha = $2
      `,
      [doctorIdsAptos, fecha],
    );

    const citasPorDoctor = new Map<number, string[]>();
    for (const c of citasDelDia.rows) {
      const arr = citasPorDoctor.get(c.doctorId) ?? [];
      arr.push(c.hora);
      citasPorDoctor.set(c.doctorId, arr);
    }

    const disponibles: { id: number; nombre: string }[] = [];

    for (const doctor of doctoresAptos.rows) {
      const horasOcupadas = citasPorDoctor.get(doctor.id) ?? [];
      const horasLibres = horariosLaborales.filter(
        (hora) => !horasOcupadas.includes(hora),
      );

      if (horasLibres.length > 0) {
        const nombreCompleto = `${doctor.nombre} ${doctor.apellido ?? ''}`.trim();
        disponibles.push({ id: doctor.id, nombre: nombreCompleto || `Doctor ${doctor.id}` });
      }
    }

    return disponibles;
  }

  async getHorasDisponibles(doctorId: number, fecha: string) {
    const horariosLaborales = Object.values(HorarioLaboral) as string[];

    const { rows } = await this.db.pool.query(
      `
      SELECT hora FROM "Cita"
      WHERE "doctorId" = $1
        AND fecha LIKE '%' || $2 || '%'
        AND estado != 'CANCELADA'
      `,
      [doctorId, fecha],
    );

    const horasOcupadas = rows.map((c) => c.hora);
    return horariosLaborales.filter((hora) => !horasOcupadas.includes(hora));
  }

  // Obteniendo citas por id del paciente
  async getCitasPorPaciente(pacienteId: number) {
    const paciente = await this.db.pool.query(
      `SELECT id FROM "Persona" WHERE id = $1`,
      [pacienteId],
    );
    if (paciente.rows.length === 0) {
      return { message: 'Paciente no encontrado', code: 22 };
    }

    const { rows } = await this.db.pool.query(
      `
      SELECT
        c.*,
        json_build_object(
          'id', d.id,
          'persona', json_build_object('id', p.id, 'nombre', p.nombre, 'apellido', p.apellido)
        ) AS doctor,
        json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio
      FROM "Cita" c
      JOIN "Empleado" d ON d.id = c."doctorId"
      JOIN "Persona" p ON p.id = d."personaId"
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      WHERE c."pacienteId" = $1
        AND c.estado NOT IN ('CANCELADA', 'COMPLETADA')
      ORDER BY c.fecha ASC, c.hora ASC
      `,
      [pacienteId],
    );

    return rows;
  }

  async findOne(id: number) {
    const { rows } = await this.db.pool.query(
      `SELECT * FROM "Cita" WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return { message: 'Cita no encontrada', code: 4 };
    }
    return rows[0];
  }

  // Obtener las citas por doctor
  async getCitasForDoctor(doctorId: number) {
    try {
      const { rows } = await this.db.pool.query(
        `
        SELECT
          c.*,
          json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio,
          json_build_object('id', pac.id, 'nombre', pac.nombre, 'apellido', pac.apellido) AS paciente,
          exp.id AS "expedienteId"
        FROM "Cita" c
        JOIN "ServicioClinico" s ON s.id = c."servicioId"
        JOIN "Persona" pac ON pac.id = c."pacienteId"
        LEFT JOIN "Expediente" exp ON exp."pacienteId" = c."pacienteId"
        WHERE c."doctorId" = $1
        `,
        [doctorId],
      );

      return rows;
    } catch (error) {
      console.error(`Error al obtener citas para el doctor ${doctorId}:`, error);
      throw new Error(
        'No se pudieron recuperar las citas debido a un error en la base de datos.',
      );
    }
  }

  async update(id: number, updateCitaDto: UpdateCitaDto) {
    const citaResult = await this.db.pool.query(
      `SELECT * FROM "Cita" WHERE id = $1`,
      [id],
    );
    if (citaResult.rows.length === 0) {
      return { message: 'Cita no encontrada', code: 4 };
    }
    const cita = citaResult.rows[0];

    const horaNormalizada = updateCitaDto.hora
      ? normalizarHora(updateCitaDto.hora)
      : null;

    const horariosLaborales = (Object.values(HorarioLaboral) as string[]).map((h) =>
      h.replace('_', ':'),
    );

    if (horaNormalizada && !horariosLaborales.includes(horaNormalizada)) {
      return { message: 'Hora inválida', code: 26 };
    }

    let nuevaFecha: Date | null = null;
    if (updateCitaDto.fecha) {
      nuevaFecha = new Date(updateCitaDto.fecha);
      if (isNaN(nuevaFecha.getTime())) {
        return { message: 'Formato de fecha inválido', code: 23 };
      }
      const fechaActual = new Date();
      fechaActual.setDate(fechaActual.getDate() - 1);
      if (nuevaFecha < fechaActual) {
        return { message: 'No se puede agendar una cita en el pasado', code: 25 };
      }
    }

    const horaCheck = horaNormalizada ?? cita.hora;
    const doctorCheck = updateCitaDto.doctorId ?? cita.doctorId;

    const conflicto = await this.db.pool.query(
      `
      SELECT id FROM "Cita"
      WHERE fecha = $1 AND hora = $2 AND "doctorId" = $3 AND id != $4
      LIMIT 1
      `,
      [updateCitaDto.fecha, horaCheck, doctorCheck, id],
    );
    if (conflicto.rows.length > 0) {
      return { message: 'El doctor ya tiene una cita en ese horario', code: 24 };
    }

    // Nota: igual que el original, solo se actualizan fecha y hora
    const { rows } = await this.db.pool.query(
      `
      UPDATE "Cita"
      SET fecha = $1, hora = $2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [updateCitaDto.fecha, updateCitaDto.hora, id],
    );
    const citaActualizada = rows[0];

    this.notificationService.notifyAll('updateCitasDoctor', cita.doctorId);

    return { message: citaActualizada, code: 0 };
  }

  async cancelar(id: number, data: HistorialCancelaDto) {
    const { motivoCancelacion, usuarioCancelaId, rolCancela } = data;

    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      const updated = await client.query(
        `
        UPDATE "Cita"
        SET estado = 'CANCELADA', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING "doctorId"
        `,
        [id],
      );
      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return { code: 4, message: 'Cita no encontrada' };
      }
      const doctorId = updated.rows[0].doctorId;

      const doctorPersona = await client.query(
        `SELECT "personaId" FROM "Empleado" WHERE id = $1`,
        [doctorId],
      );
      const doctorPersonaId = doctorPersona.rows[0]?.personaId;

      await client.query(
        `
        INSERT INTO "HistorialCancelacionCita"
          (id, "citaId", "motivoCancelacion", "usuarioCancelaId", "rolCancela")
        VALUES (DEFAULT, $1, $2, $3, $4)
        `,
        [id, motivoCancelacion, usuarioCancelaId, rolCancela],
      );

      await client.query('COMMIT');

      this.notificationService.notifyDoctor(doctorPersonaId, 'updateCitasDoctor', doctorId);

      return { code: 0, message: 'Cita cancelada y registrada exitosamente' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al cancelar la cita con historial:', error);
      return {
        code: 500,
        message:
          'No se pudo cancelar la cita ni registrar el historial. Verifique que la cita exista y no haya sido cancelada previamente.',
      };
    } finally {
      client.release();
    }
  }

  async confirmar(id: number) {
    try {
      const { rows } = await this.db.pool.query(
        `
        UPDATE "Cita"
        SET estado = 'CONFIRMADA', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING "doctorId"
        `,
        [id],
      );
      if (rows.length === 0) {
        return { code: 4, message: 'Cita no encontrada' };
      }

      this.notificationService.notifyAll('updateCitasDoctor', rows[0].doctorId);

      return { code: 0, message: 'Cita confirmada exitosamente' };
    } catch (error) {
      console.error(error);
      return { code: 500, message: 'No se pudo confirmar la cita' };
    }
  }

  async citasConfirmadas(pacienteId: number, doctorId: number) {
    const fechaActual = this.getFechaActualFormateada();

    const { rows } = await this.db.pool.query(
      `
      SELECT
        c.*,
        json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio
      FROM "Cita" c
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      WHERE c."pacienteId" = $1
        AND c."doctorId" = $2
        AND c.estado = 'CONFIRMADA'
        AND c.fecha = $3
      `,
      [pacienteId, doctorId, fechaActual],
    );

    if (rows.length > 0) {
      return {
        mensaje: 'Citas confirmadas encontradas para la fecha actual.',
        data: rows,
      };
    }
    return { message: 'no hay citas para completar' };
  }
}