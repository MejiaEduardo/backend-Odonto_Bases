// logs.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/datebaseService.service';

@Injectable()
export class LogsService {
  constructor(private db: DatabaseService) {}

  async registrarLogout(empleadoId: number) {
    // 1. buscar el ultimo log del empleado sin logout
    const ultimoLog = await this.db.pool.query(
      `SELECT id FROM "Logs"
       WHERE "empleadoId" = $1 AND logout IS NULL
       ORDER BY login DESC
       LIMIT 1`,
      [empleadoId],
    );

    if (ultimoLog.rows.length === 0) {
      throw new NotFoundException('No existe log activo para este empleado');
    }

    // 2. actualizar el campo logout
    const result = await this.db.pool.query(
      `UPDATE "Logs" SET logout = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [ultimoLog.rows[0].id],
    );

    return result.rows[0];
  }

  async findAll() {
    const result = await this.db.pool.query(
      `SELECT l.*, p.nombre, p.apellido, e.puesto
       FROM "Logs" l
       JOIN "Empleado" e ON e.id = l."empleadoId"
       JOIN "Persona" p ON p.id = e."personaId"
       ORDER BY l.login DESC`,
    );
    return result.rows;
  }

  async findOne(id: number) {
    const result = await this.db.pool.query(
      `SELECT l.*, p.nombre, p.apellido, e.puesto
       FROM "Logs" l
       JOIN "Empleado" e ON e.id = l."empleadoId"
       JOIN "Persona" p ON p.id = e."personaId"
       WHERE l.id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Log no encontrado');
    }

    return result.rows[0];
  }

  async getLogsByEmpleado(empleadoId: number) {
    const result = await this.db.pool.query(
      `SELECT l.*, p.nombre, p.apellido, e.puesto
       FROM "Logs" l
       JOIN "Empleado" e ON e.id = l."empleadoId"
       JOIN "Persona" p ON p.id = e."personaId"
       WHERE l."empleadoId" = $1
       ORDER BY l.login DESC`,
      [empleadoId],
    );
    return result.rows;
  }
}