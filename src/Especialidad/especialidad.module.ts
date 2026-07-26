import { Module } from '@nestjs/common';
import { EspecialidadController } from './especialidad.controller';
import { EspecialidadService } from './especialidad.service';

// DatabaseModule es @Global(), así que DatabaseService ya está disponible
// sin importarlo aquí (mismo criterio que ServiciosModule).
@Module({
  imports: [],
  providers: [EspecialidadService],
  controllers: [EspecialidadController],
  exports: [EspecialidadService],
})
export class EspecialidadModule {}
