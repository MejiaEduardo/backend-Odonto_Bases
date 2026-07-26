import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEspecialidadDto {
  @ApiProperty({ description: 'Nombre de la especialidad' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  @ApiPropertyOptional({ description: 'Descripción de la especialidad' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;
}
