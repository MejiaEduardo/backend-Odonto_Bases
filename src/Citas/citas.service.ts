import { Injectable } from "@nestjs/common";
import { CreateCitaDto } from "./dto/create.citas.dto";
import { UpdateCitaDto } from "./dto/update.citas.dto";
import { HorarioLaboral } from "../Enums/enums";
import { HistorialCancelaDto } from "./dto/historial-cancelaciones.dto";

function normalizarHora (hora: string): string{
    if (!hora) return '';
    if(hora.startsWith('H')){
        return hora.replace('H','').replace('_',':');
    }
    return hora;
}

@Injectable()
export class CitasService{
    


    
}