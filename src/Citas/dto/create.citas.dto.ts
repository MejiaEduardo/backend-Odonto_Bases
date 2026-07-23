import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsEnum, IsString } from "class-validator";
import { HorarioLaboral } from "../../Enums/enums";
import { EstadoCita } from "../../Enums/enums";

// horarioLaboral
// EstadoCita
export class CreateCitaDto{
    @IsString()
    fecha!: string;

    @ApiProperty({enum: EstadoCita, default: EstadoCita.PENDIENTE})
    @IsEnum(EstadoCita)
    estado?: EstadoCita = EstadoCita.PENDIENTE;

    @ApiProperty({enum: HorarioLaboral})
    @IsEnum(HorarioLaboral)
    hora!: HorarioLaboral;

    @ApiProperty({
    description: 'ID del paciente asociado a la cita',
    example: 1,
  })
  @IsInt({ message: 'El ID del paciente debe ser un número entero' })
  pacienteId!: number;

  @ApiProperty({
    description: 'ID del doctor que atenderá la cita',
    example: 2,
  })
  @IsInt({ message: 'El ID del doctor debe ser un número entero' })
  doctorId!: number;

  @ApiProperty({
    description: 'ID del servicio clínico solicitado',
    example: 3,
  })
  @IsInt({ message: 'El ID del servicio debe ser un número entero' })
  servicioId!: number;
}