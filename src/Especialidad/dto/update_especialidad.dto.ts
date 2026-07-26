import { PartialType } from '@nestjs/swagger';
import { CreateEspecialidadDto } from './create_especialidad.dto';

/** Todos los campos son opcionales al actualizar. */
export class UpdateEspecialidadDto extends PartialType(CreateEspecialidadDto) {}
