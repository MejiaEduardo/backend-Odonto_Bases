import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/datebaseService.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { nombreSql, apellidoSql } from '../common/nombres';
import { normalizarRtn } from '../common/formatos';

/** Tasa general de ISV en Honduras. */
const ISV_15 = 0.15;

/** A partir de este monto, el RTN del cliente es obligatorio en la factura. */
const MONTO_EXIGE_RTN = 10000;

export type PeriodoReporte = 'DIA' | 'SEMANA' | 'MES';

/**
 * Módulo de facturación.
 *
 * Cambios desde las migraciones 004 y 005:
 *
 *   - El CAI ya NO es una columna de "Factura": era el mismo texto repetido
 *     en cada fila. Ahora vive en "RangoFacturacion" junto con el rango de
 *     correlativos autorizado y la fecha limite de emision.
 *   - Los datos del negocio (razon social, RTN, direccion) estan en "Emisor",
 *     que cuelga del rango.
 *   - "Factura" guarda las BASES gravadas ("importeGravado15" / 18), no solo
 *     los impuestos, y el RTN del cliente copiado al momento de emitir.
 *   - Una factura NO se borra: se anula (estado = ANULADA con motivo y fecha).
 *     Un trigger de la base rechaza el DELETE.
 *   - "DetalleFactura"."totalLinea" es una columna GENERADA: no se inserta.
 *     "aplicaISV" (booleano) se reemplazo por "tasaISV", que si dice cuanto.
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
        to_char(c.fecha, 'YYYY-MM-DD') AS fecha,
        to_char(c.hora,  'HH24:MI')    AS hora,
        p.id                AS "pacienteId",
        p."nombreCompleto"  AS "pacienteNombre",
        p.dni               AS "pacienteDni",
        p.rtn               AS "pacienteRtn",
        e.id                AS "doctorId",
        dp."nombreCompleto" AS "doctorNombre",
        s.id                AS "servicioId",
        s.nombre            AS "servicioNombre",
        s.precio
      FROM "Cita" c
      JOIN "Paciente" pa       ON pa.id = c."pacienteId"
      JOIN "Persona" p         ON p.id  = pa."personaId"
      JOIN "ServicioClinico" s ON s.id  = c."servicioId"
      LEFT JOIN "Empleado" e   ON e.id  = c."empleadoId"
      LEFT JOIN "Persona" dp   ON dp.id = e."personaId"
      LEFT JOIN "User" u       ON u."personaId" = p.id
      -- Una factura ANULADA libera la cita: se puede volver a facturar.
      WHERE c.estado = 'COMPLETADA'
        AND NOT EXISTS (
          SELECT 1 FROM "Factura" f
          WHERE f."citaId" = c.id
            AND f.estado = 'EMITIDA'
            AND f."tipoDocumento" = 'FACTURA'
        )
        AND (
          $1 = ''
          OR LOWER(COALESCE(u.correo, ''))   = $1
          OR LOWER(COALESCE(p.dni, ''))      = $1
          OR LOWER(COALESCE(p.rtn, ''))      = $1
          OR LOWER(COALESCE(p.telefono, '')) = $1
          OR LOWER(p."nombreCompleto") LIKE '%' || $1 || '%'
        )
      ORDER BY c."fechaHora" DESC, c.id DESC
      `,
      [filtro],
    );
    return rows;
  }

  // =====================================================================
  //  Emitir factura
  // =====================================================================

  /**
   * Rango de facturacion vigente: el CAI autorizado por el SAR, con su rango
   * de correlativos y su fecha limite.
   *
   * Si no hay ninguno activo no se puede facturar: emitir sin CAI vigente es
   * justamente lo que la normativa prohibe.
   */
  private async rangoVigente(client: PoolClient) {
    const { rows } = await client.query(
      `
      SELECT r.id, r.cai, r."numeroInicial", r."numeroFinal",
             r."fechaLimiteEmision"
      FROM "RangoFacturacion" r
      WHERE r.activo = true
        AND r."fechaLimiteEmision" >= CURRENT_DATE
      ORDER BY r.id DESC
      LIMIT 1
      `,
    );
    return rows[0] ?? null;
  }

  /**
   * Siguiente correlativo DENTRO del rango autorizado.
   *
   * Antes se calculaba con MAX(id) + 1 de "Factura", lo cual no tiene nada que
   * ver con el correlativo: si se borraba una factura o se emitia una nota, el
   * numero se saltaba. Ahora se toma el ultimo numero emitido de ese rango y
   * se le suma uno, respetando el prefijo autorizado.
   */
  private async siguienteNumero(
    client: PoolClient,
    rango: { id: number; numeroInicial: string; numeroFinal: string },
  ): Promise<string | null> {
    const { rows } = await client.query(
      `SELECT MAX("numeroFactura") AS ultimo FROM "Factura" WHERE "rangoId" = $1`,
      [rango.id],
    );

    const prefijo = rango.numeroInicial.slice(0, 10); // '000-001-01'
    const ultimo: string | null = rows[0]?.ultimo ?? null;

    const siguiente = ultimo
      ? Number(ultimo.slice(-8)) + 1
      : Number(rango.numeroInicial.slice(-8));

    const numero = `${prefijo}-${String(siguiente).padStart(8, '0')}`;

    // Si se acabo el rango hay que pedirle otro CAI al SAR.
    if (numero > rango.numeroFinal) return null;

    return numero;
  }

  async emitir(dto: CreateFacturaDto) {
    const client: PoolClient = await this.db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. La cita debe existir, estar COMPLETADA y no tener factura vigente
      const { rows: citaRows } = await client.query(
        `
        SELECT c.id, c."pacienteId", c."empleadoId", c."servicioId",
               s.nombre AS "servicioNombre", s.precio, c.estado,
               p.rtn AS "rtnPaciente", p."nombreCompleto" AS "nombrePaciente"
        FROM "Cita" c
        JOIN "ServicioClinico" s ON s.id = c."servicioId"
        JOIN "Paciente" pa       ON pa.id = c."pacienteId"
        JOIN "Persona"  p        ON p.id  = pa."personaId"
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
        `SELECT id FROM "Factura"
         WHERE "citaId" = $1 AND estado = 'EMITIDA' AND "tipoDocumento" = 'FACTURA'`,
        [dto.citaId],
      );
      if (yaFacturada.length > 0) {
        await client.query('ROLLBACK');
        return { message: 'Esta cita ya fue facturada', code: 5 };
      }

      // 2. Totales. "importeGravado15" es la BASE sobre la que se calcula el
      //    ISV: sin ella el pie de la factura no se puede reconstruir.
      const subtotal = Number(cita.precio) || 0;
      const descuentos = Math.min(Number(dto.descuentos) || 0, subtotal);
      const importeGravado15 = Number(Math.max(subtotal - descuentos, 0).toFixed(2));
      const isv15 = Number((importeGravado15 * ISV_15).toFixed(2));
      const totalPagar = Number((importeGravado15 + isv15).toFixed(2));

      /*
       * 3. RTN del cliente (punto 6.2).
       *
       * Se toma el que mande el formulario y, si no viene, el que la persona
       * tenga registrado. Se COPIA a la factura: una factura es un documento
       * legal y tiene que seguir diciendo lo que decia el dia que se emitio,
       * aunque la persona cambie su RTN despues.
       */
      const rtnCliente = normalizarRtn(dto.rtnCliente) ?? cita.rtnPaciente ?? null;

      if (totalPagar > MONTO_EXIGE_RTN && !rtnCliente) {
        await client.query('ROLLBACK');
        return {
          message:
            `El RTN del cliente es obligatorio para facturas mayores a L.${MONTO_EXIGE_RTN}. ` +
            `Registrá el RTN de ${cita.nombrePaciente} o escribilo en el formulario.`,
          code: 5,
        };
      }

      // Si el paciente todavia no tenia RTN guardado, se le guarda.
      if (rtnCliente && !cita.rtnPaciente) {
        await client.query(
          `UPDATE "Persona" SET rtn = $1
           WHERE id = (SELECT "personaId" FROM "Paciente" WHERE id = $2)`,
          [rtnCliente, cita.pacienteId],
        );
      }

      // 4. Rango autorizado y correlativo
      const rango = await this.rangoVigente(client);
      if (!rango) {
        await client.query('ROLLBACK');
        return {
          message:
            'No hay un rango de facturacion vigente. Hay que registrar el CAI autorizado por el SAR antes de poder facturar.',
          code: 5,
        };
      }

      const numeroFactura = await this.siguienteNumero(client, rango);
      if (!numeroFactura) {
        await client.query('ROLLBACK');
        return {
          message: `Se agoto el rango autorizado (hasta ${rango.numeroFinal}). Hay que solicitar un CAI nuevo.`,
          code: 5,
        };
      }

      // 5. Cabecera. El CAI ya no va aca: viene del rango.
      const { rows: facturaRows } = await client.query(
        `
        INSERT INTO "Factura"
          ("numeroFactura", "rangoId", "fechaEmision", "pacienteId", "rtnCliente",
           "empleadoId", "citaId", subtotal, descuentos,
           "importeGravado15", "importeGravado18",
           "importeExonerado", "importeExento",
           isv15, isv18, "totalPagar")
        VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, $8, $9, 0, 0, 0, $10, 0, $11)
        RETURNING *
        `,
        [
          numeroFactura,
          rango.id,
          cita.pacienteId,
          rtnCliente,
          cita.empleadoId,
          cita.id,
          subtotal,
          descuentos,
          importeGravado15,
          isv15,
          totalPagar,
        ],
      );
      const factura = facturaRows[0];

      /*
       * 6. Detalle (una línea por el servicio de la cita).
       *
       * "totalLinea" NO se inserta: es una columna generada (cantidad *
       * precioUnitario) y mandarla da error. "aplicaISV" se reemplazo por
       * "tasaISV", que ademas dice QUE tasa se aplico.
       */
      await client.query(
        `
        INSERT INTO "DetalleFactura"
          ("facturaId", "servicioId", descripcion, cantidad,
           "precioUnitario", "tasaISV")
        VALUES ($1, $2, $3, 1, $4, $5)
        `,
        [factura.id, cita.servicioId, cita.servicioNombre, subtotal, ISV_15],
      );

      await client.query('COMMIT');
      return {
        message: 'Factura emitida correctamente',
        code: 0,
        data: { ...factura, cai: rango.cai },
      };
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

  /**
   * Anular una factura (punto 6.2).
   *
   * No se borra: se conserva con estado ANULADA, motivo y fecha, porque el
   * correlativo tiene que poder rendirse ante el SAR. La base rechaza el
   * DELETE con un trigger.
   *
   * Al anularla, su cita vuelve a quedar facturable.
   */
  async anular(id: number, motivo: string) {
    const motivoLimpio = (motivo ?? '').trim();
    if (motivoLimpio === '') {
      return { message: 'Hay que indicar el motivo de la anulacion', code: 5 };
    }

    try {
      const { rows } = await this.db.pool.query(
        `
        UPDATE "Factura"
        SET estado = 'ANULADA',
            "motivoAnulacion" = $2,
            "fechaAnulacion"  = CURRENT_TIMESTAMP
        WHERE id = $1 AND estado = 'EMITIDA'
        RETURNING id, "numeroFactura", estado, "motivoAnulacion", "fechaAnulacion"
        `,
        [id, motivoLimpio],
      );

      if (rows.length === 0) {
        const existe = await this.db.pool.query(
          `SELECT estado FROM "Factura" WHERE id = $1`,
          [id],
        );
        if (existe.rows.length === 0) {
          return { message: 'Factura no encontrada', code: 4 };
        }
        return { message: 'Esa factura ya estaba anulada', code: 5 };
      }

      return { message: 'Factura anulada', code: 0, data: rows[0] };
    } catch (error) {
      return {
        message: `No se pudo anular la factura: ${(error as Error).message}`,
        code: 500,
      };
    }
  }

  // =====================================================================
  //  Consultas
  // =====================================================================

  /**
   * SELECT reutilizable con los datos fiscales completos.
   *
   * El CAI, el rango y los datos del emisor (razon social, RTN, direccion)
   * vienen de "RangoFacturacion" -> "Emisor". Son obligatorios en la factura
   * impresa segun el regimen de facturacion vigente.
   */
  private readonly SELECT_FACTURA = `
    SELECT
      f.*,
      r.cai,
      r."numeroInicial"    AS "rangoDesde",
      r."numeroFinal"      AS "rangoHasta",
      r."fechaLimiteEmision",
      em."razonSocial"     AS "emisorRazonSocial",
      em."nombreComercial" AS "emisorNombreComercial",
      em.rtn               AS "emisorRtn",
      em.direccion         AS "emisorDireccion",
      em.telefono          AS "emisorTelefono",
      p.id                 AS "pacientePersonaId",
      p."nombreCompleto"   AS "pacienteNombre",
      p.dni                AS "pacienteDni",
      COALESCE(f."rtnCliente", p.rtn) AS "pacienteRtn",
      p.telefono           AS "pacienteTelefono",
      u.correo             AS "pacienteCorreo",
      f."empleadoId"       AS "doctorId",
      dp."nombreCompleto"  AS "doctorNombre"
    FROM "Factura" f
    JOIN "RangoFacturacion" r  ON r.id  = f."rangoId"
    JOIN "Emisor"           em ON em.id = r."emisorId"
    JOIN "Paciente" pa     ON pa.id = f."pacienteId"
    JOIN "Persona"  p      ON p.id  = pa."personaId"
    LEFT JOIN "User" u     ON u."personaId" = p.id
    LEFT JOIN "Empleado" e ON e.id = f."empleadoId"
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
              "precioUnitario", "totalLinea", "tasaISV",
              -- Se mantiene "aplicaISV" para las pantallas viejas
              ("tasaISV" > 0) AS "aplicaISV"
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
              OR LOWER(p."nombreCompleto") LIKE '%' || $1 || '%'
              OR LOWER(COALESCE(p.dni, '')) LIKE '%' || $1 || '%'
              OR LOWER(COALESCE(f."rtnCliente", p.rtn, '')) LIKE '%' || $1 || '%'
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
      -- Las anuladas no son ingreso: no deben contar en los reportes.
      WHERE f.estado = 'EMITIDA'
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
        f."empleadoId"                   AS "doctorId",
        COALESCE(dp."nombreCompleto", 'Sin doctor asignado') AS "doctorNombre",
        COUNT(*)::int                    AS "cantidadFacturas",
        COALESCE(SUM(f."totalPagar"), 0) AS total
      FROM "Factura" f
      LEFT JOIN "Empleado" e ON e.id = f."empleadoId"
      LEFT JOIN "Persona" dp ON dp.id = e."personaId"
      WHERE f.estado = 'EMITIDA'
      GROUP BY f."empleadoId", dp.id, dp."nombreCompleto"
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
       FROM "Factura"
       WHERE estado = 'EMITIDA'`,
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
