import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/datebaseService.service';
import { HorarioLaboral, EstadoCita } from '../Enums/enums';
import { CreateCitaDto } from './dto/create.citas.dto';
import { UpdateCitaDto } from './dto/update.citas.dto';
import { HistorialCancelaDto } from './dto/historial-cancelaciones.dto';
import { NotificationService } from '../Notificaciones/notificaciones.service';
import { nombreSql, apellidoSql } from '../common/nombres';
import { idPacienteDesdePersona } from '../common/pacientes';

/*
 * NOTA SOBRE LOS IDS
 *
 * Desde la migracion 005 "Cita" apunta a "Paciente", no a "Persona". La API
 * publica sigue hablando en ids de PERSONA (`pacienteId`), que es lo que el
 * frontend tiene a mano en `user.persona.id`. La traduccion se hace aca, en
 * el borde, con idPacienteDesdePersona().
 *
 * Lo mismo con el doctor: la columna se llama "empleadoId" desde la 004,
 * porque apunta a "Empleado". El DTO sigue diciendo `doctorId`.
 *
 * NOTA SOBRE LA FECHA
 *
 * "Cita".fecha y "Cita".hora ya no se guardan por separado: hay una sola
 * columna "fechaHora" (TIMESTAMP), y `fecha` y `hora` son columnas GENERADAS
 * que mantiene PostgreSQL. Se pueden LEER como siempre, pero al escribir hay
 * que mandar "fechaHora".
 */

function normalizarHora(hora: string): string {
  if (!hora) return '';
  if (hora.startsWith('H')) {
    return hora.replace('H', '').replace('_', ':');
  }
  return hora;
}

/**
 * Junta 'YYYY-MM-DD' + 'HH:MM' en el timestamp que espera la columna
 * "fechaHora". Se arma como texto y no con `new Date(...)` a proposito: un
 * objeto Date de JavaScript arrastra la zona horaria del servidor y podria
 * correr la cita una hora, o un dia entero si es cerca de medianoche.
 */
function componerFechaHora(fecha: string, hora: string): string {
  const soloFecha = String(fecha).slice(0, 10);
  const horaNormal = normalizarHora(hora);
  const conSegundos = horaNormal.length === 5 ? `${horaNormal}:00` : horaNormal;
  return `${soloFecha} ${conSegundos}`;
}

/**
 * Columnas de "Cita" que se devuelven al frontend.
 *
 * Se listan explicitamente en vez de usar `c.*` para poder seguir mandando
 * `fecha` como 'YYYY-MM-DD' y `hora` como 'HH:MM', que es el formato con el
 * que trabajan las pantallas.
 */
const COLUMNAS_CITA = `
  c.id,
  -- Se manda como TEXTO, no como Date: un TIMESTAMP sin zona horaria que
  -- pasa por JSON se convierte a UTC y una cita de las 09:00 llega como
  -- las 15:00Z.
  to_char(c."fechaHora", 'YYYY-MM-DD"T"HH24:MI:SS') AS "fechaHora",
  to_char(c.fecha, 'YYYY-MM-DD') AS fecha,
  to_char(c.hora,  'HH24:MI')    AS hora,
  c.estado,
  c."empleadoId",
  c."empleadoId" AS "doctorId",
  c."servicioId",
  c."createdAt",
  c."updatedAt"
`;

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

    /*
     * El estado inicial depende de QUIEN crea la cita:
     *   - El cliente desde su portal manda SOLICITADA (queda por aprobar).
     *   - Recepcion la crea ya aprobada, en PENDIENTE.
     * Antes se ignoraba `estado` del DTO y siempre se insertaba 'PENDIENTE'.
     */
    const estadoInicial =
      createCitaDto.estado === EstadoCita.SOLICITADA
        ? EstadoCita.SOLICITADA
        : EstadoCita.PENDIENTE;
    const horaNormalizada = normalizarHora(hora);

    const doctorExists = await this.db.pool.query(
      `SELECT id, "personaId" FROM "Empleado" WHERE id = $1`,
      [doctorId],
    );
    if (doctorExists.rows.length === 0) {
      return { message: 'Doctor no encontrado', code: 21 };
    }

    /*
     * `pacienteId` llega como id de PERSONA. Se traduce al id de "Paciente",
     * creando el registro si esa persona todavia no era paciente (pasa cuando
     * recepcion agenda la primera cita de alguien).
     */
    const idPaciente = await idPacienteDesdePersona(this.db.pool, pacienteId);
    if (idPaciente === null) {
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

    const fechaHora = componerFechaHora(fecha, hora);

    const citaExistente = await this.db.pool.query(
      `
      SELECT id FROM "Cita"
      WHERE "fechaHora" = $1 AND "empleadoId" = $2 AND estado != 'CANCELADA'
      LIMIT 1
      `,
      [fechaHora, doctorId],
    );
    if (citaExistente.rows.length > 0) {
      return { message: 'El doctor ya tiene una cita en ese horario', code: 24 };
    }

    const citaPaciente = await this.db.pool.query(
      `
      SELECT id FROM "Cita"
      WHERE "fechaHora" = $1 AND "pacienteId" = $2 AND estado != 'CANCELADA'
      LIMIT 1
      `,
      [fechaHora, idPaciente],
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
          ("fechaHora", "pacienteId", "empleadoId", "servicioId", estado)
        VALUES ($1, $2, $3, $4, $5::"EstadoCita")
        RETURNING id,
                  to_char("fechaHora", 'YYYY-MM-DD"T"HH24:MI:SS') AS "fechaHora",
                  to_char(fecha, 'YYYY-MM-DD') AS fecha,
                  to_char(hora,  'HH24:MI')    AS hora,
                  "pacienteId", "empleadoId" AS "doctorId", "servicioId", estado
        `,
        [fechaHora, idPaciente, doctorId, servicioId, estadoInicial],
      );
      // Se devuelve el id de PERSONA, que es con el que trabaja el frontend.
      const nuevaCita = { ...inserted.rows[0], pacienteId };

      // id de la Persona asociada al doctor, para notificar
      const doctorPersonaId = doctorExists.rows[0].personaId;

      // Expediente del paciente (si existe) para vincular al doctor
      const expedienteResult = await client.query(
        `SELECT id FROM "Expediente" WHERE "pacienteId" = $1`,
        [idPaciente],
      );
      const expedienteId = expedienteResult.rows[0]?.id ?? null;

      // Vincular doctor <-> expediente si aún no existía esa relación.
      // Si el paciente todavia no tiene expediente no hay nada que vincular:
      // antes se insertaba con expedienteId = 0 y la clave foranea fallaba.
      if (expedienteId !== null) {
        await client.query(
          `
          INSERT INTO "ExpedienteDoctor" ("expedienteId", "empleadoId")
          VALUES ($1, $2)
          ON CONFLICT ("expedienteId", "empleadoId") DO NOTHING
          `,
          [expedienteId, doctorId],
        );
      }

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
  /**
   * Lista de citas para el panel de recepcion.
   *
   * @param filtros.fecha    dia exacto (YYYY-MM-DD)
   * @param filtros.estado   filtra por estado, p. ej. SOLICITADA
   * @param filtros.desdeHoy si es true, oculta las citas ya pasadas
   *
   * Devuelve el nombre del doctor y el correo/telefono del paciente, que es
   * lo que recepcion necesita para contactarlo sin buscarlo aparte.
   */
  async findAll(filtros: { fecha?: string; estado?: string; desdeHoy?: boolean }) {
    const params: any[] = [];
    const condiciones: string[] = [];

    if (filtros.fecha) {
      params.push(filtros.fecha);
      condiciones.push(`c.fecha = $${params.length}`);
    }
    if (filtros.estado) {
      params.push(filtros.estado);
      condiciones.push(`c.estado = $${params.length}::"EstadoCita"`);
    }
    if (filtros.desdeHoy) {
      condiciones.push(`c.fecha >= CURRENT_DATE`);
    }

    const whereClause = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const { rows } = await this.db.pool.query(
      `
      SELECT
        ${COLUMNAS_CITA},
        pac.id AS "pacienteId",
        json_build_object(
          'id', d.id,
          'personaId', d."personaId",
          'persona', json_build_object(
            'nombre',   ${nombreSql('dp')},
            'apellido', ${apellidoSql('dp')},
            'nombreCompleto', dp."nombreCompleto"
          )
        ) AS doctor,
        json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio,
        json_build_object(
          'id', pac.id,
          'pacienteId', pa.id,
          'nombre', ${nombreSql('pac')},
          'apellido', ${apellidoSql('pac')},
          'nombreCompleto', pac."nombreCompleto",
          'dni', pac.dni,
          'telefono', pac.telefono,
          'correo', u.correo
        ) AS paciente
      FROM "Cita" c
      JOIN "Empleado" d ON d.id = c."empleadoId"
      JOIN "Persona" dp ON dp.id = d."personaId"
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      JOIN "Paciente" pa ON pa.id = c."pacienteId"
      JOIN "Persona" pac ON pac.id = pa."personaId"
      LEFT JOIN "User" u ON u."personaId" = pac.id
      ${whereClause}
      ORDER BY c."fechaHora" ASC
      `,
      params,
    );

    return rows;
  }

  /**
   * Recepcion aprueba una solicitud: SOLICITADA -> PENDIENTE.
   * A partir de aqui el cliente puede confirmar su asistencia.
   */
  async aprobar(id: number) {
    try {
      const { rows } = await this.db.pool.query(
        `
        UPDATE "Cita"
        SET estado = 'PENDIENTE', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1 AND estado = 'SOLICITADA'
        RETURNING id, "empleadoId" AS "doctorId", estado
        `,
        [id],
      );

      if (rows.length === 0) {
        // O no existe, o ya no estaba en SOLICITADA
        const existe = await this.db.pool.query(
          `SELECT estado FROM "Cita" WHERE id = $1`,
          [id],
        );
        if (existe.rows.length === 0) {
          return { code: 4, message: 'Cita no encontrada' };
        }
        return {
          code: 5,
          message: `Solo se pueden aprobar solicitudes. Esta cita esta en ${existe.rows[0].estado}.`,
        };
      }

      this.notificationService.notifyAll('updateCitasDoctor', rows[0].doctorId);
      return { code: 0, message: 'Solicitud aprobada', data: rows[0] };
    } catch (error) {
      console.error(error);
      return { code: 500, message: 'No se pudo aprobar la solicitud' };
    }
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
      SELECT e.id, p."nombreCompleto"
      FROM "Empleado" e
      JOIN "Persona" p ON p.id = e."personaId"
      JOIN "Puesto"  pu ON pu.id = e."puestoId"
      WHERE pu.nombre = 'DOCTOR'
        AND e.activo = true
        AND EXISTS (
          SELECT 1 FROM "EspecialidadDoctor" ed
          WHERE ed."empleadoId" = e.id
            AND ed."especialidadId" = ANY($1::int[])
        )
      `,
      [especialidadIdsRequeridas],
    );

    const doctorIdsAptos = doctoresAptos.rows.map((d) => d.id);
    if (doctorIdsAptos.length === 0) {
      return [];
    }

    /*
     * Las citas CANCELADAS no ocupan horario: su hueco vuelve a quedar libre
     * (asi lo define el indice parcial de la base). Antes se contaban como
     * ocupadas y el horario quedaba bloqueado para siempre.
     */
    const citasDelDia = await this.db.pool.query(
      `
      SELECT "empleadoId" AS "doctorId", to_char(hora, 'HH24:MI') AS hora
      FROM "Cita"
      WHERE "empleadoId" = ANY($1::int[])
        AND fecha = $2::date
        AND estado <> 'CANCELADA'
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
        disponibles.push({
          id: doctor.id,
          nombre: doctor.nombreCompleto || `Doctor ${doctor.id}`,
        });
      }
    }

    return disponibles;
  }

  async getHorasDisponibles(doctorId: number, fecha: string) {
    const horariosLaborales = Object.values(HorarioLaboral) as string[];

    const { rows } = await this.db.pool.query(
      `
      SELECT to_char(hora, 'HH24:MI') AS hora
      FROM "Cita"
      WHERE "empleadoId" = $1
        AND fecha = $2::date
        AND estado != 'CANCELADA'
      `,
      [doctorId, fecha],
    );

    const horasOcupadas = rows.map((c) => c.hora);
    return horariosLaborales.filter((hora) => !horasOcupadas.includes(hora));
  }

  // Obteniendo citas por id del paciente
  async getCitasPorPaciente(pacienteId: number) {
    // `pacienteId` llega como id de PERSONA.
    const idPaciente = await idPacienteDesdePersona(this.db.pool, pacienteId);
    if (idPaciente === null) {
      return { message: 'Paciente no encontrado', code: 22 };
    }

    /*
     * Antes esta consulta descartaba las CANCELADA, asi que cuando
     * recepcion cancelaba o rechazaba una cita esta desaparecia de la
     * pantalla del paciente sin ninguna explicacion.
     *
     * Ahora se devuelven tambien las canceladas POR OTRA PERSONA que el
     * paciente todavia no ha leido, junto con el motivo. En cuanto pulsa
     * "Entendido" se marca `vistoPorPaciente` y deja de aparecer.
     *
     * Las que cancelo el propio paciente no se incluyen: ya sabe por que.
     */
    const { rows } = await this.db.pool.query(
      `
      SELECT
        ${COLUMNAS_CITA},
        $2::int AS "pacienteId",
        json_build_object(
          'id', d.id,
          'persona', json_build_object(
            'id', p.id,
            'nombre', ${nombreSql('p')},
            'apellido', ${apellidoSql('p')},
            'nombreCompleto', p."nombreCompleto"
          )
        ) AS doctor,
        json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio,
        CASE
          WHEN h.id IS NULL THEN NULL
          ELSE json_build_object(
            'id', h.id,
            'motivo', h."motivoCancelacion",
            'rolCancela', h."rolCancela",
            'fecha', h."fechaCancelacion"
          )
        END AS cancelacion
      FROM "Cita" c
      JOIN "Empleado" d ON d.id = c."empleadoId"
      JOIN "Persona" p ON p.id = d."personaId"
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      LEFT JOIN LATERAL (
        -- "rolCancela" paso a ser "rolCancelaId" contra la tabla "Rol"
        SELECT hc.id, hc."motivoCancelacion", hc."fechaCancelacion",
               rc.nombre AS "rolCancela"
        FROM "HistorialCancelacionCita" hc
        JOIN "Rol" rc ON rc.id = hc."rolCancelaId"
        WHERE hc."citaId" = c.id
          AND hc."vistoPorPaciente" = false
          AND UPPER(rc.nombre) NOT IN ('CLIENTE', 'PACIENTE')
        ORDER BY hc."fechaCancelacion" DESC
        LIMIT 1
      ) h ON true
      WHERE c."pacienteId" = $1
        AND (
          c.estado NOT IN ('CANCELADA', 'COMPLETADA')
          OR (c.estado = 'CANCELADA' AND h.id IS NOT NULL)
        )
      ORDER BY c."fechaHora" ASC
      `,
      [idPaciente, pacienteId],
    );

    return rows;
  }

  /**
   * El paciente pulsa "Entendido" en el aviso de cancelacion.
   *
   * No cambia la cita: solo deja constancia de que ya leyo el motivo,
   * para que el aviso no le vuelva a salir cada vez que entra.
   */
  async marcarCancelacionVista(citaId: number) {
    const { rowCount } = await this.db.pool.query(
      `
      UPDATE "HistorialCancelacionCita"
      SET "vistoPorPaciente" = true
      WHERE "citaId" = $1 AND "vistoPorPaciente" = false
      `,
      [citaId],
    );

    if (!rowCount) {
      return { code: 4, message: 'No hay avisos pendientes para esa cita' };
    }
    return { code: 0, message: 'Aviso marcado como leido' };
  }

  async findOne(id: number) {
    const { rows } = await this.db.pool.query(
      `
      SELECT ${COLUMNAS_CITA}, pa."personaId" AS "pacienteId"
      FROM "Cita" c
      JOIN "Paciente" pa ON pa.id = c."pacienteId"
      WHERE c.id = $1
      `,
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
          ${COLUMNAS_CITA},
          pac.id AS "pacienteId",
          json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio,
          json_build_object(
            'id', pac.id,
            'nombre', ${nombreSql('pac')},
            'apellido', ${apellidoSql('pac')},
            'nombreCompleto', pac."nombreCompleto"
          ) AS paciente,
          exp.id AS "expedienteId"
        FROM "Cita" c
        JOIN "ServicioClinico" s ON s.id = c."servicioId"
        JOIN "Paciente" pa ON pa.id = c."pacienteId"
        JOIN "Persona" pac ON pac.id = pa."personaId"
        LEFT JOIN "Expediente" exp ON exp."pacienteId" = c."pacienteId"
        WHERE c."empleadoId" = $1
        ORDER BY c."fechaHora" ASC
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
      `
      SELECT c.id, c."fechaHora", c.estado, c."pacienteId",
             c."empleadoId" AS "doctorId", c."servicioId",
             to_char(c.fecha, 'YYYY-MM-DD') AS fecha,
             to_char(c.hora,  'HH24:MI')    AS hora
      FROM "Cita" c WHERE c.id = $1
      `,
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
    const fechaCheck = updateCitaDto.fecha ?? cita.fecha;
    const nuevaFechaHora = componerFechaHora(fechaCheck, horaCheck);

    /*
     * Una cita CANCELADA no ocupa horario, asi que no cuenta como conflicto.
     * Antes esta consulta no filtraba por estado y ademas mandaba
     * `updateCitaDto.fecha` sin respaldo: si el DTO no traia fecha, comparaba
     * contra NULL y nunca detectaba nada.
     */
    const conflicto = await this.db.pool.query(
      `
      SELECT id FROM "Cita"
      WHERE "fechaHora" = $1 AND "empleadoId" = $2 AND id != $3
        AND estado <> 'CANCELADA'
      LIMIT 1
      `,
      [nuevaFechaHora, doctorCheck, id],
    );
    if (conflicto.rows.length > 0) {
      return { message: 'El doctor ya tiene una cita en ese horario', code: 24 };
    }

    /*
     * Estado tras reagendar:
     *
     *   - Si viene `estado` en el DTO se respeta. El portal del paciente
     *     manda SOLICITADA al reprogramar, porque un cambio de fecha u hora
     *     invalida la aprobacion anterior: recepcion debe revisar el nuevo
     *     horario. Asi la cita vuelve a la bandeja de solicitudes.
     *   - Si no viene (recepcion reagendando), se conserva el estado actual.
     *
     * Antes esta consulta ignoraba `horaNormalizada` y mandaba la hora cruda,
     * y ponia NULL en fecha si el DTO no la traia.
     */
    const estadoFinal = updateCitaDto.estado ?? cita.estado;

    const { rows } = await this.db.pool.query(
      `
      UPDATE "Cita"
      SET "fechaHora" = $1,
          estado      = $2::"EstadoCita"
      WHERE id = $3
      RETURNING id,
                to_char("fechaHora", 'YYYY-MM-DD"T"HH24:MI:SS') AS "fechaHora",
                to_char(fecha, 'YYYY-MM-DD') AS fecha,
                to_char(hora,  'HH24:MI')    AS hora,
                estado, "empleadoId" AS "doctorId", "servicioId"
      `,
      [nuevaFechaHora, estadoFinal, id],
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

      /*
       * El rol de quien cancela ya no es texto libre: desde la migracion 003
       * es "rolCancelaId", una clave foranea contra la tabla "Rol".
       */
      const rolRow = await client.query(
        `SELECT id FROM "Rol" WHERE UPPER(nombre) = UPPER($1) LIMIT 1`,
        [rolCancela],
      );
      if (rolRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return { code: 5, message: `El rol "${rolCancela}" no existe` };
      }
      const rolCancelaId = rolRow.rows[0].id;

      const updated = await client.query(
        `
        UPDATE "Cita"
        SET estado = 'CANCELADA'
        WHERE id = $1
        RETURNING "empleadoId" AS "doctorId"
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
          ("citaId", "motivoCancelacion", "usuarioCancelaId", "rolCancelaId")
        VALUES ($1, $2, $3, $4)
        `,
        [id, motivoCancelacion, usuarioCancelaId, rolCancelaId],
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

  /**
   * El doctor marca que la cita ya se atendio: CONFIRMADA/PENDIENTE -> COMPLETADA.
   *
   * Este era el eslabon que faltaba en la cadena de facturacion. Sin el, una
   * cita nunca llegaba a COMPLETADA y "Generar Factura" quedaba siempre vacio,
   * porque solo se pueden facturar citas completadas.
   */
  async completar(id: number) {
    try {
      const { rows } = await this.db.pool.query(
        `
        UPDATE "Cita"
        SET estado = 'COMPLETADA', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1 AND estado IN ('PENDIENTE', 'CONFIRMADA')
        RETURNING id, "empleadoId" AS "doctorId", estado
        `,
        [id],
      );

      if (rows.length === 0) {
        const existe = await this.db.pool.query(
          `SELECT estado FROM "Cita" WHERE id = $1`,
          [id],
        );
        if (existe.rows.length === 0) {
          return { code: 4, message: 'Cita no encontrada' };
        }
        return {
          code: 5,
          message: `No se puede completar una cita en estado ${existe.rows[0].estado}.`,
        };
      }

      this.notificationService.notifyAll('updateCitasDoctor', rows[0].doctorId);
      return { code: 0, message: 'Cita marcada como atendida', data: rows[0] };
    } catch (error) {
      console.error(error);
      return { code: 500, message: 'No se pudo completar la cita' };
    }
  }

  async confirmar(id: number) {
    try {
      const { rows } = await this.db.pool.query(
        `
        UPDATE "Cita"
        SET estado = 'CONFIRMADA'
        WHERE id = $1
        RETURNING "empleadoId" AS "doctorId"
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

    // `pacienteId` llega como id de PERSONA.
    const idPaciente = await idPacienteDesdePersona(this.db.pool, pacienteId);
    if (idPaciente === null) {
      return { message: 'no hay citas para completar' };
    }

    const { rows } = await this.db.pool.query(
      `
      SELECT
        ${COLUMNAS_CITA},
        $4::int AS "pacienteId",
        json_build_object('id', s.id, 'nombre', s.nombre, 'precio', s.precio) AS servicio
      FROM "Cita" c
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      WHERE c."pacienteId" = $1
        AND c."empleadoId" = $2
        AND c.estado = 'CONFIRMADA'
        AND c.fecha = $3::date
      `,
      [idPaciente, doctorId, fechaActual, pacienteId],
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