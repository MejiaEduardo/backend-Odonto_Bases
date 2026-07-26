import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';

import { EspecialidadService } from './especialidad.service';
import { CreateEspecialidadDto } from './dto/create_especialidad.dto';
import { UpdateEspecialidadDto } from './dto/update_especialidad.dto';

const CODE_TO_HTTP_STATUS: Record<number, HttpStatus> = {
  1: HttpStatus.BAD_REQUEST,
  3: HttpStatus.CONFLICT, // nombre duplicado
  4: HttpStatus.NOT_FOUND,
  5: HttpStatus.CONFLICT, // tiene servicios asociados
  500: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Controlador de Especialidades.
 *
 * Consultar el catalogo requiere sesion (lo usan las pantallas de admin
 * y el alta de empleados); modificarlo es solo de ADMIN.
 */
@ApiTags('Especialidad')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('especialidad')
export class EspecialidadController {
  constructor(private readonly especialidadService: EspecialidadService) {}

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

  @Get()
  @ApiOperation({ summary: 'Listar todas las especialidades' })
  @ApiResponse({ status: 200, description: 'Listado de especialidades' })
  async findAll() {
    return this.especialidadService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una especialidad por id' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.throwIfError(await this.especialidadService.findOne(id));
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Crear una especialidad' })
  @ApiResponse({ status: 409, description: 'Ya existe una con ese nombre' })
  async create(@Body() dto: CreateEspecialidadDto) {
    return this.throwIfError(await this.especialidadService.create(dto));
  }

  /**
   * El frontend usa PUT para actualizar. Aceptamos PUT y PATCH para no
   * atarnos a uno solo y evitar el desajuste que ya tuvimos con /citas.
   */
  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Actualizar una especialidad' })
  async updatePut(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEspecialidadDto,
  ) {
    return this.throwIfError(await this.especialidadService.update(id, dto));
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Actualizar una especialidad (parcial)' })
  async updatePatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEspecialidadDto,
  ) {
    return this.throwIfError(await this.especialidadService.update(id, dto));
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Eliminar una especialidad' })
  @ApiResponse({ status: 409, description: 'Tiene servicios asociados' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.throwIfError(await this.especialidadService.remove(id));
  }
}
