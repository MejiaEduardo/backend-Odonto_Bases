import { Controller, Get, Post, Body, Param,Delete,Patch, HttpStatus, HttpException, ParseIntPipe } from "@nestjs/common";
import {ServiciosService} from './Servicios.service'
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CreateServiciosDto } from "./dto/create_servicios.dto";
import { UpdateServiciosDto } from "./dto/update_Servicios.dto";
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';
import { Public } from '../Auth/public.decorator';




const CODE_TO_HTTP_STATUS: Record<number, HttpStatus>={
    1: HttpStatus.BAD_REQUEST,
    2: HttpStatus.BAD_REQUEST,
    3: HttpStatus.CONFLICT,
    4: HttpStatus.NOT_FOUND,
    5: HttpStatus.CONFLICT,
    6: HttpStatus.CONFLICT,
    7: HttpStatus.BAD_REQUEST,
    500: HttpStatus.INTERNAL_SERVER_ERROR
};

@ApiTags('Servicios')
/*
 * El catalogo se lee sin iniciar sesion: la landing y /services son
 * publicas. Solo se protegen las escrituras, que son de ADMIN.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('Servicios')
export class ServiciosController{
    constructor(private readonly serviciosService: ServiciosService) {}


    private throwIfError(result: any) {
        if (result && typeof result === 'object' && 'code' in result && result.code !==0)
        {
            const  status = CODE_TO_HTTP_STATUS[result.code] ?? HttpStatus.BAD_REQUEST;
            throw new HttpException(result.message, status);
        }
        return result
    }


    @Get()
    @Public()
    @ApiOperation({summary: 'Listar todos los Servicios Clinicos'})
    @ApiResponse({status:200, description:'Lista de servivios Obtenidos correctamente'})
    async findAll(){
        return this.serviciosService.findAll();
    }


    @Get(':id')
    @Public()
    @ApiOperation({summary: 'obtener un servicio clinico por id'})
    @ApiResponse({status:200, description:'Servicio encontrado'})
    @ApiResponse({status:404, description:'Servicio no encontrado'})
    async findOne(@Param('id', ParseIntPipe)id:number){
        const result = await this.serviciosService.findOne(id);
        return this.throwIfError(result);
    }
    

    @Post()
    @Roles('ADMIN')
    @ApiOperation({summary: 'Crear un nuevo servicio clinico'})
    @ApiResponse({status:200, description: 'Servicio creado correctamente'})
    @ApiResponse({status: 400, description:'Datos invalidos'})
    @ApiResponse({status: 409, description: 'El servicio ya existe'})
    async create(@Body() CreateServiciosDto: CreateServiciosDto){
        const result = await this.serviciosService.createServicio(CreateServiciosDto);
        return this.throwIfError(result)
    }


    @Patch(':id')
    @Roles('ADMIN')
    @ApiOperation({ summary: 'Actualizar un servicio clinico existente'})
    @ApiResponse({status:200, description: 'Servicios Actualizado correctamente'})
    @ApiResponse({status:404, description: 'Servicio no encontrado'})
    @ApiResponse({status: 409, description: 'Nombre de Servicio duplicado'})
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateServiciosDto: UpdateServiciosDto,
    ){
        const result = await this.serviciosService.updateServicio(id, updateServiciosDto);
        return this.throwIfError(result);
    }

    @Delete(':id')
    @Roles('ADMIN')
    @ApiOperation({ summary: 'Eliminar un servicio clínico' })
    @ApiResponse({ status: 200, description: 'Servicio eliminado correctamente' })
    @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
    @ApiResponse({ status: 409, description: 'Tiene citas asociadas' })
    async remove(@Param('id', ParseIntPipe) id: number) {
        const result = await this.serviciosService.deleteServicio(id);
        return this.throwIfError(result);
    }

}