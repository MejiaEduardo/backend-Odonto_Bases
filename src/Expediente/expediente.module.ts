import { Module } from '@nestjs/common';
import { ExpedienteService } from './expediente.service';
import { ExpedienteController } from './expediente.controller';
import { FirebaseModule } from '../FireBase/firebase.Module';

@Module({
  controllers: [ExpedienteController],
  providers: [ExpedienteService],
  imports: [FirebaseModule],
})
export class ExpedienteModule {}