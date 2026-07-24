import { PartialType } from "@nestjs/swagger";
import { CreateExpedienteDto }from './create-expediente.dto'
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateExpedienteDto extends PartialType(CreateExpedienteDto) {
    @ApiPropertyOptional({ description: 'Alergias del paciente'})
    alergias?: string;

    @ApiPropertyOptional({ description: 'Enfermedades del paciente'})
    enfermedades?: string;

    @ApiPropertyOptional({ description: 'Medicamentos que toma el paciente'})
    medicamentos?: string;

    @ApiPropertyOptional({ description: 'Observaciones adicionales'})
    observaciones?: string;
}