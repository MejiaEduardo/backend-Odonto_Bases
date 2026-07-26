import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateFacturaDto } from './dto/create-factura.dto';

/** Tasa general de ISV en Honduras. */
const ISV_15 = 0.15;

/** CAI de prueba. En producción lo asigna el SAR por rango de facturación. */
const CAI_POR_DEFECTO = 'A1B2C3-D4E5F6-G7H8I9-J1K2L3-M4N5O6-P7';

export type PeriodoReporte = 'DIA' | 'SEMANA' | 'MES';

/**
 * Módulo de facturación.
 *
 * Las tablas "Factura" y "DetalleFactura" ya existían en el esquema con los
 * campos fiscales hondureños (cai, numeroFactura, isv15, isv18,
 * importeExonerado, importeExento), pero no había ningún controlador que las
 * expusiera. Esto implementa lo que el Manual de Usuario describe:
 * generar factura, imprimirla, historial y reportes de ingresos.
 *
 * Códigos de retorno (mismo criterio que el resto del proyecto):
 *   0 = ok | 4 = no encontrada | 5 = conflicto | 500 = error interno
 */
@Injectable()
export class FacturaService {
  constructor(private readonly db: DatabaseService) {}

  // =====================================================================
  //  Citas facturables
  // =====================================================================

  /**
   * Citas COMPLETADAS que todavía no tienen factura.
   * `busqueda` filtra por correo, DNI o teléfono del paciente.
   */
  async citasFacturables(busqueda?: string) {
    const filtro = (busqueda ?? '').trim().toLowerCase();

    const { rows } = await this.db.pool.query(
      `
      SELECT
        c.id                AS "citaId",
        c.fecha,
        c.hora,
        p.id                AS "pacienteId",
        (p.nombre || ' ' || p.apellido) AS "pacienteNombre",
        p.dni               AS "pacienteDni",
        e.id                AS "doctorId",
        (dp.nombre || ' ' || dp.apellido) AS "doctorNombre",
        s.id                AS "servicioId",
        s.nombre            AS "servicioNombre",
        s.precio
      FROM "Cita" c
      JOIN "Persona" p        ON p.id = c."pacienteId"
      JOIN "ServicioClinico" s ON s.id = c."servicioId"
      LEFT JOIN "Empleado" e   ON e.id = c."doctorId"
      LEFT JOIN "Persona" dp   ON dp.id = e."personaId"
      LEFT JOIN "User" u       ON u."personaId" = p.id
      WHERE c.estado = 'COMPLETADA'
        AND NOT EXISTS (SELECT 1 FROM "Factura" f WHERE f."citaId" = c.id)
        AND (
          $1 = ''
          OR LOWER(COALESCE(u.correo, ''))  = $1
          OR LOWER(COALESCE(p.dni, ''))     = $1
          OR LOWER(COALESCE(p.telefono, '')) = $1
          OR LOWER(p.nombre || ' ' || p.apellido) LIKE '%' || $1 || '%'
        )
      ORDER BY c.fecha DESC, c.id DESC
      `,
      [filtro],
    );
    return rows;
  }

  // =====================================================================
  //  Emitir factura
  // =====================================================================

  /** Genera el siguiente correlativo: 000-001-01-00000001 */
  private async siguienteNumero(client: PoolClient): Promise<string> {
    const { rows } = await this.db.pool.query(
      `SELECT COALESCE(MAX(id), 0) + 1 AS siguiente FROM "Factura"`,
    );
    const n = Number(rows[0]?.siguiente ?? 1);
    return `000-001-01-${String(n).padStart(8, '0')}`;
  }

  async emitir(dto: CreateFacturaDto) {
    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. La cita debe existir, estar COMPLETADA y no tener factura
      const { rows: citaRows } = await client.query(
        `
        SELECT c.id, c."pacienteId", c."doctorId", c."servicioId",
               s.nombre AS "servicioNombre", s.precio, c.estado
        FROM "Cita" c
        JOIN "ServicioClinico" s ON s.id = c."servicioId"
        WHERE c.id = $1
        `,
        [dto.citaId],
      );
      if (citaRows.length === 0) {
        await client.query('ROLLBACK');
        return { message: 'La cita no existe', code: 4 };
      }
      const cita = citaRows[0];

      if (cita.estado !== 'COMPLETADA') {
        await client.query('ROLLBACK');
        return {
          message: 'Solo se pueden facturar citas COMPLETADAS',
          code: 5,
        };
      }

      const { rows: yaFacturada } = await client.query(
        `SELECT id FROM "Factura" WHERE "citaId" = $1`,
        [dto.citaId],
      );
      if (yaFacturada.length > 0) {
        await client.query('ROLLBACK');
        return { message: 'Esta cita ya fue facturada', code: 5 };
      }

      // 2. Totales
      const subtotal = Number(cita.precio) || 0;
      const descuentos = Math.min(Number(dto.descuentos) || 0, subtotal);
      const base = Math.max(subtotal - descuentos, 0);
      const isv15 = Number((base * ISV_15).toFixed(2));
      const totalPagar = Number((base + isv15).toFixed(2));

      // 3. Cabecera
      const numeroFactura = await this.siguienteNumero(client);
      const { rows: facturaRows } = await client.query(
        `
        INSERT INTO "Factura"
          ("numeroFactura", cai, "fechaEmision", "pacienteId", "doctorId",
           subtotal, descuentos, "importeExonerado", "importeExento",
           "isv15", "isv18", "totalPagar", "citaId", "updatedAt")
        VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, 0, 0, $7, 0, $8, $9, CURRENT_TIMESTAMP)
        RETURNING *
        `,
        [
          numeroFactura,
          CAI_POR_DEFECTO,
          cita.pacienteId,
          cita.doctorId,
          subtotal,
          descuentos,
          isv15,
          totalPagar,
          cita.id,
        ],
      );
      const factura = facturaRows[0];

      // 4. Detalle (una línea por el servicio de la cita)
      await client.query(
        `
        INSERT INTO "DetalleFactura"
          ("facturaId", "servicioId", descripcion, cantidad,
           "precioUnitario", "totalLinea", "aplicaISV", "updatedAt")
        VALUES ($1, $2, $3, 1, $4, $5, true, CURRENT_TIMESTAMP)
        `,
        [factura.id, cita.servicioId, cita.servicioNombre, subtotal, subtotal],
      );

      await client.query('COMMIT');
      return { message: 'Factura emitida correctamente', code: 0, data: factura };
    } catch (error) {
      await client.query('ROLLBACK');
      return {
        message: `Error al emitir la factura: ${(error as Error).message}`,
        code: 500,
      };
    } finally {
      client.release();
    }
  }

  // =====================================================================
  //  Consultas
  // =====================================================================

  /** SELECT reutilizable con los datos del paciente y del doctor. */
  private readonly SELECT_FACTURA = `
    SELECT
      f.*,
      (p.nombre || ' ' || p.apellido) AS "pacienteNombre",
      p.dni       AS "pacienteDni",
      p.telefono  AS "pacienteTelefono",
      u.correo    AS "pacienteCorreo",
      CASE WHEN dp.id IS NULL THEN NULL
           ELSE (dp.nombre || ' ' || dp.apellido) END AS "doctorNombre"
    FROM "Factura" f
    JOIN "Persona" p       ON p.id = f."pacienteId"
    LEFT JOIN "User" u     ON u."personaId" = p.id
    LEFT JOIN "Empleado" e ON e.id = f."doctorId"
    LEFT JOIN "Persona" dp ON dp.id = e."personaId"
  `;

  async findOne(id: number) {
    const { rows } = await this.db.pool.query(
      `${this.SELECT_FACTURA} WHERE f.id = $1`,
      [id],
    );
    if (rows.length === 0) {
      return { message: 'Factura no encontrada', code: 4 };
    }

    const { rows: detalle } = await this.db.pool.query(
      `SELECT id, "facturaId", "servicioId", descripcion, cantidad,
              "precioUnitario", "totalLinea", "aplicaISV"
       FROM "DetalleFactura" WHERE "facturaId" = $1 ORDER BY id`,
      [id],
    );

    return { ...rows[0], detalle };
  }

  /** Historial con búsqueda por número, nombre o DNI, y rango de fechas. */
  async findAll(busqueda?: string, desde?: string, hasta?: string) {
    const filtro = (busqueda ?? '').trim().toLowerCase();

    const { rows } = await this.db.pool.query(
      `
      ${this.SELECT_FACTURA}
      WHERE (
              $1 = ''
              OR LOWER(f."numeroFactura") LIKE '%' || $1 || '%'
              OR LOWER(p.nombre || ' ' || p.apellido) LIKE '%' || $1 || '%'
              OR LOWER(COALESCE(p.dni, '')) LIKE '%' || $1 || '%'
            )
        AND ($2::date IS NULL OR f."fechaEmision"::date >= $2::date)
        AND ($3::date IS NULL OR f."fechaEmision"::date <= $3::date)
      ORDER BY f."fechaEmision" DESC, f.id DESC
      `,
      [filtro, desde || null, hasta || null],
    );
    return rows;
  }

  // =====================================================================
  //  Reportes
  // =====================================================================

  async reportes(periodo: PeriodoReporte = 'MES') {
    // date_trunc necesita el nombre en inglés
    const unidad =
      periodo === 'DIA' ? 'day' : periodo === 'SEMANA' ? 'week' : 'month';

    const { rows: porPeriodoRaw } = await this.db.pool.query(
      `
      SELECT
        date_trunc($1, f."fechaEmision") AS periodo,
        COUNT(*)::int                    AS "cantidadFacturas",
        COALESCE(SUM(f."totalPagar"), 0) AS total
      FROM "Factura" f
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 12
      `,
      [unidad],
    );

    // Etiqueta legible según el periodo
    const etiquetar = (fecha: Date): string => {
      const d = new Date(fecha);
      if (periodo === 'DIA') return d.toISOString().split('T')[0];
      if (periodo === 'SEMANA') {
        const inicio = new Date(d);
        const fin = new Date(d);
        fin.setDate(fin.getDate() + 6);
        return `${inicio.toISOString().split('T')[0]} al ${fin.toISOString().split('T')[0]}`;
      }
      const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      return `${meses[d.getMonth()]} ${d.getFullYear()}`;
    };

    const porPeriodo = porPeriodoRaw
      .map((r) => ({
        etiqueta: etiquetar(r.periodo),
        cantidadFacturas: Number(r.cantidadFacturas),
        total: Number(r.total),
      }))
      .reverse(); // del más antiguo al más reciente, para la gráfica

    const { rows: porDoctorRaw } = await this.db.pool.query(
      `
      SELECT
        f."doctorId"                     AS "doctorId",
        CASE WHEN dp.id IS NULL THEN 'Sin doctor asignado'
             ELSE (dp.nombre || ' ' || dp.apellido) END AS "doctorNombre",
        COUNT(*)::int                    AS "cantidadFacturas",
        COALESCE(SUM(f."totalPagar"), 0) AS total
      FROM "Factura" f
      LEFT JOIN "Empleado" e ON e.id = f."doctorId"
      LEFT JOIN "Persona" dp ON dp.id = e."personaId"
      GROUP BY f."doctorId", dp.id, dp.nombre, dp.apellido
      ORDER BY total DESC
      `,
    );

    const porDoctor = porDoctorRaw.map((r) => ({
      doctorId: r.doctorId,
      doctorNombre: r.doctorNombre,
      cantidadFacturas: Number(r.cantidadFacturas),
      total: Number(r.total),
    }));

    const { rows: totales } = await this.db.pool.query(
      `SELECT COUNT(*)::int AS "totalFacturas",
              COALESCE(SUM("totalPagar"), 0) AS "totalGeneral"
       FROM "Factura"`,
    );

    return {
      periodo,
      totalGeneral: Number(totales[0]?.totalGeneral ?? 0),
      totalFacturas: Number(totales[0]?.totalFacturas ?? 0),
      porPeriodo,
      porDoctor,
    };
  }
}
