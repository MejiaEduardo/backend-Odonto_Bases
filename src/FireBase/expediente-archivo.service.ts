import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/datebaseService.service";

export interface ExpedienteArchivo {
    id: number;
    expedienteId: number;
    nombreArchivo: string;
    tipoArchivo: string | null;
    creadoPorId: number;
    createdAt: Date;
    updatedAt: Date;
    filePath: string;
    storageName: string;
}

export type CreateExpedienteArchivoDto = Omit<
    ExpedienteArchivo,
    'id' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class ExpedienteArchivoService {
    constructor(private db: DatabaseService) {}

    // validar que existan las fk antes de crear un registro
    async validateFks(expedienteId: number, creadoPorId: number): Promise<void> {
        // validar si existe el expediente
        const expediente = await this.db.pool.query(
            `SELECT id FROM "Expediente" WHERE id = $1`,
            [expedienteId],
        );
        if (expediente.rows.length === 0) {
            throw new NotFoundException(
                `Expediente con ID ${expedienteId} no encontrado. No se puede iniciar la subida.`,
            );
        }

        // validar la existencia del empleado (Creador)
        const empleado = await this.db.pool.query(
            `SELECT id FROM "Empleado" WHERE id = $1`,
            [creadoPorId],
        );
        if (empleado.rows.length === 0) {
            throw new NotFoundException(
                `Empleado (creador) con ID ${creadoPorId} no encontrado.`,
            );
        }
    }

    // crear un nuevo registro de ExpedienteArchivo
    async create(data: CreateExpedienteArchivoDto): Promise<ExpedienteArchivo> {
        const { rows } = await this.db.pool.query<ExpedienteArchivo>(
            `
            INSERT INTO "ExpedienteArchivo"
              ("expedienteId", "nombreArchivo", "tipoArchivo", "creadoPorId", "filePath", "storageName", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            RETURNING *
            `,
            [
                data.expedienteId,
                data.nombreArchivo,
                data.tipoArchivo ?? null,
                data.creadoPorId,
                data.filePath,
                data.storageName,
            ],
        );
        return rows[0];
    }

    // Obtener archivos por el id del expediente
    async findByExpediente(expedienteId: number): Promise<ExpedienteArchivo[]> {
        const { rows } = await this.db.pool.query<ExpedienteArchivo>(
            `SELECT * FROM "ExpedienteArchivo" WHERE "expedienteId" = $1 ORDER BY "createdAt" DESC`,
            [expedienteId],
        );
        return rows;
    }

    // Obtener un archivo por su ID
    async findOne(id: number): Promise<ExpedienteArchivo> {
        const { rows } = await this.db.pool.query<ExpedienteArchivo>(
            `SELECT * FROM "ExpedienteArchivo" WHERE id = $1`,
            [id],
        );
        if (rows.length === 0) {
            throw new NotFoundException(
                `Registro de archivo con ID ${id} no encontrado en la DB.`,
            );
        }
        return rows[0];
    }

    // Eliminar un archivo por su id
    async delete(id: number): Promise<ExpedienteArchivo> {
        const archivo = await this.findOne(id);
        await this.db.pool.query(`DELETE FROM "ExpedienteArchivo" WHERE id = $1`, [id]);
        return archivo;
    }
}