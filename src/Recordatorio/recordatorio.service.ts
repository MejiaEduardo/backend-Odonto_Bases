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

  async procesarRecordatorios() {
    console.log('--- DB: Buscando citas para recordatorio...');

    const { rows: citas } = await this.db.pool.query(
      `
      SELECT
        c.id,
        c.fecha,
        c.hora,
        p.nombre AS "nombrePaciente",
        u.correo
      FROM "Cita" c
      JOIN "Persona" p ON p.id = c."pacienteId"
      LEFT JOIN "User" u ON u."personaId" = p.id
      WHERE c.estado = 'PENDIENTE'
        AND c."recordatorio24h" = false
      `,
    );

    console.log(`--- DB: Encontradas ${citas.length} citas para procesar.`);

    for (const cita of citas) {
      const ahora = new Date();
      const fechaCompleta = new Date(`${cita.fecha}T${cita.hora}`);
      const partes = cita.hora.split(':');

      const Hora = parseInt(partes[0], 10);
      const MIN = parseInt(partes[1], 10);
      ahora.setHours(Hora, MIN, 0, 0);

      const diferenciaSeg = (fechaCompleta.getTime() - ahora.getTime()) / 1000;
      const horas = diferenciaSeg / 3600;
      const horasReal = Math.floor(horas);

      if (horasReal <= 48 && horasReal >= 47) {
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

        await this.db.pool.query(
          `UPDATE "Cita" SET "recordatorio24h" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
          [cita.id],
        );
      }
    }
  }
}