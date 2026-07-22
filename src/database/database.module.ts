import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './datebaseService.service';

// @Global() hace que DatabaseService esté disponible en toda la app
// sin tener que importar DatabaseModule en cada módulo de feature (servicios, citas, etc.)
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}