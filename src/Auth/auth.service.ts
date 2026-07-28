import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PoolClient } from 'pg';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/datebaseService.service';
import { AuthPayloadDto } from './dto/auth.dto';
import { SignupDto } from './dto/signup.dto';
import { normalizarNombre, personaJson } from '../common/nombres';
import { buscarPacienteDesdePersona } from '../common/pacientes';
import {
  normalizarDni,
  normalizarRtn,
  normalizarTelefono,
  textoOpcional,
} from '../common/formatos';

/**
 * SQL puro (pg) sobre el esquema de las migraciones 003, 004 y 005.
 *
 *   "Persona"(id, "primerNombre", "segundoNombre", "primerApellido",
 *             "segundoApellido", "nombreCompleto" [generada], dni, rtn,
 *             telefono, direccion, "fechaNac", ...)
 *   "User"(id, correo, password, "rolId", activo, verificado, "personaId", ...)
 *   "Paciente"(id, "personaId" [unico], "fechaRegistro", activo, ...)
 *   "Empleado"(id, "personaId", "puestoId", salario, "fechaIngreso", activo, ...)
 *   "Expediente"(id, "pacienteId" [unico, apunta a "Paciente"], ...)
 *   "Logs"(id, "empleadoId", login, logout, ...)
 *
 * El rol ya no es un ENUM sino la tabla "Rol". La vista "vw_Usuario" lo
 * devuelve resuelto como texto, igual que antes, para no rehacer el JOIN en
 * cada consulta.
 *
 * "updatedAt" lo mantiene un trigger de la base: no hay que asignarlo a mano.
 */

/** rolId 4 = CLIENTE. Es el rol con el que se registra un paciente. */
const ROL_CLIENTE = 4;

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
export interface AuthSuccess {
  message: string;
  code: 0;
  token: string;
  user: any;
}
export interface AuthError {
  message: string;
  code: 11 | 13 | 25 | 99 | 500;
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

      // Buscar el usuario por correo (con datos de Persona incluidos vía JOIN).
      // El correo se compara sin distinguir mayusculas, igual que el indice
      // unico de la base.
      const userResult = await this.db.pool.query(
        `
        SELECT
          u.id, u.correo, u.password, u."rolId", u.activo, u.verificado,
          u."personaId", u."createdAt", u."updatedAt",
          r.nombre AS rol,
          ${personaJson('p')} AS persona
        FROM "User" u
        JOIN "Rol"     r ON r.id = u."rolId"
        JOIN "Persona" p ON p.id = u."personaId"
        WHERE LOWER(u.correo) = LOWER($1)
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

      /*
       * Antes habia aca un segundo camino de login contra un campo
       * "passwordTemporal" de "User". Esas tres columnas
       * (passwordTemporal, passwordTemporalExpira, requierCambioPassword)
       * no existen en la base, asi que el bloque nunca hacia nada.
       *
       * El ingeniero pidio justamente que la temporalidad NO viva en "User":
       * para eso esta la tabla "TokenAcceso", que guarda un link con su fecha
       * de expiracion. Queda pendiente conectar ese flujo.
       */
      let passwordMatch = false;

      if (!isSocial) {
        if (findUser.password) {
          passwordMatch = await bcrypt.compare(password, findUser.password);
        }

        if (!passwordMatch) {
          attempt.count++;
          attempt.lastAttempt = now;
          return { message: 'Credenciales Invalidas', code: 13 };
        }
      }

      loginAttempts.set(correo, { count: 0, lastAttempt: 0 });

      // Verificar si es un empleado
      const empleadoResult = await this.db.pool.query(
        `SELECT id FROM "Empleado" WHERE "personaId" = $1 LIMIT 1`,
        [findUser.personaId],
      );
      const empleado = empleadoResult.rows[0] ?? null;

      // Quitar el password del objeto antes de devolverlo
      const { password: _pw, ...user } = findUser;

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

      // Si ademas es paciente, se manda su id de "Paciente".
      user.pacienteId = await buscarPacienteDesdePersona(
        this.db.pool,
        findUser.personaId,
      );

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
    const { dni, rtn, telefono, direccion, fechaNac, correo, password } =
      signupDto;

    /*
     * Los cuatro campos de nombre. El segundo nombre y el segundo apellido
     * son opcionales; si el cliente todavia manda `nombre` y `apellido`
     * (por ejemplo el alta con Google), se parten aca.
     */
    const partes = normalizarNombre(signupDto);

    if (!partes.primerNombre || !partes.primerApellido) {
      return {
        message: 'El primer nombre y el primer apellido son obligatorios',
        code: 13,
      };
    }

    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // Validar correo (sin distinguir mayusculas, igual que el indice unico)
      const emailExists = await client.query(
        `SELECT id FROM "User" WHERE LOWER(correo) = LOWER($1) LIMIT 1`,
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
      }

      /*
       * Comprobacion de DNI repetido.
       *
       * Antes estaba DENTRO del `if (!isSocial)`, asi que el alta con
       * Google la saltaba entera y creaba una Persona nueva aunque ese
       * DNI ya estuviera registrado. Ahora corre siempre.
       *
       * Se compara sin espacios sobrantes: '0801-1990-00123 ' y
       * '0801-1990-00123' son la misma identidad, y guardados tal cual
       * el indice unico los trataria como distintos.
       */
      // La base exige 13 digitos sin guiones, asi que se limpian aca en vez de
      // dejar que el CHECK devuelva un error incomprensible.
      const dniLimpio = normalizarDni(dni);

      if (dniLimpio) {
        const dniExists = await client.query(
          `SELECT id FROM "Persona" WHERE dni = $1 LIMIT 1`,
          [dniLimpio],
        );
        if (dniExists.rows.length > 0) {
          await client.query('ROLLBACK');
          return { message: 'El DNI ya existe', code: 9 };
        }
      }

      // Crear persona con los cuatro campos de nombre
      const personaInsert = await client.query(
        `
        INSERT INTO "Persona"
          ("primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
           dni, rtn, telefono, direccion, "fechaNac")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          partes.primerNombre,
          partes.segundoNombre,
          partes.primerApellido,
          partes.segundoApellido,
          dniLimpio,
          normalizarRtn(rtn),
          normalizarTelefono(telefono),
          textoOpcional(direccion),
          fechaNac ? new Date(fechaNac) : null,
        ],
      );
      const newPersona = personaInsert.rows[0];

      // Crear usuario. El rol ya no es un ENUM: es "rolId" contra la tabla "Rol".
      const userInsert = await client.query(
        `
        INSERT INTO "User" (correo, password, "rolId", "personaId")
        VALUES ($1, $2, $3, $4)
        RETURNING id, correo, "rolId", activo, verificado, "personaId",
                  "createdAt", "updatedAt"
        `,
        [correo, hashedPassword || '', ROL_CLIENTE, newPersona.id],
      );
      const newUser = userInsert.rows[0];

      /*
       * Registrar a la persona como PACIENTE.
       *
       * Desde la migracion 005 "Cita", "Factura" y "Expediente" apuntan a
       * "Paciente", no a "Persona". Sin esta fila el usuario podria entrar
       * pero no podria agendar ninguna cita.
       */
      const pacienteInsert = await client.query(
        `INSERT INTO "Paciente" ("personaId") VALUES ($1) RETURNING id`,
        [newPersona.id],
      );
      const pacienteId = pacienteInsert.rows[0].id;

      // Crear expediente, ya apuntando al Paciente
      const expedienteInsert = await client.query(
        `
        INSERT INTO "Expediente"
          ("pacienteId", alergias, enfermedades, medicamentos, observaciones, activo)
        VALUES ($1, NULL, NULL, NULL, NULL, true)
        RETURNING *
        `,
        [pacienteId],
      );
      const newExpediente = expedienteInsert.rows[0];

      await client.query('COMMIT');

      return {
        message: 'Usuario registrado con éxito',
        code: 10,
        user: { ...newUser, rol: 'CLIENTE', pacienteId },
        expediente: newExpediente,
      };
    } catch (error) {
      await client.query('ROLLBACK');

      /*
       * 23505 = unique_violation. Salta cuando el indice unico de la base
       * atrapa un duplicado que la comprobacion previa no vio, por ejemplo
       * si dos registros llegan a la vez. Sin este bloque, el usuario
       * recibiria un 500 generico en lugar de saber que el dato ya existe.
       */
      const pgError = error as { code?: string; constraint?: string };
      if (pgError?.code === '23505') {
        if (pgError.constraint === 'Persona_dni_key') {
          return { message: 'El DNI ya existe', code: 9 };
        }
        if (pgError.constraint === 'User_correo_key') {
          return { message: 'El correo ya está registrado', code: 12 };
        }
      }

      console.error('Error en signupUser:', error);
      return { message: 'Error interno del servidor', code: 500 };
    } finally {
      client.release();
    }
  }

  /**
   * Devuelve el usuario dueño de un token ya validado.
   *
   * Lo usa GET /auth/me. Hace falta porque el callback de Google solo
   * puede mandar el token en la URL: el objeto completo del usuario no
   * cabe ahi de forma razonable, asi que el frontend lo pide aparte.
   *
   * Nunca devuelve los hashes de contraseña.
   */
  async obtenerPerfil(correo: string): Promise<AuthResult> {
    try {
      const { rows } = await this.db.pool.query(
        `
        SELECT
          u.id, u.correo, u."rolId", u.activo, u.verificado, u."personaId",
          u."createdAt", u."updatedAt",
          r.nombre AS rol,
          ${personaJson('p')} AS persona
        FROM "User" u
        JOIN "Rol"     r ON r.id = u."rolId"
        JOIN "Persona" p ON p.id = u."personaId"
        WHERE LOWER(u.correo) = LOWER($1)
        LIMIT 1
        `,
        [correo],
      );

      if (rows.length === 0) {
        return { message: 'Credenciales Invalidas', code: 11 };
      }

      const user = rows[0];

      /*
       * Mismo agregado que hace validateUser. Sin esto, quien entre por
       * Google siendo empleado tendria empleadoId indefinido, y el
       * frontend (useAuth -> idEmpleado) leeria 0: no podria firmar
       * consultas ni ver sus expedientes.
       */
      const empleado = await this.db.pool.query(
        `SELECT id FROM "Empleado" WHERE "personaId" = $1 LIMIT 1`,
        [user.personaId],
      );
      if (empleado.rows[0]) {
        user.empleadoId = empleado.rows[0].id;
      }

      user.pacienteId = await buscarPacienteDesdePersona(
        this.db.pool,
        user.personaId,
      );

      return { message: 'Perfil obtenido', code: 0, token: '', user };
    } catch (error) {
      console.error('Error al obtener el perfil:', error);
      return { message: 'Error interno del servidor', code: 500 };
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