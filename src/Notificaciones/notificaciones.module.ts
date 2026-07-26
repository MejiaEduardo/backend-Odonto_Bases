import { Global, Module } from '@nestjs/common'
import { NotificationService } from './notificaciones.service';
import { NotificationGateway } from './notificaciones.gateway';
import { JwtModule } from '@nestjs/jwt'

@Global() // hace que este disponible en toda la app
@Module({

    imports: [JwtModule.register({
        /*
         * DEBE ser el MISMO secreto que AuthModule, si no el WebSocket
         * rechaza todos los tokens con "invalid signature".
         *
         * Antes estaba escrito 'secret' literal mientras que AuthModule usa
         * process.env.JWT_SECRET, así que ningún token válido pasaba y la
         * consola se llenaba de "Conexion rechazada: Token no valido/expirado".
         */
        secret: process.env.JWT_SECRET || 'secreto',
        signOptions: { expiresIn: '1h'},
    })],
    providers: [NotificationService,NotificationGateway],
    exports: [NotificationService, NotificationGateway],
})
export class NotificacionesModule{}