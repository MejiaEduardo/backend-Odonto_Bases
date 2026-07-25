import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Put, BadRequestException } from '@nestjs/common';
import { EmpleadoService } from './empleado.service';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateEmpleadoDto } from './dtoempleado/create-empleado.dto';
import { UpdateEmpleadoDto } from './dtoempleado/update-empleado.dto';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';
import { UseGuards } from '@nestjs/common/decorators/core/use-guards.decorator';

@ApiTags('Empleado')
@Controller('empleado')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmpleadoController {
    constructor(private readonly empleadoService: EmpleadoService) {}

    // Crear empleado
    @Post()
    @Roles('ADMIN')
    @ApiResponse({ status: 201, description: 'Persona, empleado y usuario creados correctamente' })
    @ApiResponse({ status: 400, description: 'Error al crear los registros' })
    async create(@Body() dto: CreateEmpleadoDto) {
        try {
            const result = await this.empleadoService.createEmpleado(dto);
            return {
                message: 'Empleado creado correctamente',
                data: result,
            };
        } catch (error) {
            throw new BadRequestException(`${(error as Error).message}`);
        }
    } 

// Obtener todos los empleados
    @Get()
    @Roles('ADMIN')
    @ApiResponse({ status: 200, description: 'Obtener todos los empleados registrados con sus datos personales y de usuario' })
    async findAll() {
        try {
            const empleados = await this.empleadoService.findAll();
            return {
                message: 'Empleados encontrados correctamente',
                data: empleados,
            };
        } catch (error) {
            throw new BadRequestException(`${(error as Error).message}`);
        }
    }

    // Obtener un empleado por ID
    @Get(':id')
    @Roles('ADMIN')
    @ApiResponse({ status: 200, description: 'Empleado encontrado correctamente' })
    @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
    async findOne(@Param('id', ParseIntPipe) id: number) {
        const empleado = await this.empleadoService['prisma'].empleado.findUnique({
            where: { id },
        });
        if (!empleado) {
            return {
                message: `Empleado con ID ${id} no encontrado`,   
            };
        }
        return {
            message: `Empleado con ID ${id} encontrado correctamente`,
            data: empleado,
        };
    }

    // Actualizar empleado
    @Put(':id')
    @Roles('ADMIN')
    @ApiResponse({ status: 200, description: 'Empleado actualizado correctamente' })
    @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateEmpleadoDto: UpdateEmpleadoDto) { 
        try {
            const empleado = await this.empleadoService.UpdateEmpleado(id, updateEmpleadoDto);
            return {
                message: `Empleado con ID ${id} actualizado correctamente (incluye persona y usuario)`,
                data: empleado,
            };
        } catch (error) {
            throw new BadRequestException(`${(error as Error).message}`);
        }
    }
}