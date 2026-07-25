import {Body, Controller, Get,HttpCode,HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Query,} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CitasService } from './citas.service';
import { CreateCitaDto } from './dto/create.citas.dto';
import { UpdateCitaDto } from './dto/update.citas.dto';
import { HistorialCancelaDto } from './dto/historial-cancelaciones.dto';


const CODE_TO_HTTP_STATUS: Record<number, HttpStatus>={
    4: HttpStatus.NOT_FOUND, // CITA NO ENCONTRADA
    21: HttpStatus.NOT_FOUND, // DOCTOR NO ENCONTRADO
    22: HttpStatus.NOT_FOUND, // PACIENTE NO ENCONTRADO
    23: HttpStatus.BAD_REQUEST, // FROMATO DE FECHA INVALIDO
    24: HttpStatus.CONFLICT, // DOCTOR YA TIENE CITA
    25: HttpStatus.BAD_REQUEST, // NO SE PUEDE AGENDAR EN EL PASADO
    26: HttpStatus.BAD_REQUEST, // HORA INVALIDA
    28: HttpStatus.CONFLICT, //PACIENTE YA TIENE CITA EN ESE HORARIO
    500: HttpStatus.INTERNAL_SERVER_ERROR
};

@ApiTags('Citas')
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
    @ApiOperation({summary: 'Agendar una nueva cita'})
    @ApiResponse({status: 201, description:'Cita creada correctamente'})
    @ApiResponse({status: 404, description: 'Doctor o paciente no encontrado'})
    @ApiResponse({status:409, description: 'Horario ya ocupado'})
    async create (@Body() createCitaDto:CreateCitaDto){
        const result = await this.citasService.create(createCitaDto);
        return this.throwIfError(result);
    }


    @Get()
  @ApiOperation({ summary: 'Listar todas las citas, opcionalmente filtradas por fecha' })
  @ApiQuery({ name: 'fecha', required: false, description: 'Formato YYYY-MM-DD' })
  async findAll(@Query('fecha') fecha?: string) {
    return this.citasService.findAll({ fecha });
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
 
  @Patch(':id/confirmar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar una cita' })
  @ApiResponse({ status: 404, description: 'Cita no encontrada' })
  async confirmar(@Param('id', ParseIntPipe) id: number) {
    const result = await this.citasService.confirmar(id);
    return this.throwIfError(result);
  }

}