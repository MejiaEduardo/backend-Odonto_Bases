import { PartialType } from '@nestjs/mapped-types';
import { CreateEmpleadoDto } from './create-empleado.dto';
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateEmpleadoDto extends PartialType(CreateEmpleadoDto) {
 
}
