import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PoolClient } from 'pg';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/datebaseService.service';
import { AuthPayloadDto } from './dto/auth.dto';
import { SignupDto } from './dto/signup.dto';

/**
 * Conversión de Prisma a SQL puro (pg) usando el schema real de base.sql.
 * Tablas relevantes (comillas dobles obligatorias por PascalCase/camelCase):
 *
 *   "Persona"(id, nombre, apellido, dni, telefono, direccion, "fechaNac", "createdAt", "updatedAt")
 *   "User"(id, correo, password, rol, activo, verificado, "personaId",
 *          "createdAt", "updatedAt", "passwordTemporalExpira",
 *          "requierCambioPassword", "passwordTemporal")
 *   "Empleado"(id, "personaId", puesto, salario, "fechaIngreso", activo)
 *   "Expediente"(id, "pacienteId" [unique], alergias, enfermedades, medicamentos, observaciones, activo, "createdAt", "updatedAt")
 *   "Logs"(id, "empleadoId", login, logout)
 *
 * "updatedAt" no tiene default -> se asigna a mano con CURRENT_TIMESTAMP.
 */

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();

const MAX_ATTEMPTS = 3;
const BLOCK_TIME_MS = 30_000;

/**
 * Tipos de retorno explícitos para validateUser/validateGoogleUser.
 * Al declarar el tipo de retorno del método como `Promise<AuthResult>`,
 * TypeScript puede hacer "narrowing" automático: después de comprobar
 * `if (result.code === 0)`, sabe que result es AuthSuccess y que `token`
 * existe, sin necesidad de castear el tipo manualmente en el controller.
 */
interface AuthSuccess {
  message: string;
  code: 0;
  token: string;
  user: any;
}

interface AuthError {
  message: string;
  code: 11 | 13 | 25 | 99 | 500; // códigos de error reales que devuelve validateUser
  retryAfter?: number;
}

type AuthResult = AuthSuccess | AuthError;

/**
 * Tipo de retorno explícito para signupUser.
 * OJO: en este service el código de éxito es 10, no 0.
 */
interface SignupSuccess {
  message: string;
  code: 10;
  user: any;
  expediente: any;
}

interface SignupError {
  message: string;
  code: 9 | 12 | 13 | 500; // códigos de error reales que devuelve signupUser
}

type SignupResult = SignupSuccess | SignupError;

@Injectable()
export class AuthService {
  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
  ) {}

  async validateUser(authPayload: AuthPayloadDto, isSocial = false): Promise<AuthResult> {
    try {
      const { correo, password } = authPayload;

      if (!loginAttempts.has(correo)) {
        loginAttempts.set(correo, { count: 0, lastAttempt: 0 });
      }

      const attempt = loginAttempts.get(correo)!;
      const now = Date.now();

      if (
        attempt.count >= MAX_ATTEMPTS &&
        now - attempt.lastAttempt < BLOCK_TIME_MS
      ) {
        const retryAfter = Math.ceil(
          (BLOCK_TIME_MS - (now - attempt.lastAttempt)) / 1000,
        );

        return {
          message: `Demasiados intentos fallidos. Intente de nuevo en ${retryAfter} segundos.`,
          code: 99,
          retryAfter,
        };
      }

      // Buscar el usuario por correo (con datos de Persona incluidos vía JOIN)
      const userResult = await this.db.pool.query(
        `
        SELECT
          u.*,
          json_build_object(
            'id', p.id,
            'nombre', p.nombre,
            'apellido', p.apellido,
            'dni', p.dni,
            'telefono', p.telefono,
            'direccion', p.direccion
          ) AS persona
        FROM "User" u
        JOIN "Persona" p ON p.id = u."personaId"
        WHERE u.correo = $1
        LIMIT 1
        `,
        [correo],
      );

      if (userResult.rows.length === 0) {
        attempt.count++;
        attempt.lastAttempt = now;
        return { message: 'Credenciales Invalidas', code: 11 };
      }

      const findUser = userResult.rows[0];

      let passwordMatch = false;
      let esPasswordTemporal = false;

      if (!isSocial) {
        if (findUser.password) {
          passwordMatch = await bcrypt.compare(password, findUser.password);
        }

        if (findUser.passwordTemporal) {
          console.log('Password recibido:', `"${password}"`);
          console.log('Hash temporal:', findUser.passwordTemporal);
          esPasswordTemporal = await bcrypt.compare(
            password,
            findUser.passwordTemporal,
          );
        }

        if (!passwordMatch && !esPasswordTemporal) {
          attempt.count++;
          attempt.lastAttempt = now;
          return { message: 'Credenciales Invalidas', code: 13 };
        }
      }

      loginAttempts.set(correo, { count: 0, lastAttempt: 0 });

      if (esPasswordTemporal) {
        if (
          findUser.passwordTemporalExpira &&
          new Date(findUser.passwordTemporalExpira) < new Date()
        ) {
          return {
            message:
              'La contraseña temporal ha expirado. Contacte al administrador.',
            code: 25,
          };
        }
      }

      // Verificar si es un empleado
      const empleadoResult = await this.db.pool.query(
        `SELECT id FROM "Empleado" WHERE "personaId" = $1 LIMIT 1`,
        [findUser.personaId],
      );
      const empleado = empleadoResult.rows[0] ?? null;

      // Quitar el password del objeto antes de devolverlo
      const { password: _pw, passwordTemporal: _pt, ...user } = findUser;

      if (empleado) {
        user.empleadoId = empleado.id;
        await this.db.pool.query(
          `
          INSERT INTO "Logs" ("empleadoId", login, logout)
          VALUES ($1, CURRENT_TIMESTAMP, NULL)
          `,
          [empleado.id],
        );
      }

      const token = this.jwtService.sign({
        id: user.id,
        correo: user.correo,
        rol: user.rol,
      });

      return { message: 'Autenticación exitosa', code: 0, token, user };
    } catch (error) {
      console.error('Error al validar usuario:', error);
      return { message: 'Error interno del servidor', code: 500 };
    }
  }

  async signupUser(signupDto: SignupDto, isSocial = false): Promise<SignupResult> {
    const {
      nombre,
      apellido,
      dni,
      telefono,
      direccion,
      fechaNac,
      correo,
      password,
    } = signupDto;

    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // Validar correo
      const emailExists = await client.query(
        `SELECT id FROM "User" WHERE correo = $1 LIMIT 1`,
        [correo],
      );
      if (emailExists.rows.length > 0) {
        await client.query('ROLLBACK');
        return { message: 'El correo ya está registrado', code: 12 };
      }

      let hashedPassword: string | null = null;

      if (!isSocial) {
        if (!password) {
          await client.query('ROLLBACK');
          return { message: 'La contraseña es requerida.', code: 13 };
        }

        hashedPassword = await bcrypt.hash(password, 10);

        if (dni) {
          const dniExists = await client.query(
            `SELECT id FROM "Persona" WHERE dni = $1 LIMIT 1`,
            [dni],
          );
          if (dniExists.rows.length > 0) {
            await client.query('ROLLBACK');
            return { message: 'El DNI ya existe', code: 9 };
          }
        }
      }

      // Crear persona
      const personaInsert = await client.query(
        `
        INSERT INTO "Persona" (nombre, apellido, dni, telefono, direccion, "fechaNac", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING *
        `,
        [
          nombre,
          apellido,
          dni || null,
          telefono || null,
          direccion || null,
          fechaNac ? new Date(fechaNac) : null,
        ],
      );
      const newPersona = personaInsert.rows[0];

      // Crear usuario
      const userInsert = await client.query(
        `
        INSERT INTO "User" (correo, password, "personaId", "updatedAt")
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING *
        `,
        [correo, hashedPassword || '', newPersona.id],
      );
      const newUser = userInsert.rows[0];

      // Crear expediente
      const expedienteInsert = await client.query(
        `
        INSERT INTO "Expediente"
          ("pacienteId", alergias, enfermedades, medicamentos, observaciones, activo, "updatedAt")
        VALUES ($1, NULL, NULL, NULL, NULL, true, CURRENT_TIMESTAMP)
        RETURNING *
        `,
        [newPersona.id],
      );
      const newExpediente = expedienteInsert.rows[0];

      await client.query('COMMIT');

      return {
        message: 'Usuario registrado con éxito',
        code: 10,
        user: newUser,
        expediente: newExpediente,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en signupUser:', error);
      return { message: 'Error interno del servidor', code: 500 };
    } finally {
      client.release();
    }
  }

  async validateGoogleUser(googleUser: SignupDto): Promise<AuthResult | SignupResult> {
    try {
      const existingUser = await this.db.pool.query(
        `SELECT correo FROM "User" WHERE correo = $1 LIMIT 1`,
        [googleUser.correo],
      );

      if (existingUser.rows.length > 0) {
        return await this.validateUser(
          { correo: existingUser.rows[0].correo, password: '' },
          true,
        );
      }

      const signupPayload: SignupDto = {
        correo: googleUser.correo,
        nombre: googleUser.nombre || '',
        apellido: googleUser.apellido || '',
      };

      const signupResult = await this.signupUser(signupPayload, true);

      if (signupResult.code !== 10 || !signupResult.user) {
        return signupResult;
      }

      const newUser = signupResult.user;

      return await this.validateUser(
        { correo: newUser.correo, password: '' },
        true,
      );
    } catch (error) {
      console.error('Error en validateGoogleUser:', error);
      return { message: 'Error interno del servidor', code: 500 };
    }
  }
}