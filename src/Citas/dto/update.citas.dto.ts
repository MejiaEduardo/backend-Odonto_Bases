import { PartialType } from "@nestjs/swagger";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { CreateCitaDto } from "./create.citas.dto";
import { HorarioLaboral } from "../../Enums/enums";
import { EstadoCita } from "../../Enums/enums";


export class UpdateCitaDto extends PartialType(CreateCitaDto){
     @ApiPropertyOptional({ description: 'Fecha de la cita' })
  fecha?: string;

  @ApiPropertyOptional({ description: 'Estado de la cita', enum: EstadoCita })
  estado?: EstadoCita = EstadoCita.PENDIENTE;

  @ApiPropertyOptional({
    description: 'Horario de la cita',
    enum: HorarioLaboral,
  })
  hora?: HorarioLaboral;

  @ApiPropertyOptional({ description: 'Paciente asociado a la cita' })
  pacienteId?: number;

  @ApiPropertyOptional({ description: 'Doctor asociado a la cita' })
  doctorId?: number;

  @ApiPropertyOptional({ description: 'Servicio asociado a la cita' })
  servicioId?: number;
}