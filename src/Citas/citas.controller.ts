import {Body, Controller, Get,HttpCode,HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Query,} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CitasService } from './citas.service';
import { CreateCitaDto } from './dto/create.citas.dto';
import { UpdateCitaDto } from './dto/update.citas.dto';
import { HistorialCancelaDto } from './dto/historial-cancelaciones.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';


const CODE_TO_HTTP_STATUS: Record<number, HttpStatus>={
    4: HttpStatus.NOT_FOUND, // CITA NO ENCONTRADA
    5: HttpStatus.CONFLICT, // TRANSICION DE ESTADO NO PERMITIDA (p. ej. aprobar algo que no esta SOLICITADA)
    21: HttpStatus.NOT_FOUND, // DOCTOR NO ENCONTRADO
    22: HttpStatus.NOT_FOUND, // PACIENTE NO ENCONTRADO
    23: HttpStatus.BAD_REQUEST, // FROMATO DE FECHA INVALIDO
    24: HttpStatus.CONFLICT, // DOCTOR YA TIENE CITA
    25: HttpStatus.BAD_REQUEST, // NO SE PUEDE AGENDAR EN EL PASADO
    26: HttpStatus.BAD_REQUEST, // HORA INVALIDA
    28: HttpStatus.CONFLICT, //PACIENTE YA TIENE CITA EN ESE HORARIO
    500: HttpStatus.INTERNAL_SERVER_ERROR
};

/*
 * Toda la agenda exige sesion iniciada. Los roles se ponen por endpoint
 * porque cada transicion la ejecuta alguien distinto:
 *   solicitar  -> CLIENTE      aprobar   -> RECEPCIONISTA
 *   confirmar  -> CLIENTE      completar -> DOCTOR
 *
 * OJO: esto valida QUE ROL eres, no DE QUIEN es la cita. Un CLIENTE
 * autenticado todavia puede pedir /citas/paciente/<otro id>. Falta el
 * chequeo de pertenencia (ver GUIA_BACKEND.md).
 */
@ApiTags('Citas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('citas')
export class CitasController{
    constructor (private readonly citasService: CitasService){}


    private throwIfError(result: any){
        if (
            result &&
            typeof result === 'object' &&
            !Array.isArray(result) &&
            result.code !== 0
        ){
            const status = CODE_TO_HTTP_STATUS[result.code] ?? HttpStatus.BAD_REQUEST;
            throw new HttpException(result, status);
        }
        return result;
    }
    
    @Post()
    @Roles('CLIENTE', 'RECEPCIONISTA', 'ADMIN')
    @ApiOperation({summary: 'Agendar una nueva cita'})
    @ApiResponse({status: 201, description:'Cita creada correctamente'})
    @ApiResponse({status: 404, description: 'Doctor o paciente no encontrado'})
    @ApiResponse({status:409, description: 'Horario ya ocupado'})
    async create (@Body() createCitaDto:CreateCitaDto){
        const result = await this.citasService.create(createCitaDto);
        return this.throwIfError(result);
    }


    @Get()
  @Roles('RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Listar todas las citas, opcionalmente filtradas por fecha' })
  @ApiQuery({ name: 'fecha', required: false, description: 'Formato YYYY-MM-DD' })
  @ApiQuery({ name: 'estado', required: false, description: 'SOLICITADA, PENDIENTE, CONFIRMADA...' })
  @ApiQuery({ name: 'desdeHoy', required: false, description: 'true = ocultar citas pasadas' })
  async findAll(
    @Query('fecha') fecha?: string,
    @Query('estado') estado?: string,
    @Query('desdeHoy') desdeHoy?: string,
  ) {
    return this.citasService.findAll({
      fecha,
      estado,
      desdeHoy: desdeHoy === 'true',
    });
  }
 
  @Get('doctores-disponibles')
  @ApiOperation({ summary: 'Doctores disponibles para un servicio en una fecha' })
  @ApiQuery({ name: 'fecha', required: true, description: 'Formato YYYY-MM-DD' })
  @ApiQuery({ name: 'servicioId', required: true })
  async getDoctoresDisponibles(
    @Query('fecha') fecha: string,
    @Query('servicioId', ParseIntPipe) servicioId: number,
  ) {
    return this.citasService.getDoctoresDisponibles(fecha, servicioId);
  }
 
  @Get('horas-disponibles')
  @ApiOperation({ summary: 'Horas disponibles de un doctor en una fecha' })
  @ApiQuery({ name: 'doctorId', required: true })
  @ApiQuery({ name: 'fecha', required: true, description: 'Formato YYYY-MM-DD' })
  async getHorasDisponibles(
    @Query('doctorId', ParseIntPipe) doctorId: number,
    @Query('fecha') fecha: string,
  ) {
    return this.citasService.getHorasDisponibles(doctorId, fecha);
  }
 
  @Get('confirmadas')
  @ApiOperation({ summary: 'Citas confirmadas de un paciente con un doctor para hoy' })
  @ApiQuery({ name: 'pacienteId', required: true })
  @ApiQuery({ name: 'doctorId', required: true })
  async citasConfirmadas(
    @Query('pacienteId', ParseIntPipe) pacienteId: number,
    @Query('doctorId', ParseIntPipe) doctorId: number,
  ) {
    return this.citasService.citasConfirmadas(pacienteId, doctorId);
  }
 
  @Get('paciente/:pacienteId')
  @ApiOperation({ summary: 'Citas activas de un paciente (excluye canceladas/completadas)' })
  @ApiResponse({ status: 404, description: 'Paciente no encontrado' })
  async getCitasPorPaciente(@Param('pacienteId', ParseIntPipe) pacienteId: number) {
    const result = await this.citasService.getCitasPorPaciente(pacienteId);
    return this.throwIfError(result);
  }
 
  @Get('doctor/:doctorId')
  @Roles('DOCTOR', 'RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Citas asignadas a un doctor' })
  async getCitasForDoctor(@Param('doctorId', ParseIntPipe) doctorId: number) {
    return this.citasService.getCitasForDoctor(doctorId);
  }
 
  @Get(':id')
  @ApiOperation({ summary: 'Obtener una cita por id' })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.citasService.findOne(id);
    return this.throwIfError(result);
  }
 
  @Patch(':id')
  @Roles('CLIENTE', 'RECEPCIONISTA', 'ADMIN')
  @ApiOperation({ summary: 'Actualizar fecha/hora de una cita' })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  @ApiResponse({ status: 409, description: 'El doctor ya tiene una cita en ese horario' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCitaDto: UpdateCitaDto,
  ) {
    const result = await this.citasService.update(id, updateCitaDto);
    return this.throwIfError(result);
  }
 
  @Patch(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una cita y registrar el historial de cancelación' })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  async cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body() historialCancelaDto: HistorialCancelaDto,
  ) {
    const result = await this.citasService.cancelar(id, historialCancelaDto);
    return this.throwIfError(result);
  }
 
  @Patch(':id/aprobar')
  @Roles('RECEPCIONISTA', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recepcion aprueba una solicitud de cita (SOLICITADA -> PENDIENTE)',
  })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  @ApiResponse({ status: 409, description: 'La cita no esta en estado SOLICITADA' })
  async aprobar(@Param('id', ParseIntPipe) id: number) {
    const result = await this.citasService.aprobar(id);
    return this.throwIfError(result);
  }

  @Patch(':id/completar')
  @Roles('DOCTOR', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'El doctor marca la cita como atendida (-> COMPLETADA)',
    description: 'Requisito para poder facturarla desde recepcion.',
  })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  @ApiResponse({ status: 409, description: 'La cita no esta en un estado completable' })
  async completar(@Param('id', ParseIntPipe) id: number) {
    const result = await this.citasService.completar(id);
    return this.throwIfError(result);
  }

  @Patch(':id/enterado')
  @Roles('CLIENTE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'El paciente da por leido el aviso de cancelacion',
    description:
      'No modifica la cita. Solo marca "vistoPorPaciente" para que el aviso deje de mostrarse.',
  })
  @ApiResponse({ status: 404, description: 'No hay avisos pendientes para esa cita' })
  async enterado(@Param('id', ParseIntPipe) id: number) {
    const result = await this.citasService.marcarCancelacionVista(id);
    return this.throwIfError(result);
  }

  @Patch(':id/confirmar')
  @Roles('CLIENTE', 'RECEPCIONISTA', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar una cita' })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  async confirmar(@Param('id', ParseIntPipe) id: number) {
    const result = await this.citasService.confirmar(id);
    return this.throwIfError(result);
  }

}