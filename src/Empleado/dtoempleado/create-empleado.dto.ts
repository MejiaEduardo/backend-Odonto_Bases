import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDate, IsEmail, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEmpleadoDto {
  // --- Datos de la Persona -------------------------------------------------
  // La base guarda cuatro columnas de nombre. El segundo nombre y el segundo
  // apellido son OPCIONALES.

  @ApiPropertyOptional({ description: 'Primer nombre de la persona' })
  @IsOptional()
  @IsString()
  primerNombre?: string;

  @ApiPropertyOptional({ description: 'Segundo nombre (opcional)' })
  @IsOptional()
  @IsString()
  segundoNombre?: string;

  @ApiPropertyOptional({ description: 'Primer apellido de la persona' })
  @IsOptional()
  @IsString()
  primerApellido?: string;

  @ApiPropertyOptional({ description: 'Segundo apellido (opcional)' })
  @IsOptional()
  @IsString()
  segundoApellido?: string;

  /**
   * Campos viejos. Se aceptan por compatibilidad: si vienen sin los cuatro
   * nuevos, el servicio los parte ('Juan Carlos' -> 'Juan' + 'Carlos').
   */
  @ApiPropertyOptional({ description: 'Nombre completo (formato antiguo)' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ description: 'Apellidos (formato antiguo)' })
  @IsOptional()
  @IsString()
  apellido?: string;

  @ApiProperty({ description: 'DNI de la persona' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiPropertyOptional({ description: 'RTN de la persona (14 dígitos)' })
  @IsOptional()
  @IsString()
  rtn?: string;

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

