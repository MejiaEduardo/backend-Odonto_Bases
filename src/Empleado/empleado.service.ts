import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateEmpleadoDto } from './dtoempleado/create-empleado.dto';
import { UpdateEmpleadoDto } from './dtoempleado/update-empleado.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmpleadoService {
  constructor(private db: DatabaseService) {}

  async createEmpleado(dto: CreateEmpleadoDto) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Validar que el DNI no exista
      const dniCheck = await client.query('SELECT id FROM "Persona" WHERE dni = $1', [dto.dni]);
      if (dniCheck.rows.length > 0) {
        throw new BadRequestException(`El DNI ${dto.dni} ya está registrado.`);
      }

      // 2. Validar que el correo no exista
      const correoCheck = await client.query('SELECT id FROM "User" WHERE correo = $1', [dto.correo]);
      if (correoCheck.rows.length > 0) {
        throw new BadRequestException(`El correo ${dto.correo} ya está registrado.`);
      }

      // 3. Crear la persona
      const personaQuery = `
        INSERT INTO "Persona" (nombre, apellido, dni, telefono, direccion, "fechaNac", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING *;
      `;
      const personaValues = [dto.nombre, dto.apellido, dto.dni, dto.telefono, dto.direccion, dto.fechaNac];
      const personaResult = await client.query(personaQuery, personaValues);
      const newpersona = personaResult.rows[0];

      // 4. Crear el empleado
      const empleadoQuery = `
        INSERT INTO "Empleado" ("personaId", puesto, salario, "fechaIngreso", activo)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
      const empleadoValues = [newpersona.id, dto.puesto, dto.salario, dto.fechaIngreso, dto.activo ?? true];
      const empleadoResult = await client.query(empleadoQuery, empleadoValues);
      const empleado = empleadoResult.rows[0];

      // 5. Crear el usuario vinculado
      const hashedPassword = await bcrypt.hash(dto.password, 10);
      const usuarioQuery = `
        INSERT INTO "User" (correo, password, rol, activo, "personaId", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *;
      `;
      const usuarioValues = [dto.correo, hashedPassword, dto.rol, dto.usuarioActivo ?? true, newpersona.id];
      const usuarioResult = await client.query(usuarioQuery, usuarioValues);
      const usuario = usuarioResult.rows[0];

      // 6. Asociar especialidades (solo tiene sentido para doctores)
      const especialidadIds = Array.from(
        new Set((dto.especialidadIds ?? []).map(Number)),
      ).filter((id) => Number.isInteger(id) && id > 0);

      if (especialidadIds.length > 0) {
        // Verificamos que todas existan antes de insertar
        const encontradas = await client.query(
          `SELECT id FROM "Especialidad" WHERE id = ANY($1::int[])`,
          [especialidadIds],
        );
        if (encontradas.rows.length !== especialidadIds.length) {
          await client.query('ROLLBACK');
          throw new BadRequestException('Alguna especialidad no existe');
        }

        const values = especialidadIds
          .map((_, i) => `($1, $${i + 2})`)
          .join(', ');
        await client.query(
          `INSERT INTO "EspecialidadDoctor" ("doctorId", "especialidadId")
           VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [empleado.id, ...especialidadIds],
        );
      }

      await client.query('COMMIT');
      return { empleado, usuario, newpersona, especialidadIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lista de empleados con su persona, usuario y especialidades.
   *
   * OJO: antes esta consulta era `SELECT e.*, p.*`, lo cual tenía dos fallos:
   *
   *   1. "Empleado" y "Persona" tienen AMBAS una columna `id`. Con `e.*, p.*`
   *      la segunda pisaba a la primera, así que el `id` que llegaba al
   *      frontend era el de la PERSONA, no el del EMPLEADO. Editar usaba el
   *      id equivocado.
   *
   *   2. Devolvía los campos planos, pero el frontend los lee anidados
   *      (`empleado.persona.nombre`, `empleado.persona.user.correo`), y
   *      el correo ni siquiera se consultaba porque faltaba el JOIN a "User".
   *      Eso dejaba la pantalla de edición EN BLANCO.
   *
   * Ahora se seleccionan las columnas explícitamente y se arman los objetos
   * anidados con json_build_object.
   */
  async findAll() {
    const query = `
      SELECT
        e.id,
        e."personaId",
        e.puesto,
        e.salario,
        e."fechaIngreso",
        e.activo,
        json_build_object(
          'id',        p.id,
          'nombre',    p.nombre,
          'apellido',  p.apellido,
          'dni',       p.dni,
          'telefono',  p.telefono,
          'direccion', p.direccion,
          'fechaNac',  p."fechaNac",
          'createdAt', p."createdAt",
          'updatedAt', p."updatedAt",
          'user',      json_build_object(
                          'correo', COALESCE(u.correo, ''),
                          'activo', COALESCE(u.activo, false),
                          'rol',    u.rol
                       )
        ) AS persona,
        u.correo AS correo,
        COALESCE(
          json_agg(
            json_build_object(
              'especialidad', json_build_object('id', esp.id, 'nombre', esp.nombre)
            )
          ) FILTER (WHERE esp.id IS NOT NULL),
          '[]'
        ) AS especialidades
      FROM "Empleado" e
      JOIN "Persona" p ON p.id = e."personaId"
      LEFT JOIN "User" u ON u."personaId" = p.id
      LEFT JOIN "EspecialidadDoctor" ed ON ed."doctorId" = e.id
      LEFT JOIN "Especialidad" esp ON esp.id = ed."especialidadId"
      GROUP BY e.id, e."personaId", e.puesto, e.salario, e."fechaIngreso",
               e.activo, p.id, u.correo, u.activo, u.rol
      ORDER BY e.id
    `;
    const result = await this.db.pool.query(query);
    return result.rows;
  }

  async findAllCompleto() {
    return this.findAll();
  }

  async UpdateEmpleado(id: number, dto: Partial<UpdateEmpleadoDto>) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Buscar el empleado existente por personaId (o id según tu diseño)
      const empCheck = await client.query('SELECT * FROM "Empleado" WHERE "personaId" = $1', [id]);
      if (empCheck.rows.length === 0) {
        throw new NotFoundException(`Empleado con ID ${id} no encontrado.`);
      }
      const empleadoExistente = empCheck.rows[0];
      const personaId = empleadoExistente.personaId;

      // 2. Validar DNI si viene en el DTO
      if (dto.dni) {
        const dniCheck = await client.query('SELECT id, dni FROM "Persona" WHERE dni = $1', [dto.dni]);
        if (dniCheck.rows.length > 0 && dniCheck.rows[0].id !== personaId) {
          throw new BadRequestException(`El DNI ${dto.dni} ya está registrado.`);
        }
      }

      // 3. Actualizar Persona
      const personaFields: string[] = [];
      const personaValues: any[] = [];
      let pIndex = 1;

      const camposPersona = {
        nombre: dto.nombre,
        apellido: dto.apellido,
        dni: dto.dni,
        telefono: dto.telefono,
        direccion: dto.direccion,
        fechaNac: dto.fechaNac,
      };

      for (const [key, value] of Object.entries(camposPersona)) {
        if (value !== undefined) {
          personaFields.push(`"${key}" = $${pIndex++}`);
          personaValues.push(value);
        }
      }

      let personaActualizada = null;
      if (personaFields.length > 0) {
        personaValues.push(personaId);
        const updatePersonaQuery = `
          UPDATE "Persona" SET ${personaFields.join(', ')}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $${pIndex} 
          RETURNING *;
        `;
        const pRes = await client.query(updatePersonaQuery, personaValues);
        personaActualizada = pRes.rows[0];
      }

      // 4. Actualizar Empleado
      const empleadoFields: string[] = [];
      const empleadoValues: any[] = [];
      let eIndex = 1;

      const camposEmpleado = {
        puesto: dto.puesto,
        salario: dto.salario,
        fechaIngreso: dto.fechaIngreso,
        activo: dto.activo,
      };

      for (const [key, value] of Object.entries(camposEmpleado)) {
        if (value !== undefined) {
          empleadoFields.push(`"${key}" = $${eIndex++}`);
          empleadoValues.push(value);
        }
      }

      let empleadoActualizado = empleadoExistente;
      if (empleadoFields.length > 0) {
        empleadoValues.push(personaId);
        const updateEmpleadoQuery = `
          UPDATE "Empleado" SET ${empleadoFields.join(', ')} 
          WHERE "personaId" = $${eIndex} 
          RETURNING *;
        `;
        const eRes = await client.query(updateEmpleadoQuery, empleadoValues);
        empleadoActualizado = eRes.rows[0];
      }

      // 5. Actualizar Usuario si existe
      const userCheck = await client.query('SELECT * FROM "User" WHERE "personaId" = $1', [personaId]);
      let usuarioActualizado = null;

      if (userCheck.rows.length > 0) {
        const usuarioExistente = userCheck.rows[0];
        let passwordHashed = usuarioExistente.password;

        if (dto.password) {
          passwordHashed = await bcrypt.hash(dto.password, 10);
        }

        const userUpdateQuery = `
          UPDATE "User" 
          SET correo = $1, password = $2, rol = $3, activo = $4 
          WHERE id = $5 
          RETURNING *;
        `;
        const userValues = [
          dto.correo ?? usuarioExistente.correo,
          passwordHashed,
          dto.rol ?? usuarioExistente.rol,
          dto.usuarioActivo ?? usuarioExistente.activo,
          usuarioExistente.id,
        ];
        const uRes = await client.query(userUpdateQuery, userValues);
        usuarioActualizado = uRes.rows[0];
      }

      await client.query('COMMIT');
      return {
        persona: personaActualizada,
        empleado: empleadoActualizado,
        usuario: usuarioActualizado,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}