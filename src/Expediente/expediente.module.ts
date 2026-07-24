import { Module } from '@nestjs/common';
import { ExpedienteService } from './expediente.service';
import { ExpedienteController } from './expediente.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  controllers: [ExpedienteController],
  providers: [ExpedienteService],
  imports: [DatabaseModule],
})
export class ExpedienteModule {}