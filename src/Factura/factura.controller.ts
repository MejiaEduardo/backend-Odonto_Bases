import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';

import { FacturaService, PeriodoReporte } from './factura.service';
import { CreateFacturaDto } from './dto/create-factura.dto';

const CODE_TO_HTTP_STATUS: Record<number, HttpStatus> = {
  4: HttpStatus.NOT_FOUND,
  5: HttpStatus.CONFLICT,
  500: HttpStatus.INTERNAL_SERVER_ERROR,
};

@ApiTags('Factura')
/*
 * Datos fiscales: nadie fuera de recepcion y administracion los toca.
 * Los reportes de ingresos son solo de ADMIN.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('facturas')
export class FacturaController {
  constructor(private readonly facturaService: FacturaService) {}

  private throwIfError(result: any) {
    if (
      result &&
      typeof result === 'object' &&
      'code' in result &&
      result.code !== 0
    ) {
      const status = CODE_TO_HTTP_STATUS[result.code] ?? HttpStatus.BAD_REQUEST;
      throw new HttpException(result.message, status);
    }
    return result;
  }

  /**
   * OJO con el orden: /facturas/pendientes y /facturas/reportes deben
   * declararse ANTES que /facturas/:id. Si no, Nest interpretaría
   * "pendientes" como un id y ParseIntPipe devolvería 400.
   */
  @Get('pendientes')
  @Roles('RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Citas completadas que aún no tienen factura' })
  @ApiQuery({ name: 'busqueda', required: false, description: 'Correo, DNI, teléfono o nombre' })
  async pendientes(@Query('busqueda') busqueda?: string) {
    return this.facturaService.citasFacturables(busqueda);
  }

  @Get('reportes')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Ingresos por periodo y por doctor' })
  @ApiQuery({ name: 'periodo', required: false, enum: ['DIA', 'SEMANA', 'MES'] })
  async reportes(@Query('periodo') periodo?: string) {
    const valido: PeriodoReporte =
      periodo === 'DIA' || periodo === 'SEMANA' ? periodo : 'MES';
    return this.facturaService.reportes(valido);
  }

  @Get()
  @Roles('RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Historial de facturas' })
  @ApiQuery({ name: 'busqueda', required: false })
  @ApiQuery({ name: 'desde', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'hasta', required: false, description: 'YYYY-MM-DD' })
  async findAll(
    @Query('busqueda') busqueda?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.facturaService.findAll(busqueda, desde, hasta);
  }

  @Get(':id')
  @Roles('RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Obtener una factura con su detalle' })
  @ApiResponse({ status: 404, description: 'Factura no encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.throwIfError(await this.facturaService.findOne(id));
  }

  @Post()
  @Roles('RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Emitir una factura a partir de una cita completada' })
  @ApiResponse({ status: 409, description: 'La cita ya fue facturada o no está COMPLETADA' })
  async emitir(@Body() dto: CreateFacturaDto) {
    const resultado = this.throwIfError(await this.facturaService.emitir(dto));
    // El frontend redirige usando el id, así que devolvemos la factura plana
    return resultado.data ?? resultado;
  }
}
