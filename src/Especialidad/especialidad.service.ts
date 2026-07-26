import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateEspecialidadDto } from './dto/create_especialidad.dto';
import { UpdateEspecialidadDto } from './dto/update_especialidad.dto';

/**
 * CRUD de Especialidades.
 *
 * La tabla "Especialidad" ya existía en el esquema, pero no había ningún
 * controlador que la expusiera. El frontend la necesita en dos lugares:
 *   - la pantalla /especialidades (administración)
 *   - el formulario de Servicios, que asocia especialidades a cada servicio
 *
 * Códigos de retorno (mismo criterio que ServiciosService):
 *   0 = ok | 3 = nombre duplicado | 4 = no encontrada
 *   5 = tiene relaciones que impiden borrarla | 500 = error interno
 */
@Injectable()
export class EspecialidadService {
  constructor(private readonly db: DatabaseService) {}

  async findAll() {
    const { rows } = await this.db.pool.query(
      `SELECT id, nombre, descripcion, "createdAt", "updatedAt"
       FROM "Especialidad"
       ORDER BY nombre`,
    );
    return rows;
  }

  async findOne(id: number) {
    const { rows } = await this.db.pool.query(
      `SELECT id, nombre, descripcion, "createdAt", "updatedAt"
       FROM "Especialidad" WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return { message: 'Especialidad no encontrada', code: 4 };
    }
    return rows[0];
  }

  async create(dto: CreateEspecialidadDto) {
    try {
      const duplicada = await this.db.pool.query(
        `SELECT id FROM "Especialidad" WHERE LOWER(nombre) = LOWER($1) LIMIT 1`,
        [dto.nombre.trim()],
      );
      if (duplicada.rows.length > 0) {
        return { message: 'Ya existe una especialidad con ese nombre', code: 3 };
      }

      const { rows } = await this.db.pool.query(
        `INSERT INTO "Especialidad" (nombre, descripcion, "updatedAt")
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         RETURNING id, nombre, descripcion, "createdAt", "updatedAt"`,
        [dto.nombre.trim(), dto.descripcion?.trim() ?? null],
      );
      return { message: 'Especialidad creada correctamente', code: 0, data: rows[0] };
    } catch {
      return { message: 'Error al crear la especialidad', code: 500 };
    }
  }

  async update(id: number, dto: UpdateEspecialidadDto) {
    try {
      const existe = await this.db.pool.query(
        `SELECT id FROM "Especialidad" WHERE id = $1`,
        [id],
      );
      if (existe.rows.length === 0) {
        return { message: 'Especialidad no encontrada', code: 4 };
      }

      if (dto.nombre) {
        const duplicada = await this.db.pool.query(
          `SELECT id FROM "Especialidad"
           WHERE LOWER(nombre) = LOWER($1) AND id <> $2 LIMIT 1`,
          [dto.nombre.trim(), id],
        );
        if (duplicada.rows.length > 0) {
          return { message: 'Ya existe otra especialidad con ese nombre', code: 3 };
        }
      }

      // Construimos el SET solo con los campos que vienen en el body
      const campos: string[] = [];
      const valores: unknown[] = [];
      let i = 1;

      if (dto.nombre !== undefined) {
        campos.push(`nombre = $${i++}`);
        valores.push(dto.nombre.trim());
      }
      if (dto.descripcion !== undefined) {
        campos.push(`descripcion = $${i++}`);
        valores.push(dto.descripcion?.trim() ?? null);
      }

      if (campos.length === 0) {
        return { message: 'No se enviaron campos para actualizar', code: 1 };
      }

      campos.push(`"updatedAt" = CURRENT_TIMESTAMP`);
      valores.push(id);

      const { rows } = await this.db.pool.query(
        `UPDATE "Especialidad" SET ${campos.join(', ')}
         WHERE id = $${i}
         RETURNING id, nombre, descripcion, "createdAt", "updatedAt"`,
        valores,
      );
      return { message: 'Especialidad actualizada correctamente', code: 0, data: rows[0] };
    } catch {
      return { message: 'Error al actualizar la especialidad', code: 500 };
    }
  }

  async remove(id: number) {
    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      const existe = await client.query(
        `SELECT id FROM "Especialidad" WHERE id = $1`,
        [id],
      );
      if (existe.rows.length === 0) {
        await client.query('ROLLBACK');
        return { message: 'Especialidad no encontrada', code: 4 };
      }

      // Si hay servicios usándola, avisamos en vez de dejar que reviente la FK
      const enServicios = await client.query(
        `SELECT "servicioId" FROM "ServicioEspecialidad" WHERE "especialidadId" = $1 LIMIT 1`,
        [id],
      );
      if (enServicios.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          message:
            'No se puede eliminar: hay servicios asociados a esta especialidad',
          code: 5,
        };
      }

      // Las asignaciones a doctores sí se limpian automáticamente
      await client.query(
        `DELETE FROM "EspecialidadDoctor" WHERE "especialidadId" = $1`,
        [id],
      );
      await client.query(`DELETE FROM "Especialidad" WHERE id = $1`, [id]);

      await client.query('COMMIT');
      return { message: 'Especialidad eliminada correctamente', code: 0 };
    } catch {
      await client.query('ROLLBACK');
      return { message: 'Error al eliminar la especialidad', code: 500 };
    } finally {
      client.release();
    }
  }
}
