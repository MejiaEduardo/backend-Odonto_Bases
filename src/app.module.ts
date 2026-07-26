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
import { EspecialidadModule } from './Especialidad/especialidad.module';
import { FacturaModule } from './Factura/factura.module';
import { ConfigModule } from '@nestjs/config';
import googleOauthConfig from './Auth/config/google-oauth.config';

@Module({
  imports: [
    /*
     * GoogleStrategy pide su configuracion con @Inject(googleOauthConfig.KEY),
     * y eso solo funciona si ConfigModule la carga. Sin esto, el proveedor
     * no existe y Nest no puede construir la estrategia.
     */
    ConfigModule.forRoot({ isGlobal: true, load: [googleOauthConfig] }),
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
    EspecialidadModule,
    FacturaModule,
    /*
     * AuthModule estaba importado arriba pero NO listado aqui: llegaba a la
     * aplicacion de rebote, porque EmpleadoModule lo importa. Si alguien
     * tocaba ese modulo, se caia el login entero sin razon aparente.
     */
    AuthModule,
  ],
})
export class AppModule {}