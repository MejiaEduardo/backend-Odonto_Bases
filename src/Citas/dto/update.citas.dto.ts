import { PartialType } from "@nestjs/swagger";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { CreateCitaDto } from "./create.citas.dto";
import { HorarioLaboral } from "../../Enums/enums";
import { EstadoCita } from "../../Enums/enums";


export class UpdateCitaDto extends PartialType(CreateCitaDto){
     @ApiPropertyOptional({ description: 'Fecha de la cita' })
  fecha?: string;

  /*
    OJO: sin valor por defecto a proposito. Con `transform: true` en el
    ValidationPipe, un default aqui se aplicaria aunque el cliente no envie
    el campo, y toda edicion resetearia el estado a PENDIENTE en silencio.
    Si no viene, el service conserva el estado actual.
  */
  @ApiPropertyOptional({ description: 'Estado de la cita', enum: EstadoCita })
  estado?: EstadoCita;

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