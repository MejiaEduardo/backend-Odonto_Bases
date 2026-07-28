import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../Auth/auth.service';
import { DatabaseService } from '../database/datebaseService.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();

const mockDb = {
  pool: {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    }),
  },
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mocked-jwt-token'),
};

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
    mockDb.pool.connect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  // -------------------------------
  // validateUser()
  // -------------------------------
  describe('validateUser', () => {
    const bcryptCompare = bcrypt.compare as jest.Mock;

    const mockUser = {
      id: 1,
      correo: 'test@example.com',
      password: 'hashed123',
      rol: 'CLIENTE',
      rolId: 4,
      personaId: 5,
      persona: {
        id: 5,
        primerNombre: 'Test',
        segundoNombre: null,
        primerApellido: 'User',
        segundoApellido: null,
        nombreCompleto: 'Test User',
        nombre: 'Test',
        apellido: 'User',
      },
    };

    it('debería retornar código 11 si el usuario no existe', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.validateUser({
        correo: 'noexiste@example.com',
        password: '1234',
      });

      expect(result).toEqual({ message: 'Credenciales Invalidas', code: 11 });
    });

    it('debería retornar código 13 si la contraseña no coincide', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [mockUser] });
      bcryptCompare.mockResolvedValue(false);

      const result = await service.validateUser({
        correo: 'test2@example.com',
        password: 'wrongpass',
      });

      expect(result).toEqual({ message: 'Credenciales Invalidas', code: 13 });
    });

    it('debería retornar token y datos de usuario si todo es correcto', async () => {
      // 1: buscar usuario, 2: buscar empleado (no es empleado),
      // 3: buscar si es paciente (tabla "Paciente", migracion 005)
      mockQuery
        .mockResolvedValueOnce({ rows: [mockUser] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 9 }] });
      bcryptCompare.mockResolvedValue(true);

      const result = await service.validateUser({
        correo: 'test3@example.com',
        password: 'hashed123',
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        id: mockUser.id,
        correo: mockUser.correo,
        rol: mockUser.rol,
      });

      expect(result.code).toBe(0);
      expect((result as any).token).toBe('mocked-jwt-token');
      expect((result as any).user.password).toBeUndefined();
    });

    it('debería registrar en Logs si el usuario es empleado', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [mockUser] })   // usuario
        .mockResolvedValueOnce({ rows: [{ id: 77 }] }) // es empleado
        .mockResolvedValueOnce({ rows: [] })           // INSERT en Logs
        .mockResolvedValueOnce({ rows: [] });          // no es paciente
      bcryptCompare.mockResolvedValue(true);

      const result = await service.validateUser({
        correo: 'empleado@example.com',
        password: 'hashed123',
      });

      expect((result as any).user.empleadoId).toBe(77);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"Logs"'),
        [77],
      );
    });

    it('debería bloquear tras 3 intentos fallidos', async () => {
      const correo = 'bloqueo@example.com';
      mockQuery.mockResolvedValue({ rows: [] });

      await service.validateUser({ correo, password: 'x' });
      await service.validateUser({ correo, password: 'x' });
      await service.validateUser({ correo, password: 'x' });

      const result = await service.validateUser({ correo, password: 'x' });

      expect(result.code).toBe(99);
      expect((result as any).retryAfter).toBeGreaterThan(0);
    });

    it('debería manejar errores internos', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const result = await service.validateUser({
        correo: 'error@example.com',
        password: '1234',
      });

      expect(result.code).toBe(500);
    });
  });

  // -------------------------------
  // signupUser()
  // -------------------------------
  describe('signupUser', () => {
    const bcryptHash = bcrypt.hash as jest.Mock;

    const signupDto = {
      primerNombre: 'Juan',
      segundoNombre: 'Carlos',
      primerApellido: 'Perez',
      segundoApellido: 'Lopez',
      dni: '0801-2000-00001',
      telefono: '99999999',
      direccion: 'Col. Miraflores',
      fechaNac: new Date('1990-01-01'),
      correo: 'nuevo@example.com',
      password: '12345678',
    } as any;

    it('debería retornar código 12 si el correo ya está registrado', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // correo existe
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.signupUser(signupDto);

      expect(result).toEqual({
        message: 'El correo ya está registrado',
        code: 12,
      });
      expect(mockRelease).toHaveBeenCalled();
    });

    it('debería retornar código 9 si el DNI ya existe', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // correo libre
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // dni existe
        .mockResolvedValueOnce({}); // ROLLBACK
      bcryptHash.mockResolvedValue('hashedPass');

      const result = await service.signupUser(signupDto);

      expect(result).toEqual({ message: 'El DNI ya existe', code: 9 });
    });

    it('debería retornar código 13 si no se envía contraseña', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // correo libre
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.signupUser({
        ...signupDto,
        password: undefined,
      });

      expect(result).toEqual({
        message: 'La contraseña es requerida.',
        code: 13,
      });
    });

    it('debería crear persona, usuario y expediente correctamente', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // correo libre
        .mockResolvedValueOnce({ rows: [] }) // dni libre
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // Persona
        .mockResolvedValueOnce({ rows: [{ id: 1, correo: signupDto.correo }] }) // User
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // Paciente (migracion 005)
        .mockResolvedValueOnce({ rows: [{ id: 3, pacienteId: 7 }] }) // Expediente
        .mockResolvedValueOnce({}); // COMMIT
      bcryptHash.mockResolvedValue('hashedPass');

      const result = await service.signupUser(signupDto);

      expect(result.code).toBe(10);
      expect(result.message).toBe('Usuario registrado con éxito');
      expect((result as any).user.id).toBe(1);
      expect((result as any).expediente.id).toBe(3);
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    });

    it('debería hacer ROLLBACK ante un error interno', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // correo libre
        .mockResolvedValueOnce({ rows: [] }) // dni libre
        .mockRejectedValueOnce(new Error('DB error')) // falla el insert
        .mockResolvedValueOnce({}); // ROLLBACK
      bcryptHash.mockResolvedValue('hashedPass');

      const result = await service.signupUser(signupDto);

      expect(result.code).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('debería registrar un usuario social sin password', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // correo libre
        .mockResolvedValueOnce({ rows: [] }) // dni libre
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // Persona
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // User
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // Paciente (migracion 005)
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // Expediente
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.signupUser(signupDto, true);

      expect(result.code).toBe(10);
      expect(bcryptHash).not.toHaveBeenCalled();
    });
  });

 // validateGoogleUser()
 
  describe('validateGoogleUser', () => {
    it('debería loguear al usuario si el correo ya existe', async () => {
      const correo = 'google-existente@example.com';

      mockQuery
        .mockResolvedValueOnce({ rows: [{ correo }] }) // existe
        .mockResolvedValueOnce({
          rows: [{ id: 1, correo, rol: 'CLIENTE', personaId: 5 }],
        }) // validateUser
        .mockResolvedValueOnce({ rows: [] })  // no es empleado
        .mockResolvedValueOnce({ rows: [] }); // no es paciente

      const result = await service.validateGoogleUser({ correo } as any);

      expect(result.code).toBe(0);
    });
  });
});