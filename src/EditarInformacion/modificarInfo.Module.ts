import { Module } from '@nestjs/common';
import { ModificadorInfoController } from "./modificarInfo.controller";
import { ModificarInfoService } from "./modificarInfo.service";

@Module({
    controllers: [ModificadorInfoController],
    providers: [ModificarInfoService],
})
export class ModificarInfoModule {}