
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';;
import { UpdateModificarInfoDto } from './dtoModificar/update.modificarInfo';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/datebaseService.service';

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
      u.rol,
      u.activo,
      u."personaId",
      json_build_object(
        'id',        p.id,
        'nombre',    p.nombre,
        'apellido',  p.apellido,
        'dni',       p.dni,
        'telefono',  p.telefono,
        'direccion', p.direccion,
        'fechaNac',  p."fechaNac"
      ) AS persona
    FROM "User" u
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

    async completarDatosPorCorreo(correo: string, data: UpdateModificarInfoDto) {

  // 1️ Buscar persona por correo
  const result = await this.db.pool.query(
    'SELECT u.*, p.* FROM "User" u JOIN "Persona" p ON u."personaId" = p.id WHERE u."correo" = $1',
    [correo]
  );
  const user = result.rows[0];

  if (!user) {
      throw new BadRequestException("Usuario no encontrado.");
  }

  if (!user) {
    throw new BadRequestException("Usuario no encontrado.");
  }

  // 2️ Filtrar campos válidos (solo los que vienen con valor)
  const camposValidos = Object.fromEntries(
    Object.entries(data).filter(
      ([_, value]) => value !== null && value !== '' && value !== undefined,
    ),
  );

  if (Object.keys(camposValidos).length === 0) {
    throw new BadRequestException('No se enviaron datos para actualizar.');
  }

  // 3️ Validar teléfono si viene
  if (camposValidos.telefono) {
    const telResult = await this.db.pool.query(
        'SELECT id FROM "Persona" WHERE "telefono" = $1 AND id != $2',
        [camposValidos.telefono, user.personaId] // o user.id dependiendo de cómo se llame la columna de la persona
    );
    
    if (telResult.rows.length > 0) {
        throw new BadRequestException('El teléfono ya está en uso por otro usuario.');
    }
}

  // 4️ Validar DNI si viene
  if (camposValidos.dni) {
    const dniResult = await this.db.pool.query(
        'SELECT id FROM "Persona" WHERE "dni" = $1 AND id != $2',
        [camposValidos.dni, user.personaId]
    );
    if (dniResult.rows.length > 0) {
        throw new BadRequestException('El DNI ya está en uso por otro usuario.');
    }
}

  // 5️ Manejar password por separado
  let { password, ...restoDeCamposPersona } = camposValidos;

  if (password) {
    password = await bcrypt.hash(password, 10);
  }

  // 6️ Actualizar

const camposPersonaKeys = Object.keys(restoDeCamposPersona);
if (camposPersonaKeys.length > 0) {
    // Construimos dinámicamente el update para Persona según lo que venga
    const setValues = camposPersonaKeys.map((key, index) => `"${key}" = $${index + 1}`).join(', ');
    const values = camposPersonaKeys.map(key => restoDeCamposPersona[key]);
    values.push(user.personaId); // El último parámetro es el ID de la persona

    await this.db.pool.query(
        `UPDATE "Persona" SET ${setValues} WHERE id = $${values.length}`,
        values
    );
}

// 2. Actualizar la contraseña en la tabla User si viene en la petición
if (password) {
    await this.db.pool.query(
        'UPDATE "User" SET "password" = $1 WHERE "correo" = $2',
        [password, correo]
    );
}


return { message: 'Datos del cliente completados correctamente.' };
}
}