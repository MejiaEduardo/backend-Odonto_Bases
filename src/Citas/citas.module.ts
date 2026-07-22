import { Module } from "@nestjs/common";
import { CitasController } from "./citas.controller";
import { CitasService } from "./citas.service";




@Module({
    imports: [],
    controllers: [CitasController],
    providers: [CitasService],
})
export class CitasModule{}