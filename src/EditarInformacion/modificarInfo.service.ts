
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


    //funcion interna modular 
  private async findUserByCriterion(criterion: SearchCriterion) {
    // Si el criterio es el correo, busca directamente en el modelo User.
    if (criterion.correo) {
      return this.db.pool.query(
        'SELECT * FROM "User" u JOIN "Persona" p ON u."personaId" = p.id WHERE u."correo" = $1',
        [criterion.correo]
      );
    }

  const query = `
      SELECT u.*, p.* 
      FROM "User" u 
      JOIN "Persona" p ON u."personaId" = p.id 
      WHERE p."dni" = $1 OR p."telefono" = $2
  `;
  const result = await this.db.pool.query(query, [criterion.dni, criterion.telefono]);
  return result.rows[0];
  
  /**
   * Método central que maneja la validación de rol y errores.
   * @param criterion El objeto con el valor de búsqueda (correo, dni, o telefono).
   * @param value El valor del criterio para mensajes de error.
   */
  }
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



}
}