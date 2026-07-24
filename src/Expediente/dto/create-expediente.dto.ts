import { IsBoolean, IsInt, IsOptional, IsString }from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExpedienteDto {
    @ApiProperty ({ description:' ID del paciente'})
    @IsInt()
    pacienteId: number;

    @ApiProperty({ description: 'ID del doctor'})
    @IsInt()
    doctorId?: number;

    @ApiProperty ({ description: 'Alergias del paciente', required: false })
    @IsOptional()
    @IsString()
    alergias?: string;

    @ApiPropertyOptional ({ description: 'Enfermedades del paciente', required: false })
    @IsOptional()
    @IsString()
    enfermedades?: string;

    @ApiPropertyOptional({ description: ' Medicamentos que toma el paciente',required: false })
    @IsOptional()
    @IsString()
    medicamentos?: string;

    @ApiPropertyOptional({ description: ' Observaciones adicionales', required: false})
    @IsOptional()
    @IsString()
    observaciones?: string;

    @ApiPropertyOptional({ description: 'Indica si el expediene esta activo', required: false})
    @IsOptional()
    @IsBoolean()
    activo?: boolean;
}