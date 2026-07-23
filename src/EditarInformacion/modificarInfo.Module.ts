import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ModificadorInfoController } from "./modificarInfo.controller";

@Module({
    controllers: [ModificadorInfoController],
    providers: [ModificadorInfoController],
    imports:[DatabaseModule]

})
export class ModificarInfoModule {}