import { Test, TestingModule } from '@nestjs/testing';
import { ModificarInfoService } from '../EditarInformacion/modificarInfo.service';
import { DatabaseService } from '../database/datebaseService.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hash_mock'),
}));

const mockQuery = jest.fn();

const mockDb = {
  pool: {
    query: mockQuery,
  },
};

describe('ModificarInfoService', () => {
  let service: ModificarInfoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModificarInfoService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ModificarInfoService>(ModificarInfoService);

    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hash_mock');
  });

  // --------------------------------------------------------------------
  // TEST 1: Usuario no existe
  // --------------------------------------------------------------------
  it('Debe lanzar NotFoundException si el usuario no existe', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      service.buscarPorCorreo('noexiste@mail.com'),
    ).rejects.toThrow(NotFoundException);
  });

  // --------------------------------------------------------------------
  // TEST 2: Usuario no es cliente
  // --------------------------------------------------------------------
  it('Debe lanzar BadRequestException si el usuario no es cliente', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ correo: 'empleado@mail.com', rol: 'RECEPCIONISTA' }],
    });

    await expect(
      service.buscarPorCorreo('empleado@mail.com'),
    ).rejects.toThrow(BadRequestException);
  });

  // --------------------------------------------------------------------
  // TEST 3: Retornar usuario valido si es cliente
  // --------------------------------------------------------------------
  it('Debe retornar el usuario si es cliente', async () => {
    const mockUser = {
      correo: 'cliente@mail.com',
      rol: 'CLIENTE',
      personaId: 5,
      nombre: 'Juan',
    };

    mockQuery.mockResolvedValueOnce({ rows: [mockUser] });

    const result = await service.buscarPorCorreo('cliente@mail.com');

    expect(result).toEqual(mockUser);
  });

  // --------------------------------------------------------------------
  // TEST 4: Buscar por DNI
  // --------------------------------------------------------------------
  it('Debe buscar por DNI correctamente', async () => {
    const mockUser = { dni: '1234', rol: 'CLIENTE', personaId: 5 };
    mockQuery.mockResolvedValueOnce({ rows: [mockUser] });

    const result = await service.buscarPorDni('1234');

    expect(result).toEqual(mockUser);
  });

  // --------------------------------------------------------------------
  // TEST 5: Buscar por telefono inexistente
  // --------------------------------------------------------------------
  it('Debe lanzar NotFoundException si el telefono no existe', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(service.buscarPorTelefono('9999')).rejects.toThrow(
      NotFoundException,
    );
  });

  // --------------------------------------------------------------------
  // TEST 6: No permite datos vacios
  // --------------------------------------------------------------------
  it('Debe lanzar BadRequestException si no se envian datos validos', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ correo: 'cliente@mail.com', rol: 'CLIENTE', personaId: 5 }],
    });

    await expect(
      service.completarDatosPorCorreo('cliente@mail.com', {} as any),
    ).rejects.toThrow(BadRequestException);
  });

  // --------------------------------------------------------------------
  // TEST 7: Usuario no encontrado al completar datos
  // --------------------------------------------------------------------
  it('Debe lanzar BadRequestException si el usuario no existe al completar datos', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      service.completarDatosPorCorreo('noexiste@mail.com', {
        nombre: 'Juan',
      } as any),
    ).rejects.toThrow('Usuario no encontrado.');
  });

  // --------------------------------------------------------------------
  // TEST 8: Actualiza persona correctamente sin password
  // --------------------------------------------------------------------
  it('Debe actualizar persona sin password', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ correo: 'cliente@mail.com', rol: 'CLIENTE', personaId: 5 }],
      }) // buscar usuario
      .mockResolvedValueOnce({ rows: [] }); // UPDATE Persona

    const result = await service.completarDatosPorCorreo('cliente@mail.com', {
      nombre: 'Juan',
    } as any);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "Persona"'),
      ['Juan', 5],
    );
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(result.message).toBe('Datos del cliente completados correctamente.');
  });

  // --------------------------------------------------------------------
  // TEST 9: Actualiza persona + password
  // --------------------------------------------------------------------
  it('Debe actualizar persona y password cuando se envia', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ correo: 'cliente@mail.com', rol: 'CLIENTE', personaId: 5 }],
      }) // buscar usuario
      .mockResolvedValueOnce({ rows: [] }) // UPDATE Persona
      .mockResolvedValueOnce({ rows: [] }); // UPDATE User

    const result = await service.completarDatosPorCorreo('cliente@mail.com', {
      nombre: 'Juan',
      password: '12345',
    } as any);

    expect(bcrypt.hash).toHaveBeenCalledWith('12345', 10);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "User"'),
      ['hash_mock', 'cliente@mail.com'],
    );
    expect(result.message).toBe('Datos del cliente completados correctamente.');
  });

  // --------------------------------------------------------------------
  // TEST 10: Telefono duplicado
  // --------------------------------------------------------------------
  it('Debe lanzar BadRequestException si el telefono ya esta en uso', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ correo: 'cliente@mail.com', rol: 'CLIENTE', personaId: 5 }],
      }) // buscar usuario
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }); // telefono duplicado

    await expect(
      service.completarDatosPorCorreo('cliente@mail.com', {
        telefono: '99998888',
      } as any),
    ).rejects.toThrow('El teléfono ya está en uso por otro usuario.');
  });

  // --------------------------------------------------------------------
  // TEST 11: DNI duplicado
  // --------------------------------------------------------------------
  it('Debe lanzar BadRequestException si el DNI ya esta en uso', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ correo: 'cliente@mail.com', rol: 'CLIENTE', personaId: 5 }],
      }) // buscar usuario
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }); // dni duplicado

    await expect(
      service.completarDatosPorCorreo('cliente@mail.com', {
        dni: '0801-1999-12345',
      } as any),
    ).rejects.toThrow('El DNI ya está en uso por otro usuario.');
  });
});