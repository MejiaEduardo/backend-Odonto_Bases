// src/servicios/dto/create_servicios.dto.ts
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiciosDto {
  @ApiProperty({ description: 'Nombre del servicio' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Descripción del servicio',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  descripcion?: string;

  @ApiProperty({ description: 'Precio del servicio' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio debe ser un número con máximo 2 decimales' },
  )
  @Min(0.01, { message: 'El precio debe ser mayor a cero' })
  precio!: number;

  @ApiPropertyOptional({ description: 'Estado del servicio', required: false })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @ApiProperty({
    description: 'IDs de las especialidades asociadas al servicio',
    type: [Number], // Documentación para Swagger
    example: [1, 5],
  })
  @IsArray() // Debe ser un array
  @IsInt({
    each: true,
    message: 'Cada elemento en especialidadIds debe ser un número entero',
  }) // Cada elemento del array debe ser un entero (son IDs)
  @ArrayMinSize(1, {
    message: 'Se debe seleccionar al menos una especialidad para el servicio.',
  }) // Asegura que se envíe al menos un ID
  especialidadIds!: number[];
}