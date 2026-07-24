import { IsInt, IsOptional, IsString, IsDateString, isString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExpedienteDetalleDto {
    @ApiProperty({ description: 'ID del expediente al que pertenece este detalle.'})
    @IsInt()
    expedienteId: number;

    @ApiProperty({
        description: 'fecha de la consulta o evento del detalle del expediente (formato ISO 8601).',
        example: '2026-07-15T14:30:00Z',
    })
    @IsString()
    fecha: string;

    @ApiPropertyOptional({
        description: 'Motivo de la consulta o visita.',
        nullable: true,
    })
    @IsOptional()
    @IsString()
    motivo?: string;

    @ApiPropertyOptional({
        description: 'Diagnostico principal.',
        nullable: true,
    })
    @IsOptional()
    @IsString()
    diagnostico?: string;

    @ApiPropertyOptional({
        description:'Tratamiento aplicado durante la consulta.',
        nullable: true,   
    })
    @IsOptional()
    @IsString()
    tratamiento?: string;

    @ApiPropertyOptional({
        description: 'Plan de tratamiento futuro o recomendaciones.',
        nullable: true,
   })
   @IsOptional()
   @IsString()
   planTratamiento?: string;

   @ApiPropertyOptional({
    description:'ID del medico que atendio el detalle.',
   })
   @IsOptional()
   @IsInt()
   doctorId: number;

}