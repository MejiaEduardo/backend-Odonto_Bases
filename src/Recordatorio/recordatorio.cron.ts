import { Injectable, OnModuleInit } from '@nestjs/common'; 
import { Cron, Interval } from '@nestjs/schedule';
import { RecordatorioService } from './recordatorio.service';

@Injectable()
// Implementamos OnModuleInit para la ejecución al inicio
export class RecordatorioCron /*implements OnModuleInit*/ { 
  constructor(private recordatorioService: RecordatorioService) {

  }

  async onModuleInit() {
    console.log('--- [TEST] Ejecutando recordatorios al inicio del servidor...');
    // llama al metodo principal para delegar las tareas a RabbitMQ
    await this.ejecutarCron(); 
    console.log('--- [TEST] Finalizada la ejecución inicial.');
  }

  //@Cron('0 8,20 * * *') // A las 8 AM y 8 PM todos los días

  @Interval(1000*60)// Cada minuto para pruebas
  async ejecutarCron() {
    console.log('CRON: Revisando recordatorios (8 AM y 8 PM)...');
    // Este método ya está optimizado para hacer SELECT, emit a RabbitMQ y UPDATE.
    await this.recordatorioService.procesarRecordatorios();
  }
}