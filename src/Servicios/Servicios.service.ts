import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CreateServiciosDto } from './dto/create_servicios.dto';
import { UpdateServiciosDto } from './dto/update_Servicios.dto';
import { DatabaseService } from '../database/datebaseService.service';

/**
 * Este service usa el schema REAL de base.sql (generado por Prisma):
 *
 *   "ServicioClinico"(id, nombre, descripcion, precio, activo, createdAt, updatedAt)
 *   "Especialidad"(id, nombre, descripcion, createdAt, updatedAt)
 *   "ServicioEspecialidad"(servicioId, especialidadId)  -- PK compuesta, sin id propio
 *   "Cita"(id, ..., servicioId, ...)
 *
 * IMPORTANTE: Postgres exige comillas dobles y respetar mayúsculas/minúsculas
 * exactas para cualquier identificador que se haya creado entre comillas
 * (como hace Prisma). Por eso TODAS las tablas y columnas camelCase van
 * entre comillas dobles en las queries de abajo.
 *
 * "updatedAt" NO tiene default en la tabla, así que hay que asignarlo
 * manualmente en cada INSERT y UPDATE con CURRENT_TIMESTAMP.
 */

export interface ServicioRow {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: number; // double precision -> pg lo devuelve como number
  activo: boolean;
  especialidades: { id: number; nombre: string }[];
}

const SELECT_SERVICIO_CON_ESPECIALIDADES = `
  SELECT
    s.id,
    s.nombre,
    s.descripcion,
    s.precio,
    s.activo,
    COALESCE(
      json_agg(
        json_build_object('id', e.id, 'nombre', e.nombre)
      ) FILTER (WHERE e.id IS NOT NULL),
      '[]'
    ) AS especialidades
  FROM "ServicioClinico" s
  LEFT JOIN "ServicioEspecialidad" se ON se."servicioId" = s.id
  LEFT JOIN "Especialidad" e ON e.id = se."especialidadId"
`;

@Injectable()
export class ServiciosService {
  constructor(private db: DatabaseService) {}

  async findAll() {
    const { rows } = await this.db.pool.query<ServicioRow>(`
      ${SELECT_SERVICIO_CON_ESPECIALIDADES}
      GROUP BY s.id
      ORDER BY s.id
    `);
    return rows;
  }

  async findOne(id: number) {
    const { rows } = await this.db.pool.query<ServicioRow>(
      `
      ${SELECT_SERVICIO_CON_ESPECIALIDADES}
      WHERE s.id = $1
      GROUP BY s.id
      `,
      [id],
    );

    if (rows.length === 0) {
      return { message: 'Servicio no encontrado', code: 4 };
    }
    return rows[0];
  }

  async createServicio(createServiciosDto: CreateServiciosDto) {
    if (!createServiciosDto.nombre || createServiciosDto.nombre.trim() === '') {
      return { message: 'El nombre es obligatorio', code: 1 };
    }
    if (createServiciosDto.precio <= 0) {
      return { message: 'El precio debe ser mayor a cero', code: 2 };
    }

    const especialidadIds = Array.from(
      new Set(createServiciosDto.especialidadIds.map(Number)),
    );

    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // Verificar que no exista un servicio con el mismo nombre
      const existente = await client.query(
        `SELECT id FROM "ServicioClinico" WHERE nombre = $1 LIMIT 1`,
        [createServiciosDto.nombre],
      );
      if (existente.rows.length > 0) {
        await client.query('ROLLBACK');
        return { message: 'El servicio ya existe', code: 3 };
      }

      // Validar que existan todas las especialidades
      if (especialidadIds.length > 0) {
        const found = await client.query(
          `SELECT id FROM "Especialidad" WHERE id = ANY($1::int[])`,
          [especialidadIds],
        );
        if (found.rows.length !== especialidadIds.length) {
          await client.query('ROLLBACK');
          return { message: 'Alguna especialidad no existe', code: 7 };
        }
      }

      // Insertar el servicio (updatedAt no tiene default -> se asigna a mano)
      const inserted = await client.query(
        `
        INSERT INTO "ServicioClinico" (nombre, descripcion, precio, activo, "updatedAt")
        VALUES ($1, $2, $3, COALESCE($4, true), CURRENT_TIMESTAMP)
        RETURNING id
        `,
        [
          createServiciosDto.nombre,
          createServiciosDto.descripcion ?? null,
          createServiciosDto.precio,
          createServiciosDto.activo,
        ],
      );
      const nuevoServicioId = inserted.rows[0].id;

      // Insertar relaciones con especialidades (PK compuesta, sin columna id propia)
      if (especialidadIds.length > 0) {
        const values: string[] = [];
        const params: number[] = [];
        especialidadIds.forEach((eid, i) => {
          values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
          params.push(nuevoServicioId, eid);
        });
        await client.query(
          `INSERT INTO "ServicioEspecialidad" ("servicioId", "especialidadId") VALUES ${values.join(', ')}`,
          params,
        );
      }

      await client.query('COMMIT');

      // Releer con especialidades incluidas
      const final = await this.db.pool.query<ServicioRow>(
        `
        ${SELECT_SERVICIO_CON_ESPECIALIDADES}
        WHERE s.id = $1
        GROUP BY s.id
        `,
        [nuevoServicioId],
      );

      return { message: final.rows[0], code: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al crear el servicio:', error);
      return { message: 'Error interno del servidor', code: 500 };
    } finally {
      client.release();
    }
  }

  async updateServicio(id: number, updateServiciosDto: UpdateServiciosDto) {
    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      const servicioActual = await client.query(
        `SELECT id, nombre FROM "ServicioClinico" WHERE id = $1`,
        [id],
      );
      if (servicioActual.rows.length === 0) {
        await client.query('ROLLBACK');
        return { message: 'El servicio no existe', code: 4 };
      }

      // Verificar nombre duplicado (si viene y cambia)
      if (
        updateServiciosDto.nombre &&
        updateServiciosDto.nombre !== servicioActual.rows[0].nombre
      ) {
        const dup = await client.query(
          `SELECT id FROM "ServicioClinico" WHERE nombre = $1 LIMIT 1`,
          [updateServiciosDto.nombre],
        );
        if (dup.rows.length > 0) {
          await client.query('ROLLBACK');
          return { message: 'Servicio existente', code: 6 };
        }
      }

      // Validar precio si viene
      if (
        updateServiciosDto.precio !== undefined &&
        updateServiciosDto.precio <= 0
      ) {
        await client.query('ROLLBACK');
        return { message: 'El precio debe ser mayor a cero', code: 2 };
      }

      const especialidadIdsProvided = Array.isArray(updateServiciosDto.especialidadIds)
        ? Array.from(new Set(updateServiciosDto.especialidadIds.map(Number)))
        : undefined;

      if (especialidadIdsProvided !== undefined && especialidadIdsProvided.length > 0) {
        const found = await client.query(
          `SELECT id FROM "Especialidad" WHERE id = ANY($1::int[])`,
          [especialidadIdsProvided],
        );
        if (found.rows.length !== especialidadIdsProvided.length) {
          await client.query('ROLLBACK');
          return { message: 'Alguna especialidad no existe', code: 7 };
        }
      }

      // Construir SET dinámico solo con los campos definidos (sin especialidadIds)
      const camposActualizables = ['nombre', 'descripcion', 'precio', 'activo'] as const;
      const setClauses: string[] = [];
      const params: any[] = [];
      let idx = 1;

      for (const campo of camposActualizables) {
        const valor = (updateServiciosDto as any)[campo];
        if (valor !== undefined) {
          setClauses.push(`${campo} = $${idx}`);
          params.push(valor);
          idx++;
        }
      }

      // "updatedAt" siempre se actualiza si hay algún cambio
      if (setClauses.length > 0) {
        setClauses.push(`"updatedAt" = CURRENT_TIMESTAMP`);
      }

      // Reemplazar relaciones de especialidades si vinieron en el DTO
      if (especialidadIdsProvided !== undefined) {
        await client.query(
          `DELETE FROM "ServicioEspecialidad" WHERE "servicioId" = $1`,
          [id],
        );

        if (especialidadIdsProvided.length > 0) {
          const values: string[] = [];
          const relParams: number[] = [];
          especialidadIdsProvided.forEach((eid, i) => {
            values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
            relParams.push(id, eid);
          });
          await client.query(
            `INSERT INTO "ServicioEspecialidad" ("servicioId", "especialidadId") VALUES ${values.join(', ')}`,
            relParams,
          );
        }
      }

      // Actualizar el servicio si hay campos que cambiar
      if (setClauses.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE "ServicioClinico" SET ${setClauses.join(', ')} WHERE id = $${idx}`,
          params,
        );
      }

      await client.query('COMMIT');

      const final = await this.db.pool.query<ServicioRow>(
        `
        ${SELECT_SERVICIO_CON_ESPECIALIDADES}
        WHERE s.id = $1
        GROUP BY s.id
        `,
        [id],
      );

      return { message: final.rows[0], code: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al actualizar el servicio:', error);
      return { message: 'Error interno del servidor', code: 500 };
    } finally {
      client.release();
    }
  }

  async deleteServicio(id: number) {
    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // "Cita_servicioId_fkey" es ON DELETE RESTRICT: la BD igual bloquearía
      // el borrado, pero validamos antes para dar un mensaje claro.
      const citaAsociada = await client.query(
        `SELECT id FROM "Cita" WHERE "servicioId" = $1 LIMIT 1`,
        [id],
      );
      if (citaAsociada.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          message: 'No se puede eliminar el servicio porque tiene citas asociadas',
          code: 5,
        };
      }

      // "ServicioEspecialidad_servicioId_fkey" también es RESTRICT,
      // así que hay que borrar estas relaciones antes de borrar el servicio.
      await client.query(
        `DELETE FROM "ServicioEspecialidad" WHERE "servicioId" = $1`,
        [id],
      );
      await client.query(`DELETE FROM "ServicioClinico" WHERE id = $1`, [id]);

      await client.query('COMMIT');
      return { message: 'Servicio eliminado correctamente', code: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al eliminar el servicio:', error);
      return { message: 'Error interno del servidor', code: 500 };
    } finally {
      client.release();
    }
  }
}