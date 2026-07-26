import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDate, IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmpleadoDto {
  // Datos de la Persona
  @ApiProperty({ description: 'Nombre de la persona' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ description: 'Apellido de la persona' })
  @IsString()
  @IsNotEmpty()
  apellido: string;

  @ApiProperty({ description: 'DNI de la persona' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ description: 'Teléfono de la persona' })
  @IsString()
  @IsNotEmpty()
  telefono: string;

  @ApiProperty({ description: 'Dirección de la persona' })
  @IsString()
  @IsNotEmpty()
  direccion: string;

  @ApiProperty({ description: 'Fecha de nacimiento de la persona' })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  fechaNac: Date;

  // Datos del Empleado
  @ApiProperty({ description: 'Estado del empleado' })
  @IsBoolean()
  @IsNotEmpty()
  activo: boolean;

  @ApiProperty({ description: 'Puesto del empleado' })
  @IsString()
  @IsNotEmpty()
  puesto: string;

  @ApiProperty({ description: 'Salario del empleado' })
  @IsNumber()
  @IsNotEmpty()
  salario: number;

  @ApiProperty({ description: 'Fecha de ingreso del empleado' })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  fechaIngreso: Date;

  // Datos del Usuario
  @ApiProperty({ description: 'Correo del usuario' })
  @IsEmail()
  @IsNotEmpty()
  correo: string;

  @ApiProperty({ description: 'Contraseña del usuario' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ description: 'Rol del usuario' })
  @IsString()
  @IsNotEmpty()
  rol: string;

  @ApiPropertyOptional({ description: 'Estado del usuario' })
  @IsOptional()
  @IsBoolean()
  usuarioActivo?: boolean;

  /**
   * Especialidades del empleado. Solo aplica cuando el puesto es DOCTOR.
   *
   * El frontend ya enviaba este campo, pero el DTO no lo declaraba y el
   * ValidationPipe (forbidNonWhitelisted: true) rechazaba la petición con
   * "property especialidadIds should not exist".
   */
  @ApiPropertyOptional({
    description: 'IDs de las especialidades del doctor',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true, message: 'Cada especialidad debe ser un ID numérico' })
  @Type(() => Number)
  especialidadIds?: number[];
}

