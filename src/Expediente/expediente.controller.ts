import { Controller, Get, Post, Param, Delete, Put, UseInterceptors, UploadedFile, BadRequestException, Req,UseGuards, UploadedFiles, Body} from '@nestjs/common';
import { ExpedienteService } from './expediente.service';
import { CreateExpedienteDto } from './dto/create-expediente.dto';
import { CreateExpedienteDetalleDto } from './dto/create-expediente-detalle.dto';
import { UpdateExpedienteDto } from './dto/update-expediente.dto';
import { ApiOperation , ApiTags, ApiResponse,ApiParam } from '@nestjs/swagger';
import { ParseIntPipe } from '@nestjs/common';
import { HistoriaDetalleDto } from './dto/historial-expediente.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../FireBase/storage.service';
import { ExpedienteArchivoService } from '../FireBase/expediente-archivo.service';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';
import { get } from 'http';
import { UpdateEmpleadoDto } from '../Empleado/dtoempleado/update-empleado.dto';



@ApiTags('expediente')
@Controller('expediente')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpedienteController {
    constructor( private  readonly expedienteService: ExpedienteService,
                 private storageService: StorageService,
                 private expedienteArchivoService: ExpedienteArchivoService,
    ){}

    @Post()
    @Roles('DOCTOR')
    @ApiOperation({ summary: 'Crear un nuevo expediente'})
    @ApiResponse ({ status: 201, description: 'Expediente creado correctamente. '})
    @ApiResponse({ status: 400, description: 'Datos invalidos.'})
    create(@Body() createExpedienteDto: CreateExpedienteDto){
        return this.expedienteService.create(createExpedienteDto);
    }

    @Get()
    @Roles('ADMIN', 'DOCTOR')
    @ApiOperation({ summary: 'Obtener todos los expedientes' })
    @ApiResponse({ status: 200, description: 'Lista de expedientes obtenida correctamente. '})
    @ApiResponse({ status: 404, description: 'No se encontraron expedientes'})
    findAll(){
        return this.expedienteService.findAll();
    }

    @Get('historial/:pacienteId')
    @Roles('DOCTOR', 'ADMIN')
    @ApiParam({ name: 'pacienteId', type: Number})
    @ApiResponse({status: 200, description: 'Historial obtenido correctamente', type: [HistoriaDetalleDto]})
    @ApiResponse ({ status: 404, description: 'No se encontro historial para este paciente'})
    async getHistorial(@Param('pacienteId',ParseIntPipe) pacienteId: number){
        return this.expedienteService.getHistorialPaciente(pacienteId);
    }

    @Get('paciente/:id')
    @Roles('CLIENTE','ADMIN','DOCTOR')
    @ApiOperation({ summary: 'Obtener un expediente por ID del paciente' })
    @ApiResponse({ status: 200, description: 'Expediente obtenido correctamente.' })
    @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
    getExpedientePorIdPacientes(@Param('id') id: Number) {
        return this.expedienteService.findOne(+id,true);
    }

    @Get('doctor/:id')
    @Roles('DOCTOR')
    async obtenerExpedientePorDoctor(@Param('id',ParseIntPipe)id: number){
        return this.expedienteService.getExpedientesPorDoctor(id);
    }

    @Get(':id')
    @Roles('ADMIN','DOCTOR','CLIENTE')
    @ApiOperation({ summary: 'Obtener un expediente por ID' })
    @ApiResponse({ status: 200, description: 'Expediente obtenido correctamente.' })
    @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
    findOne(@Param('id') id: Number) {
        return this.expedienteService.findOne(+id);
    }

    @Put(':id')
    @Roles('DOCTOR')
    @ApiOperation({ summary: 'Actualizar un expediente por ID' })
    @ApiResponse({ status: 200, description: 'Expediente actualizado correctamente.' })
    @ApiResponse({ status: 400, description: 'Datos invalidos.' })
    @ApiResponse({ status: 404, description: 'Expediente no encontrado.' })
    update(@Param('id') id: Number, @Body() updateExpedienteDto: UpdateExpedienteDto) {
        return this.expedienteService.update(+id, updateExpedienteDto);
    }


// POST: SUBIR ARCHIVO Y CREAR UN REGISTRO EN LA BASE DE DATOS

    @Post('archivo/upload')
    @Roles('ADMIN', 'DOCTOR')
    @ApiParam ({ name: 'file', type: 'file', description: 'Archivo a subir'})
    @ApiResponse ({ status: 200, description: 'Archivo subido y registrado correctamente.'})
    @ApiResponse ({ status: 400, description: 'Error en la subida del archivo. '})
    @UseInterceptors(FileInterceptor('file'))
    async upload(
        @UploadedFile() file: any,
        @Body ('expedienteId', ParseIntPipe) expedienteId: number,
        @Body ('creadoPorId', ParseIntPipe) creadoPorId: number,
    ){
        if (!file){
            throw new BadRequestException('Se requiere un archivo para la subida. ');
        }

    // el storageservice maneja la subida a firebase y la creacion del registro en prisma
    const result = await this.storageService.uploadFile(
        file,
        expedienteId,
        creadoPorId,
    );

    return{
        message: 'Archivo subido y registrado con exito.',
        dbId: result.dbId,
        signedUrl: result.signedUrl,
    };
    }


// DELETE: ELIMINAR ARCHIVO (Eliminar de Firebase )

  @Delete('archivo/:id')
  @Roles('DOCTOR')
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Archivo eliminado correctamente de Firebase y Prisma.' })
  @ApiResponse({ status: 404, description: 'Archivo no encontrado.' })
  async deleteFile(@Param('id', ParseIntPipe) id: number) {
    // El StorageService maneja la lógica dual: elimina de Firebase y luego de Prisma
    return this.storageService.deleteFile(id);
  }


    @Post('detalle/:expedienteId')
    @Roles('DOCTOR')
    @ApiOperation({ summary: 'Crea un nuevo detalle para un expediente existente. '})
    @ApiResponse({ status: 201, description: 'Detalle creado exitosamente. '})
    @ApiResponse({ status: 400, description: 'Conflicto de IDs entre la ruta y el cuerpo. '})
    @ApiResponse({ status: 404, description: 'El expediente o doctor no existe. '})
    async crearDetalle(
        @Param ('expedienteId', ParseIntPipe) expedienteId: number,
        @Body() data: CreateExpedienteDetalleDto,
    ){
        if(data.expedienteId !== expedienteId){
            throw new BadRequestException(
                `El 'expedienteId' en la ruta (${expedienteId}) no coincide con el 'expedienteId' en el cuerpo (${data.expedienteId}).`,
            );
        }

        // llamar al servicio, pasando el DTO
        //la logica de verificar existencia de expediente y doctor esta en el servicio.
        const nuevoDetalle = await this.expedienteService.crearExpedienteDetalle(
            data,
        );

        return{
            message: 'Detalle de expediente creado exitosamente. ',
            data: nuevoDetalle,
        };
    }
}