import { Module } from '@nestjs/common';
import { FacturaController } from './factura.controller';
import { FacturaService } from './factura.service';

// DatabaseModule es @Global(), así que DatabaseService ya está disponible.
@Module({
  imports: [],
  providers: [FacturaService],
  controllers: [FacturaController],
  exports: [FacturaService],
})
export class FacturaModule {}
