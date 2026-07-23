import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Put, BadRequestException } from '@nestjs/common';
import { EmpleadoService } from './empleado.service';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateEmpleadoDto } from './dtoempleado/create-empleado.dto';
import { UpdateEmpleadoDto } from './dtoempleado/update-empleado.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UseGuards } from '@nestjs/common/decorators/core/use-guards.decorator';

@ApiTags ('Empleado')
@Controller('empleado')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmpleadoController {
    constructor(private readonly empleadoService: EmpleadoService) {}

// crea empleado

@Post()
@Roles('ADMIN')
@ApiResponse({ status: 201, description: 'Persona, empleado y usario creados correctamente' })
@ApiResponse({ status: 400, description: 'Error al crear los registros' })
async create(@Body() dto: CreateEmpleadoDto) {
    try{
        const result = await this.empleadoService.createEmpleado(dto);

        return{
            message: 'Empleado creado correctamente',
            data: result,
        };
    } catch (error) {
      throw new BadRequestException(`${error.message}`);
    }
} 

//obtener todos los empleados

@Get()
@Roles('ADMIN')
@ApiResponse({ description: 'Obtener todos los empleados registrados con sus datos personales y de usuario' })
async findOne(@Param('id', ParseIntPipe) id: number) {
    const empleado = await this.empleadoService['prisma'].empleado.findUnique({
        where: { id },
    });
    if (!empleado) {
        return {
            message: `Empleado con ID ${id}no encontrado`,   
        };
    }
    return {
        message: `Empleado con ID ${id} encontrado correctamente`,
        data: empleado,
    };
}

//actualizar empleado

@Put(':id')
@Roles('ADMIN')
@ApiResponse({ status: 200, description: 'Empleadoactualizado correctamente' })
@ApiResponse({ status: 404, description: 'Empleado no encontrado' })
async update(@Param('id', ParseIntPipe) id: number, @Body() UpdateEmpleadoDto: UpdateEmpleadoDto) 
    { try {
        const empleado = await this.empleadoService.UpdateEmpleado(id, UpdateEmpleadoDto);

        return {
            message: `Empleado con ID ${id} actualizado correctamente (incluye persona y usuario)`,
            data: empleado,
        };
    } catch (error) {
        throw new BadRequestException(`${error.message}`);
    }
    }

}


















}