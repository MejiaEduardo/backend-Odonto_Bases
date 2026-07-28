import { Test, TestingModule } from '@nestjs/testing';
import { ExpedienteService } from '../Expediente/expediente.service';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateExpedienteDto } from '../Expediente/dto/create-expediente.dto';

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

describe('ExpedienteService', () => {
  let service: ExpedienteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpedienteService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ExpedienteService>(ExpedienteService);

    jest.clearAllMocks();
    mockDb.pool.connect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==============================================
  // findAll()
  // ==============================================
  describe('findAll', () => {
    it('debe devolver todos los expedientes', async () => {
      const mockExpedientes = [
        { id: 1, pacienteId: 1, nombre: 'Juan', apellido: 'Perez' },
        { id: 2, pacienteId: 3, nombre: 'Ana', apellido: 'Lopez' },
      ];
      mockQuery.mockResolvedValueOnce({ rows: mockExpedientes });

      const result = await service.findAll();

      expect(result).toEqual(mockExpedientes);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"Expediente"'),
      );
    });
  });

  // ==============================================
  // findOne()
  // ==============================================
  describe('findOne', () => {
    it('debe devolver el expediente con detalles, doctores y archivos', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 1,
              personaId: 8,
              nombreCompleto: 'Juan Perez',
              nombre: 'Juan',
              apellido: 'Perez',
              alergias: 'Ninguna',
              enfermedades: 'Diabetes',
              medicamentos: 'Insulina',
              observaciones: 'Observacion',
              activo: true,
            },
          ],
        }) // expediente
        .mockResolvedValueOnce({ rows: [{ id: 7, motivo: 'Consulta' }] }) // detalles
        .mockResolvedValueOnce({ rows: [{ nombreCompleto: 'Dr. Smith' }] }) // doctores
        .mockResolvedValueOnce({
          rows: [{ id: 1, nombreArchivo: 'file.pdf', tipoArchivo: 'pdf' }],
        }); // archivos

      const result = await service.findOne(1);

      expect(result.id).toBe(1);
      expect(result.nombrePaciente).toBe('Juan Perez');
      expect(result.doctores).toEqual([{ nombre: 'Dr. Smith' }]);
      expect(result.detalles.length).toBe(1);
      expect(result.archivos.length).toBe(1);
    });

    it('debe buscar por pacienteId cuando idPaciente es true', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, personaId: 8, nombreCompleto: 'Juan Perez' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await service.findOne(5, true);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('"pacienteId"'),
        [5],
      );
    });

    it('debe lanzar NotFoundException si no existe', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.findOne(99)).rejects.toThrow(
        'Expediente con ID 99 no encontrado',
      );
    });
  });

  // ==============================================
  // create()
  // ==============================================
  describe('create', () => {
    const createDto: CreateExpedienteDto = {
      pacienteId: 1,
      doctorId: 2,
      alergias: 'Ninguna',
      enfermedades: 'Ninguna',
      medicamentos: 'Ninguno',
      observaciones: '',
    } as any;

    it('debe crear un expediente si todo es valido', async () => {
      // validaciones previas (pool.query)
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // persona existe
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no hay expediente previo
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 2, puesto: 'DOCTOR' }],
        }) // doctor valido
        // findOne al final
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, personaId: 8, nombreCompleto: 'Juan Perez' }],
        })
        .mockResolvedValueOnce({ rows: [] }) // detalles
        .mockResolvedValueOnce({ rows: [{ nombreCompleto: 'Dr. Smith' }] }) // doctores
        .mockResolvedValueOnce({ rows: [] }); // archivos

      // transaccion (client.query)
      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT Expediente
        .mockResolvedValueOnce({}) // INSERT ExpedienteDoctor
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.create(createDto);

      expect(result.id).toBe(1);
      expect(result.doctores.length).toBe(1);
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException si el paciente no existe', async () => {
      // idPacienteDesdePersona: 1) no es paciente, 2) tampoco existe la persona
      mockQuery
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.create(createDto)).rejects.toThrow(
        'No se encontro la persona con ID 1',
      );
    });

    it('debe lanzar BadRequestException si el expediente ya existe', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // ya es paciente
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] }); // expediente ya existe

      await expect(service.create(createDto)).rejects.toThrow(
        'El expediente para el paciente con ID 1 ya existe',
      );
    });

    it('debe lanzar NotFoundException si el doctor no tiene puesto DOCTOR', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // persona
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // sin expediente previo
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 2, puesto: 'RECEPCIONISTA' }],
        });

      await expect(service.create(createDto)).rejects.toThrow(
        'No se encontro un doctor valido con ID 2',
      );
    });

    it('debe hacer ROLLBACK si falla la transaccion', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 2, puesto: 'DOCTOR' }],
        });

      mockClientQuery
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')) // INSERT falla
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(service.create(createDto)).rejects.toThrow();

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  // ==============================================
  // getExpedientesPorDoctor()
  // ==============================================
  describe('getExpedientesPorDoctor', () => {
    it('debe devolver los expedientes asociados al doctor', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: [{ id: 1 }, { id: 2 }],
      });

      const result = await service.getExpedientesPorDoctor(3);

      expect(result.length).toBe(2);
    });

    it('debe lanzar NotFoundException si el doctor no tiene expedientes', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.getExpedientesPorDoctor(3)).rejects.toThrow(
        'No tiene pacientes o expedientes asignados el doctor con ID 3',
      );
    });
  });

  // ==============================================
  // update()
  // ==============================================
  describe('update', () => {
    it('debe actualizar solo los campos enviados', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, pacienteId: 1 }],
        }) // expediente existe
        .mockResolvedValueOnce({
          rows: [{ id: 1, alergias: 'Penicilina' }],
        }); // UPDATE

      const result = await service.update(1, { alergias: 'Penicilina' } as any);

      expect(result.alergias).toBe('Penicilina');
    });

    it('debe lanzar NotFoundException si el expediente no existe', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.update(99, { alergias: 'X' } as any)).rejects.toThrow(
        'No se encontro el expediente con ID 99',
      );
    });

    it('debe lanzar BadRequestException si no se envian campos', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 1, pacienteId: 1 }],
      });

      await expect(service.update(1, {} as any)).rejects.toThrow(
        'No se enviaron campos para actualizar',
      );
    });
  });

  // ==============================================
  // crearExpedienteDetalle()
  // ==============================================
  describe('crearExpedienteDetalle', () => {
    const detalleDto = {
      expedienteId: 1,
      fecha: '2026-07-15T14:30:00Z',
      motivo: 'Consulta general',
      diagnostico: 'Caries',
      tratamiento: 'Limpieza',
      planTratamiento: 'Revision en 6 meses',
      doctorId: 2,
    } as any;

    it('debe crear el detalle si expediente y doctor existen', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // expediente
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 2 }] }) // doctor
        .mockResolvedValueOnce({ rows: [{ id: 50, ...detalleDto }] }); // INSERT

      const result = await service.crearExpedienteDetalle(detalleDto);

      expect(result.id).toBe(50);
    });

    it('debe lanzar NotFoundException si el expediente no existe', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.crearExpedienteDetalle(detalleDto),
      ).rejects.toThrow('El expediente con ID 1 no existe');
    });

    it('debe lanzar NotFoundException si el doctor no existe', async () => {
      mockQuery
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.crearExpedienteDetalle(detalleDto),
      ).rejects.toThrow('El doctor con ID 2 no existe');
    });
  });

  // ==============================================
  // getHistorialPaciente()
  // ==============================================
  describe('getHistorialPaciente', () => {
    it('debe devolver el historial del paciente', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { id: 1, motivo: 'Consulta', nombre: 'Dr.', apellido: 'Smith' },
          { id: 2, motivo: 'Control', nombre: 'Dr.', apellido: 'Smith' },
        ],
      });

      const result = await service.getHistorialPaciente(1);

      expect(result.length).toBe(2);
    });

    it('debe lanzar NotFoundException si no hay historial', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.getHistorialPaciente(1)).rejects.toThrow(
        'No se encontro historial para el paciente con ID 1',
      );
    });
  });
});