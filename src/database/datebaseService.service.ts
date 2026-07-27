import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  // Se inicializa en el constructor, no en onModuleInit,
  // para que otros servicios puedan usar `this.db.pool` sin problemas de orden.
  public readonly pool: Pool;

  constructor(private config: ConfigService) {

     console.log('DB_HOST:', this.config.get('DB_HOST'));
  console.log('DB_PORT:', this.config.get('DB_PORT'));
  console.log('DB_USER:', this.config.get('DB_USER'));
  console.log('DB_PASSWORD:', this.config.get('DB_PASSWORD'));
  console.log('DB_NAME:', this.config.get('DB_NAME'));


    this.pool = new Pool({
      host: this.config.get<string>('DB_HOST'),
      port: this.config.get<number>('DB_PORT'),
      user: this.config.get<string>('DB_USER'),
      password: this.config.get<string>('DB_PASSWORD'),
      database: this.config.get<string>('DB_NAME'),

      max: 10, // máximo de conexiones simultáneas en el pool
      idleTimeoutMillis: 30000, // cierra conexiones inactivas tras 30s
      connectionTimeoutMillis: 5000, // falla si no logra conectar en 5s
    });

    this.pool.on('error', (err) => {
      // Errores en clientes inactivos del pool (conexiones que Postgres cerró, etc.)
      this.logger.error('Error inesperado en el pool de pg', err);
    });
  }

  async onModuleInit() {
    // Verifica la conexión al arrancar la app, para fallar rápido si algo está mal
    try {
      const client = await this.pool.connect();
      client.release();
      this.logger.log('Conexión a PostgreSQL establecida correctamente');
    } catch (error) {
      this.logger.error('No se pudo conectar a PostgreSQL', error as Error);
      throw error;
    }
  }

  async onModuleDestroy() {
    // Cierra todas las conexiones del pool cuando la app se apaga
    await this.pool.end();
    this.logger.log('Pool de PostgreSQL cerrado');
  }
}