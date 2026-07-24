import { Module, Global } from "@nestjs/common";
import { RecordatorioService } from "./recordatorio.service";
import { RecordatorioCron } from "./recordatorio.cron";
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from "@nestjs/schedule";

@Global()
@Module({
    providers:[RecordatorioService, RecordatorioCron],
    imports:[ConfigModule.forRoot(),
        ScheduleModule.forRoot(),
    
        ClientsModule.register([
            {
              
                name: 'SCHEDULER_QUEUE_SERVICE', 
                transport: Transport.RMQ,
                options: {
                    // URL de tu servidor RabbitMQ
                    urls: ['amqp://localhost:5672'], 
                     
                    // Nombre de la cola (debe coincidir con el Consumidor)
                    queue: 'scheduler_jobs_queue', 
                    queueOptions: {
                        durable: true
                    },
                },
            },
        ])
    ]    
})
export class RecordatorioModule{}