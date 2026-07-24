import { Test, TestingModule } from '@nestjs/testing';
import { ServiciosService } from '../Servicios/Servicios.service';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateServiciosDto } from '../Servicios/dto/create_servicios.dto';
import { UpdateServiciosDto } from '../Servicios/dto/update_Servicios.dto';

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

describe('ServiciosService', () => {
  let service: ServiciosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);

    jest.clearAllMocks();
    mockDb.pool.connect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * PRUEBAS PARA findAll()
   */
  describe('findAll', () => {
    it('debe devolver un array de servicios', async () => {
      const mockServicios = [
        {
          id: 1,
          nombre: 'Consulta',
          descripcion: 'D',
          precio: 50,
          activo: true,
          especialidades: [],
        },
        {
          id: 2,
          nombre: 'Rayos X',
          descripcion: 'R',
          precio: 100,
          activo: true,
          especialidades: [{ id: 1, nombre: 'Radiologia' }],
        },
      ];
      mockQuery.mockResolvedValueOnce({ rows: mockServicios });

      const result = await service.findAll();

      expect(result).toEqual(mockServicios);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"ServicioClinico"'),
      );
    });
  });

  /**
   * PRUEBAS PARA findOne(id)
   */
  describe('findOne', () => {
    it('debe devolver un servicio si se encuentra', async () => {
      const mockServicio = {
        id: 1,
        nombre: 'Consulta',
        descripcion: 'D',
        precio: 50,
        activo: true,
        especialidades: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [mockServicio] });

      const result = await service.findOne(1);

      expect(result).toEqual(mockServicio);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE s.id = $1'),
        [1],
      );
    });

    it('debe devolver un error si el servicio NO se encuentra', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.findOne(99);

      expect(result).toEqual({ message: 'Servicio no encontrado', code: 4 });
    });
  });

  /**
   * PRUEBAS PARA createServicio(dto)
   */
  describe('createServicio', () => {
    const createDto: CreateServiciosDto = {
      nombre: 'Nuevo Servicio',
      descripcion: 'D',
      precio: 75,
      activo: true,
      especialidadIds: [],
    } as any;

    it('debe crear un servicio y devolver el objeto con code 0', async () => {
      const nuevoServicio = { id: 10, ...createDto, especialidades: [] };

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // nombre libre
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // INSERT servicio
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({ rows: [nuevoServicio] }); // relectura final

      const result = await service.createServicio(createDto);

      expect(result).toEqual({ message: nuevoServicio, code: 0 });
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('debe crear un servicio con especialidades asociadas', async () => {
      const dtoConEsp = { ...createDto, especialidadIds: [1, 2] } as any;
      const nuevoServicio = {
        id: 10,
        ...dtoConEsp,
        especialidades: [
          { id: 1, nombre: 'Ortodoncia' },
          { id: 2, nombre: 'Endodoncia' },
        ],
      };

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // nombre libre
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // especialidades existen
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // INSERT servicio
        .mockResolvedValueOnce({}) // INSERT relaciones
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({ rows: [nuevoServicio] });

      const result = await service.createServicio(dtoConEsp);

      expect(result.code).toBe(0);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('"ServicioEspecialidad"'),
        [10, 1, 10, 2],
      );
    });

    it('debe devolver error 3 si el servicio ya existe', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // nombre duplicado
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.createServicio(createDto);

      expect(result).toEqual({ message: 'El servicio ya existe', code: 3 });
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    });

    it('debe devolver error 7 si alguna especialidad no existe', async () => {
      const dtoConEsp = { ...createDto, especialidadIds: [1, 99] } as any;

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // nombre libre
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // solo encontro una
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.createServicio(dtoConEsp);

      expect(result).toEqual({
        message: 'Alguna especialidad no existe',
        code: 7,
      });
    });

    it('debe devolver error 1 si el nombre esta vacio', async () => {
      const dtoVacio = { ...createDto, nombre: ' ' } as any;

      const result = await service.createServicio(dtoVacio);

      expect(result).toEqual({ message: 'El nombre es obligatorio', code: 1 });
      expect(mockDb.pool.connect).not.toHaveBeenCalled();
    });

    it('debe devolver error 2 si el precio es cero o menor', async () => {
      const dtoPrecioInvalido = { ...createDto, precio: 0 } as any;

      const result = await service.createServicio(dtoPrecioInvalido);

      expect(result).toEqual({
        message: 'El precio debe ser mayor a cero',
        code: 2,
      });
      expect(mockDb.pool.connect).not.toHaveBeenCalled();
    });

    it('debe devolver code 500 ante un error interno', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Simulated DB error'))
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.createServicio(createDto);

      expect(result).toEqual({
        message: 'Error interno del servidor',
        code: 500,
      });
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  /**
   * PRUEBAS PARA updateServicio(id, dto)
   */
  describe('updateServicio', () => {
    const updateDto: UpdateServiciosDto = {
      nombre: 'Consulta Actualizada',
      precio: 150,
    } as any;

    const updatedService = {
      id: 1,
      nombre: 'Consulta Actualizada',
      descripcion: 'D',
      precio: 150,
      activo: true,
      especialidades: [],
    };

    it('debe actualizar el servicio y devolver el objeto con code 0', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Consulta' }] }) // existe
        .mockResolvedValueOnce({ rows: [] }) // nombre no duplicado
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({ rows: [updatedService] });

      const result = await service.updateServicio(1, updateDto);

      expect(result).toEqual({ message: updatedService, code: 0 });
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "ServicioClinico"'),
        expect.arrayContaining(['Consulta Actualizada', 150, 1]),
      );
    });

    it('debe devolver error 4 si el servicio a actualizar NO existe', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // no existe
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.updateServicio(99, updateDto);

      expect(result).toEqual({ message: 'El servicio no existe', code: 4 });
    });

    it('debe devolver error 6 si el nuevo nombre ya esta en uso', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Consulta' }] }) // existe
        .mockResolvedValueOnce({ rows: [{ id: 8 }] }) // nombre duplicado
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.updateServicio(1, updateDto);

      expect(result).toEqual({ message: 'Servicio existente', code: 6 });
    });

    it('debe devolver error 2 si se intenta actualizar con un precio <= 0', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Consulta' }] }) // existe
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.updateServicio(1, { precio: 0 } as any);

      expect(result).toEqual({
        message: 'El precio debe ser mayor a cero',
        code: 2,
      });
    });

    it('debe permitir la actualizacion si solo se envian campos opcionales', async () => {
      const resultUpdate = { ...updatedService, activo: false };

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Consulta' }] }) // existe
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({ rows: [resultUpdate] });

      const result = await service.updateServicio(1, { activo: false } as any);

      expect(result.code).toBe(0);
      expect(result.message).toEqual(resultUpdate);
    });

    it('debe reemplazar las especialidades si vienen en el DTO', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Consulta' }] }) // existe
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // especialidad existe
        .mockResolvedValueOnce({}) // DELETE relaciones
        .mockResolvedValueOnce({}) // INSERT relaciones
        .mockResolvedValueOnce({}); // COMMIT

      mockQuery.mockResolvedValueOnce({ rows: [updatedService] });

      const result = await service.updateServicio(1, {
        especialidadIds: [3],
      } as any);

      expect(result.code).toBe(0);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "ServicioEspecialidad"'),
        [1],
      );
    });

    it('debe manejar errores internos del servidor (code 500)', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, nombre: 'Consulta' }] }) // existe
        .mockResolvedValueOnce({ rows: [] }) // nombre libre
        .mockRejectedValueOnce(new Error('Simulated DB error')) // UPDATE falla
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.updateServicio(1, updateDto);

      expect(result).toEqual({
        message: 'Error interno del servidor',
        code: 500,
      });
    });
  });

  /**
   * PRUEBAS PARA deleteServicio(id)
   */
  describe('deleteServicio', () => {
    const idToDelete = 1;

    it('debe eliminar el servicio y devolver code 0 si NO tiene citas asociadas', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // sin citas
        .mockResolvedValueOnce({}) // DELETE relaciones
        .mockResolvedValueOnce({}) // DELETE servicio
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.deleteServicio(idToDelete);

      expect(result).toEqual({
        message: 'Servicio eliminado correctamente',
        code: 0,
      });
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "ServicioClinico"'),
        [idToDelete],
      );
    });

    it('debe devolver error 5 si el servicio tiene citas asociadas', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // hay cita
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.deleteServicio(idToDelete);

      expect(result).toEqual({
        message:
          'No se puede eliminar el servicio porque tiene citas asociadas',
        code: 5,
      });
      expect(mockClientQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "ServicioClinico"'),
        [idToDelete],
      );
    });

    it('debe manejar errores internos del servidor (code 500)', async () => {
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // sin citas
        .mockRejectedValueOnce(new Error('Simulated DB error')) // DELETE falla
        .mockResolvedValueOnce({}); // ROLLBACK

      const result = await service.deleteServicio(idToDelete);

      expect(result).toEqual({
        message: 'Error interno del servidor',
        code: 500,
      });
    });
  });
});