import { Test, TestingModule } from '@nestjs/testing';
import { EmpleadoService } from '../Empleado/empleado.service';
import { DatabaseService } from '../database/datebaseService.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_mock'),
}));

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

describe('EmpleadoService', () => {
  let service: EmpleadoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmpleadoService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<EmpleadoService>(EmpleadoService);

    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_mock');
    mockDb.pool.connect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  // -------------------------------------------------------
  //                   createEmpleado()
  // -------------------------------------------------------
  describe('createEmpleado', () => {
    const dto = {
      primerNombre: 'Juan',
      segundoNombre: 'Carlos',
      primerApellido: 'Perez',
      segundoApellido: 'Lopez',
      dni: '1234',
      telefono: '9999',
      direccion: 'Ciudad',
      fechaNac: new Date(),
      puesto: 'DOCTOR',
      salario: 5000,
      fechaIngreso: new Date(),
      activo: true,
      correo: 'test@mail.com',
      password: '1234',
      rol: 'ADMIN',
      usuarioActivo: true,
    } as any;

    it('debe lanzar error si el DNI ya existe', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // dni existe
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(service.createEmpleado(dto)).rejects.toThrow(
        new BadRequestException(`El DNI ${dto.dni} ya está registrado.`),
      );

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('debe lanzar error si el correo ya existe', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // dni libre
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // correo existe
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(service.createEmpleado(dto)).rejects.toThrow(
        new BadRequestException(`El correo ${dto.correo} ya está registrado.`),
      );
    });

    it('debe crear persona, empleado y usuario correctamente', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // dni libre
        .mockResolvedValueOnce({ rows: [] }) // correo libre
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // Persona
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // id del Puesto (catalogo)
        .mockResolvedValueOnce({ rows: [{ id: 20 }] }) // Empleado
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // id del Rol (catalogo)
        .mockResolvedValueOnce({ rows: [{ id: 30 }] }) // User
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.createEmpleado(dto);

      expect(result).toEqual({
        empleado: { id: 20 },
        // El rol se devuelve como texto, aunque en la base sea "rolId"
        usuario: { id: 30, rol: 'ADMIN' },
        newpersona: { id: 10 },
        especialidadIds: [],
      });

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    });
  });

  // -------------------------------------------------------
  //                      findAll()
  // -------------------------------------------------------
  describe('findAll', () => {
    it('debe retornar empleados con datos de persona', async () => {
      mockQuery.mockResolvedValueOnce({ rows: ['empleado1'] });

      const result = await service.findAll();

      expect(result).toEqual(['empleado1']);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"Empleado"'),
      );
    });
  });

  // -------------------------------------------------------
  //                 findAllCompleto()
  // -------------------------------------------------------
  describe('findAllCompleto', () => {
    it('debe regresar todos los empleados', async () => {
      mockQuery.mockResolvedValueOnce({ rows: ['emp1', 'emp2'] });

      const result = await service.findAllCompleto();

      expect(result).toEqual(['emp1', 'emp2']);
    });
  });

  // -------------------------------------------------------
  //                    UpdateEmpleado()
  // -------------------------------------------------------
  describe('UpdateEmpleado', () => {
    const dtoUpdate = {
      primerNombre: 'Nuevo',
      primerApellido: 'Apellido',
      dni: '5678',
      telefono: '1234',
      direccion: 'Nueva direccion',
      fechaNac: new Date(),
      puesto: 'ADMIN',
      salario: 6000,
      fechaIngreso: new Date(),
      activo: false,
      correo: 'nuevo@mail.com',
      password: 'nueva123',
      rol: 'RECEPCIONISTA',
      usuarioActivo: false,
    } as any;

    it('debe lanzar NotFoundException si el empleado no existe', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // empleado no existe
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(service.UpdateEmpleado(10, dtoUpdate)).rejects.toThrow(
        new NotFoundException('Empleado con ID 10 no encontrado.'),
      );
    });

    it('debe lanzar error si el DNI ya existe en otra persona', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ personaId: 10 }] }) // empleado existe
        .mockResolvedValueOnce({ rows: [{ id: 99, dni: dtoUpdate.dni }] }) // dni de otra persona
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(service.UpdateEmpleado(10, dtoUpdate)).rejects.toThrow(
        new BadRequestException(`El DNI ${dtoUpdate.dni} ya está registrado.`),
      );
    });

    it('debe actualizar correctamente persona, empleado y usuario', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ personaId: 10 }] }) // empleado existe
        .mockResolvedValueOnce({ rows: [] }) // dni libre
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // UPDATE Persona
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // id del Puesto (catalogo)
        .mockResolvedValueOnce({ rows: [{ id: 20 }] }) // UPDATE Empleado
        .mockResolvedValueOnce({ rows: [{ id: 5, password: 'old' }] }) // SELECT User
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // id del Rol (catalogo)
        .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // UPDATE User
        .mockResolvedValueOnce({ rows: [{ nombre: 'RECEPCIONISTA' }] }) // nombre del rol
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.UpdateEmpleado(10, dtoUpdate);

      expect(result.persona).toEqual({ id: 10 });
      expect(result.empleado).toEqual({ id: 20 });
      expect(result.usuario).toEqual({ id: 5, rol: 'RECEPCIONISTA' });

      expect(bcrypt.hash).toHaveBeenCalledWith(dtoUpdate.password, 10);
    });

    it('debe permitir el mismo DNI si pertenece a la misma persona', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ personaId: 10 }] }) // empleado existe
        .mockResolvedValueOnce({ rows: [{ id: 10, dni: dtoUpdate.dni }] }) // dni propio
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // UPDATE Persona
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // id del Puesto (catalogo)
        .mockResolvedValueOnce({ rows: [{ id: 20 }] }) // UPDATE Empleado
        .mockResolvedValueOnce({ rows: [] }) // no hay User
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.UpdateEmpleado(10, dtoUpdate);

      expect(result.usuario).toBeNull();
    });

    it('no debe hashear si no se envía password', async () => {
      const sinPassword = { ...dtoUpdate, password: undefined };

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ personaId: 10 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 10 }] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // id del Puesto
        .mockResolvedValueOnce({ rows: [{ id: 20 }] })
        .mockResolvedValueOnce({ rows: [{ id: 5, password: 'old' }] })
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // id del Rol
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        .mockResolvedValueOnce({ rows: [{ nombre: 'RECEPCIONISTA' }] })
        .mockResolvedValueOnce({}); // COMMIT

      await service.UpdateEmpleado(10, sinPassword);

      expect(bcrypt.hash).not.toHaveBeenCalled();
    });
  });
});