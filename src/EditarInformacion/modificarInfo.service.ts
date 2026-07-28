
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';;
import { UpdateModificarInfoDto } from './dtoModificar/update.modificarInfo';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/datebaseService.service';
import { personaJson, normalizarNombreParcial } from '../common/nombres';
import {
  normalizarDni,
  normalizarRtn,
  normalizarTelefono,
  textoOpcional,
} from '../common/formatos';

type SearchCriterion = {
  correo?: string;
  dni?: string;
  telefono?: string;
};

@Injectable()
export class ModificarInfoService {
  constructor(private db: DatabaseService) {}


  /**
   * SELECT reutilizable que devuelve el usuario con su `persona` ANIDADA.
   *
   * Antes esto hacía `SELECT * FROM "User" u JOIN "Persona" p`, lo cual tenía
   * dos fallos:
   *
   *   1. Devolvía todo PLANO, pero el frontend lee `res.data.data.persona`
   *      (ver modificarInfoService.ts del front). Como `persona` no existía,
   *      lanzaba "Respuesta inválida del servidor" y el buscador de pacientes
   *      NUNCA encontraba a nadie, aunque el paciente sí estuviera en la BD.
   *
   *   2. "User" y "Persona" tienen ambas columnas `id`, `createdAt` y
   *      `updatedAt`. Con `u.*, p.*` las de Persona pisaban a las de User,
   *      así que el `id` que salía era el de la persona, no el del usuario.
   *
   * Ahora se seleccionan columnas explícitas y se arma `persona` con
   * json_build_object.
   */
  private readonly SELECT_CLIENTE = `
    SELECT
      u.id            AS "userId",
      u.correo,
      u.password      AS contrasena,
      r.nombre        AS rol,
      u."rolId",
      u.activo,
      u."personaId",
      ${personaJson('p')} AS persona
    FROM "User" u
    JOIN "Rol"     r ON r.id = u."rolId"
    JOIN "Persona" p ON p.id = u."personaId"
  `;

  //funcion interna modular
  private async findUserByCriterion(criterion: SearchCriterion) {
    // Búsqueda por correo: no distingue mayúsculas ni espacios sobrantes
    if (criterion.correo) {
      const result = await this.db.pool.query(
        `${this.SELECT_CLIENTE} WHERE LOWER(u.correo) = LOWER(TRIM($1))`,
        [criterion.correo],
      );
      return result.rows[0];
    }

    // Búsqueda por DNI o teléfono. Se compara ignorando guiones y espacios,
    // porque el usuario puede escribirlos de cualquier forma.
    const valor = (criterion.dni ?? criterion.telefono ?? '').replace(/[\s-]/g, '');
    const result = await this.db.pool.query(
      `${this.SELECT_CLIENTE}
       WHERE REPLACE(REPLACE(COALESCE(p.dni, ''), '-', ''), ' ', '') = $1
          OR REPLACE(REPLACE(COALESCE(p.telefono, ''), '-', ''), ' ', '') = $1`,
      [valor],
    );
    return result.rows[0];
  }

  /**
   * Método central que maneja la validación de rol y errores.
   * @param criterion El objeto con el valor de búsqueda (correo, dni, o telefono).
   * @param value El valor del criterio para mensajes de error.
   */
  private async validateAndReturnClient(criterion: SearchCriterion, value: string): Promise<any> {
    const user = await this.findUserByCriterion(criterion);

    const key = Object.keys(criterion)[0]; // Obtiene 'correo', 'dni' o 'telefono'

    // 1. Validar existencia
    if (!user) {
      throw new NotFoundException(
        `No existe un cliente registrado con el ${key}: ${value}`,
      );
    }

    // 2. Validar rol (solo clientes)
    if (user.rol !== 'CLIENTE') {
      throw new BadRequestException(
        `El usuario asociado al ${key} ${value} no tiene el rol de cliente.`,
      );
    }

    // Retornar el usuario con la data de la persona anidada
    return user;
  }

  // --------------------------------------------------------------------------
  // Métodos Públicos
  // --------------------------------------------------------------------------

  async buscarPorCorreo(correo: string) {
    return this.validateAndReturnClient({ correo }, correo);
  }

  async buscarPorDni(dni: string) {
    return this.validateAndReturnClient({ dni }, dni);
  }

  async buscarPorTelefono(telefono: string) {
    return this.validateAndReturnClient({ telefono }, telefono);
  }

  /**
   * Completa o corrige los datos de un cliente, buscandolo por su correo.
   *
   * Antes esto armaba el UPDATE con las claves del DTO tal cual llegaban, y
   * las metia en el SQL como nombres de columna. Eso tenia dos problemas:
   * dependia de que el nombre del campo coincidiera con el de la columna
   * (ya no coincide: `nombre` son ahora cuatro columnas), y ponia en manos
   * del cliente que columna se escribe. Ahora la lista es explicita.
   */
  async completarDatosPorCorreo(correo: string, data: UpdateModificarInfoDto) {
    // 1. Buscar el usuario por correo
    const result = await this.db.pool.query(
      `SELECT u.id AS "userId", u."personaId"
       FROM "User" u
       WHERE LOWER(u.correo) = LOWER(TRIM($1))`,
      [correo],
    );
    const user = result.rows[0];

    if (!user) {
      throw new BadRequestException('Usuario no encontrado.');
    }

    const telefono =
      data.telefono !== undefined ? normalizarTelefono(data.telefono) : undefined;
    const dni = data.dni !== undefined ? normalizarDni(data.dni) : undefined;
    const rtn = data.rtn !== undefined ? normalizarRtn(data.rtn) : undefined;

    // 2. Validar teléfono si viene
    if (telefono) {
      const telResult = await this.db.pool.query(
        'SELECT id FROM "Persona" WHERE telefono = $1 AND id != $2',
        [telefono, user.personaId],
      );
      if (telResult.rows.length > 0) {
        throw new BadRequestException('El teléfono ya está en uso por otro usuario.');
      }
    }

    // 3. Validar DNI si viene
    if (dni) {
      const dniResult = await this.db.pool.query(
        'SELECT id FROM "Persona" WHERE dni = $1 AND id != $2',
        [dni, user.personaId],
      );
      if (dniResult.rows.length > 0) {
        throw new BadRequestException('El DNI ya está en uso por otro usuario.');
      }
    }

    // 4. Validar RTN si viene
    if (rtn) {
      const rtnResult = await this.db.pool.query(
        'SELECT id FROM "Persona" WHERE rtn = $1 AND id != $2',
        [rtn, user.personaId],
      );
      if (rtnResult.rows.length > 0) {
        throw new BadRequestException('El RTN ya está en uso por otro usuario.');
      }
    }

    /*
     * 5. Columnas de "Persona" que se pueden tocar desde aca. Lista cerrada:
     * "nombreCompleto" no esta porque es una columna generada.
     */
    const camposPersona: Record<string, unknown> = {
      ...normalizarNombreParcial(data),
      dni,
      rtn,
      telefono,
      direccion: data.direccion !== undefined ? textoOpcional(data.direccion) : undefined,
      fechaNac: data.fechaNac,
    };

    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    for (const [columna, valor] of Object.entries(camposPersona)) {
      if (valor !== undefined) {
        asignaciones.push(`"${columna}" = $${valores.length + 1}`);
        valores.push(valor);
      }
    }

    if (asignaciones.length === 0 && !data.password) {
      throw new BadRequestException('No se enviaron datos para actualizar.');
    }

    if (asignaciones.length > 0) {
      valores.push(user.personaId);
      await this.db.pool.query(
        `UPDATE "Persona" SET ${asignaciones.join(', ')} WHERE id = $${valores.length}`,
        valores,
      );
    }

    // 6. La contraseña va en "User", no en "Persona"
    if (data.password) {
      const hash = await bcrypt.hash(data.password, 10);
      await this.db.pool.query('UPDATE "User" SET password = $1 WHERE id = $2', [
        hash,
        user.userId,
      ]);
    }

    return { message: 'Datos del cliente completados correctamente.' };
  }
}