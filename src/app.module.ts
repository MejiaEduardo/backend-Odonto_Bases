import { Module } from '@nestjs/common';
import { ServiciosModule } from './Servicios/Servicios.module';
import { DatabaseModule } from './database/database.module';
import { CitasModule } from './Citas/citas.module';
import { NotificacionesModule } from './Notificaciones/notificaciones.module';
import { EmpleadoModule } from './Empleado/empleado.module';
import { ModificarInfoModule } from './EditarInformacion/modificarInfo.Module';
import { FirebaseModule } from './FireBase/firebase.Module';
import { LogsModule } from './logs/logs.module';
import { ExpedienteModule } from './Expediente/expediente.module';
import { RecordatorioModule } from './Recordatorio/recordatorio.module';
import { AuthModule } from './Auth/auth.module';

@Module({
  imports: [
    ServiciosModule,
    DatabaseModule,
    CitasModule,
    NotificacionesModule,
    EmpleadoModule,
    ModificarInfoModule,
    FirebaseModule,
    LogsModule,
    ExpedienteModule,
    RecordatorioModule,
  ],
})
export class AppModule {}