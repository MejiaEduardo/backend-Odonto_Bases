import { Module } from '@nestjs/common';
import { EmpleadoService } from './empleado.service';
import { EmpleadoController } from './empleado.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../Auth/auth.module'; 

@Module({
    controllers: [EmpleadoController],
    providers: [EmpleadoService],
    imports: [
        DatabaseModule,
        AuthModule, // 2. Agrégalo en los imports
    ],
})
export class EmpleadoModule {}