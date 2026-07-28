import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateEmpleadoDto } from './dtoempleado/create-empleado.dto';
import { UpdateEmpleadoDto } from './dtoempleado/update-empleado.dto';
import * as bcrypt from 'bcrypt';
import {
  normalizarNombre,
  normalizarNombreParcial,
  nombreSql,
  apellidoSql,
} from '../common/nombres';
import {
  normalizarDni,
  normalizarRtn,
  normalizarTelefono,
  textoOpcional,
} from '../common/formatos';

@Injectable()
export class EmpleadoService {
  constructor(private db: DatabaseService) {}

  /**
   * Traduce el nombre de un rol ('DOCTOR') a su id en la tabla "Rol".
   *
   * Desde la migracion 003 el rol dejo de ser un ENUM y paso a ser una tabla
   * catalogo, para poder administrarlo sin un ALTER TYPE. La API sigue
   * hablando en nombres, que es lo que manda el frontend.
   */
  private async idDeRol(client: any, nombre: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT id FROM "Rol" WHERE UPPER(nombre) = UPPER($1) LIMIT 1`,
      [nombre],
    );
    if (rows.length === 0) {
      throw new BadRequestException(`El rol "${nombre}" no existe.`);
    }
    return rows[0].id as number;
  }

  /** Igual que idDeRol pero para la tabla "Puesto". */
  private async idDePuesto(client: any, nombre: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT id FROM "Puesto" WHERE UPPER(nombre) = UPPER($1) LIMIT 1`,
      [nombre],
    );
    if (rows.length === 0) {
      throw new BadRequestException(`El puesto "${nombre}" no existe.`);
    }
    return rows[0].id as number;
  }

  async createEmpleado(dto: CreateEmpleadoDto) {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      const partes = normalizarNombre(dto);
      if (!partes.primerNombre || !partes.primerApellido) {
        throw new BadRequestException(
          'El primer nombre y el primer apellido son obligatorios.',
        );
      }

      const dniLimpio = normalizarDni(dto.dni);

      // 1. Validar que el DNI no exista
      const dniCheck = await client.query('SELECT id FROM "Persona" WHERE dni = $1', [dniLimpio]);
      if (dniCheck.rows.length > 0) {
        throw new BadRequestException(`El DNI ${dto.dni} ya está registrado.`);
      }

      // 2. Validar que el correo no exista
      const correoCheck = await client.query(
        'SELECT id FROM "User" WHERE LOWER(correo) = LOWER($1)',
        [dto.correo],
      );
      if (correoCheck.rows.length > 0) {
        throw new BadRequestException(`El correo ${dto.correo} ya está registrado.`);
      }

      // 3. Crear la persona, con los cuatro campos de nombre
      const personaQuery = `
        INSERT INTO "Persona"
          ("primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
           dni, rtn, telefono, direccion, "fechaNac")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
      `;
      const personaValues = [
        partes.primerNombre,
        partes.segundoNombre,
        partes.primerApellido,
        partes.segundoApellido,
        dniLimpio,
        normalizarRtn(dto.rtn),
        normalizarTelefono(dto.telefono),
        textoOpcional(dto.direccion),
        dto.fechaNac,
      ];
      const personaResult = await client.query(personaQuery, personaValues);
      const newpersona = personaResult.rows[0];

      // 4. Crear el empleado. "puesto" ahora es "puestoId" contra el catalogo.
      const puestoId = await this.idDePuesto(client, dto.puesto);
      const empleadoQuery = `
        INSERT INTO "Empleado" ("personaId", "puestoId", salario, "fechaIngreso", activo)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
      const empleadoValues = [newpersona.id, puestoId, dto.salario, dto.fechaIngreso, dto.activo ?? true];
      const empleadoResult = await client.query(empleadoQuery, empleadoValues);
      const empleado = empleadoResult.rows[0];

      // 5. Crear el usuario vinculado. "rol" ahora es "rolId".
      const rolId = await this.idDeRol(client, dto.rol);
      const hashedPassword = await bcrypt.hash(dto.password, 10);
      const usuarioQuery = `
        INSERT INTO "User" (correo, password, "rolId", activo, "personaId")
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, correo, "rolId", activo, verificado, "personaId",
                  "createdAt", "updatedAt";
      `;
      const usuarioValues = [dto.correo, hashedPassword, rolId, dto.usuarioActivo ?? true, newpersona.id];
      const usuarioResult = await client.query(usuarioQuery, usuarioValues);
      const usuario = { ...usuarioResult.rows[0], rol: dto.rol.toUpperCase() };

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
        // La columna se llama "empleadoId" desde la migracion 004: apunta a
        // "Empleado", no a una tabla "Doctor" que nunca existio.
        await client.query(
          `INSERT INTO "EspecialidadDoctor" ("empleadoId", "especialidadId")
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
        pu.nombre AS puesto,
        e."puestoId",
        e.salario,
        e."fechaIngreso",
        e.activo,
        json_build_object(
          'id',              p.id,
          'primerNombre',    p."primerNombre",
          'segundoNombre',   p."segundoNombre",
          'primerApellido',  p."primerApellido",
          'segundoApellido', p."segundoApellido",
          'nombreCompleto',  p."nombreCompleto",
          'nombre',          ${nombreSql('p')},
          'apellido',        ${apellidoSql('p')},
          'dni',             p.dni,
          'rtn',             p.rtn,
          'telefono',        p.telefono,
          'direccion',       p.direccion,
          'fechaNac',        p."fechaNac",
          'createdAt',       p."createdAt",
          'updatedAt',       p."updatedAt",
          'user',            json_build_object(
                                'correo', COALESCE(u.correo, ''),
                                'activo', COALESCE(u.activo, false),
                                'rol',    r.nombre
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
      JOIN "Puesto" pu ON pu.id = e."puestoId"
      LEFT JOIN "User" u ON u."personaId" = p.id
      LEFT JOIN "Rol"  r ON r.id = u."rolId"
      LEFT JOIN "EspecialidadDoctor" ed ON ed."empleadoId" = e.id
      LEFT JOIN "Especialidad" esp ON esp.id = ed."especialidadId"
      GROUP BY e.id, e."personaId", pu.nombre, e."puestoId", e.salario,
               e."fechaIngreso", e.activo, p.id, u.correo, u.activo, r.nombre
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

      const dniLimpio = dto.dni !== undefined ? normalizarDni(dto.dni) : undefined;

      // 2. Validar DNI si viene en el DTO
      if (dniLimpio) {
        const dniCheck = await client.query('SELECT id, dni FROM "Persona" WHERE dni = $1', [dniLimpio]);
        if (dniCheck.rows.length > 0 && dniCheck.rows[0].id !== personaId) {
          throw new BadRequestException(`El DNI ${dto.dni} ya está registrado.`);
        }
      }

      // 3. Actualizar Persona
      const personaFields: string[] = [];
      const personaValues: any[] = [];
      let pIndex = 1;

      /*
       * Solo se tocan las columnas que el cliente mando de verdad. La lista
       * es explicita a proposito: no se arma con las claves del DTO, para que
       * nadie pueda escribir en una columna que no corresponda.
       *
       * "nombreCompleto" NO esta: es una columna generada, la calcula
       * PostgreSQL a partir de las otras cuatro. Incluirla daria error.
       */
      const camposPersona: Record<string, unknown> = {
        ...normalizarNombreParcial(dto),
        dni: dniLimpio,
        rtn: dto.rtn !== undefined ? normalizarRtn(dto.rtn) : undefined,
        telefono:
          dto.telefono !== undefined ? normalizarTelefono(dto.telefono) : undefined,
        direccion:
          dto.direccion !== undefined ? textoOpcional(dto.direccion) : undefined,
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
          UPDATE "Persona" SET ${personaFields.join(', ')}
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

      const camposEmpleado: Record<string, unknown> = {
        puestoId:
          dto.puesto !== undefined
            ? await this.idDePuesto(client, dto.puesto)
            : undefined,
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

        const rolId =
          dto.rol !== undefined
            ? await this.idDeRol(client, dto.rol)
            : usuarioExistente.rolId;

        const userUpdateQuery = `
          UPDATE "User"
          SET correo = $1, password = $2, "rolId" = $3, activo = $4
          WHERE id = $5
          RETURNING id, correo, "rolId", activo, verificado, "personaId",
                    "createdAt", "updatedAt";
        `;
        const userValues = [
          dto.correo ?? usuarioExistente.correo,
          passwordHashed,
          rolId,
          dto.usuarioActivo ?? usuarioExistente.activo,
          usuarioExistente.id,
        ];
        const uRes = await client.query(userUpdateQuery, userValues);

        // Se devuelve el rol como texto, igual que antes de la migracion 003.
        const rolNombre = await client.query(
          `SELECT nombre FROM "Rol" WHERE id = $1`,
          [rolId],
        );
        usuarioActualizado = {
          ...uRes.rows[0],
          rol: rolNombre.rows[0]?.nombre ?? null,
        };
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