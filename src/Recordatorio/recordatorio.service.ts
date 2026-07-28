// src/Recordatorio/recordatorio.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DatabaseService } from '../database/datebaseService.service';

@Injectable()
export class RecordatorioService {
  constructor(
    private db: DatabaseService,
    // inyectamos el cliente de rabbitmq configurado en el modulo
    @Inject('SCHEDULER_QUEUE_SERVICE') private readonly client: ClientProxy,
  ) {}

  /**
   * Manda el recordatorio de las citas que caen dentro de las proximas 24
   * horas y a las que todavia no se les mando.
   *
   * Cambios respecto de la version anterior:
   *
   *   - "Cita" ya no tiene las columnas `recordatorio1h` y `recordatorio24h`.
   *     Eran un grupo repetitivo: para agregar un aviso nuevo (48h, por
   *     ejemplo) habia que hacer un ALTER TABLE. Ahora hay una tabla,
   *     "RecordatorioCita", con una fila por aviso enviado.
   *   - La ventana de tiempo se calcula en SQL, con "fechaHora". Antes se
   *     hacia en JavaScript pisando la hora de `ahora` con la de la cita, lo
   *     cual daba siempre una diferencia en dias enteros y comparaba contra
   *     48/47 horas aunque el recordatorio se llamara "24h".
   */
  async procesarRecordatorios() {
    console.log('--- DB: Buscando citas para recordatorio...');

    const { rows: citas } = await this.db.pool.query(
      `
      SELECT
        c.id,
        to_char(c.fecha, 'YYYY-MM-DD') AS fecha,
        to_char(c.hora,  'HH24:MI')    AS hora,
        p."nombreCompleto" AS "nombrePaciente",
        u.correo
      FROM "Cita" c
      JOIN "Paciente" pa ON pa.id = c."pacienteId"
      JOIN "Persona"  p  ON p.id  = pa."personaId"
      LEFT JOIN "User" u ON u."personaId" = p.id
      WHERE c.estado IN ('PENDIENTE', 'CONFIRMADA')
        AND c."fechaHora" BETWEEN CURRENT_TIMESTAMP
                              AND CURRENT_TIMESTAMP + INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM "RecordatorioCita" rc
          WHERE rc."citaId" = c.id AND rc.tipo = '24H'
        )
        AND u.correo IS NOT NULL
      `,
    );

    console.log(`--- DB: Encontradas ${citas.length} citas para procesar.`);

    for (const cita of citas) {
      console.log(`-> Delegando cita ${cita.id} a RabbitMQ.`);

      const jobData = {
        citaId: cita.id,
        destinatario: cita.correo,
        nombrePaciente: cita.nombrePaciente,
        fecha: cita.fecha,
        hora: cita.hora,
      };
      console.log('--- Emitting to RabbitMQ:', jobData);
      this.client.emit('send_recordatorio', jobData);

      /*
       * Se deja constancia del aviso. El UNIQUE ("citaId", tipo) de la base
       * garantiza que no se mande dos veces el mismo aviso aunque el cron se
       * solape consigo mismo.
       */
      await this.db.pool.query(
        `INSERT INTO "RecordatorioCita" ("citaId", tipo)
         VALUES ($1, '24H')
         ON CONFLICT ("citaId", tipo) DO NOTHING`,
        [cita.id],
      );
    }
  }
}