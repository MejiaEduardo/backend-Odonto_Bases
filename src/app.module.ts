import { Module } from '@nestjs/common';
import { ServiciosModule } from './Servicios/Servicios.module';
import { DatabaseModule } from './database/database.module';
import { CitasModule } from './Citas/citas.module';


@Module({
  imports: [ServiciosModule, DatabaseModule, CitasModule]
})
export class AppModule {}
