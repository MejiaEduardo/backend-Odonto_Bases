import { 
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable ()
@WebSocketGateway({

    cors: {
        origin: 'http://localhost:5173',
        credentials: true,
    },
})
export class NotificationGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
    @WebSocketServer() private server: Server;

    constructor (private jwtService: JwtService) {}

    getServer(): Server{
        return this.server;
    }

    //METODO CLICO DE VIDA
    afterInit(server: Server) {
        console.log ('Notification Gateway inicializado.');
    }
    async handleConnection(client: Socket, ...args: any[]){
        const token = client.handshake.query.token as string;

        if(!token) {
            console.log(`Conexion rechazada: Token no proporcionado. ID: ${client.id}`);
            return client.disconnect(); //desconectar si no hay token
        }

        try {
            //verificr que el token jrt usa tu secreto configurado en jwtmodule, el metodo verify decodifica y valida la firma
            const payload = await this.jwtService.verifyAsync(token);
            // obtener el id del usuario desde el payload verificado authservice usa id como clave para el id del usuario
            const userId = payload.id as number;

            if (!userId) {
                throw new Error ('Payload JWT no contiene ID de usuario valido. ');
            }

            //autenticacion exitosa: unir a la sala de usuario
            client.join (`user-${userId}`);

            console.log(`Cliente conectado y autenticado: ${client.id}`)
        } catch (error) {
            //si la verificacion falla (token no valido, expirado o error de decodificacion )
            console.log(`Conexion rechazada: Token no valido/expirado. ID: ${client.id}`);
            console.log(`Detalle del error: ${(error as Error).message}`);
            client.disconnect(); //desconectar si el token es invalido
        }
    }
    
    handleDisconnect(client: Socket){
        console.log(`Cliente WebSocket Desconectado: ${client.id}`)
    }
}
