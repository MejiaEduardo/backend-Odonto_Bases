import { Global, Module } from '@nestjs/common'
import { NotificationService } from './notificaciones.service';
import { NotificationGateway } from './notificaciones.gateway';
import { JwtModule } from '@nestjs/jwt'

@Global() // hace que este disponible en toda la app
@Module({

    imports: [JwtModule.register({
        secret: 'secret', //asegura de usar el mismo secreto que en authmodule
        signOptions: { expiresIn: '1h'},
    })],
    providers: [NotificationService,NotificationGateway],
    exports: [NotificationService, NotificationGateway],
})
export class NotificacionesModule{}