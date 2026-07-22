import { Module } from "@nestjs/common";
import { ServiciosController } from "./Servicios.controler";
import { ServiciosService } from "./Servicios.service";



@Module({
    imports: [],
    providers:[ServiciosService],
    controllers : [ServiciosController],
})
export class ServiciosModule{}