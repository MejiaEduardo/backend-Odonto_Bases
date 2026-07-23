import { Module } from '@nestjs/common';
import { EmpleadoService } from './empleado.service';
import { EmpleadoController } from './empleado.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
    controllers: [EmpleadoController],
    providers: [EmpleadoService],
    imports: [DatabaseModule],
})
export class EmpleadoModule {}