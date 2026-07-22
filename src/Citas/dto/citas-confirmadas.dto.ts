import { IsInt, IsNotEmpty } from "class-validator";
import { Type } from "class-transformer";


export class CitasConfrimadasDto{
    @Type(()=>Number)
    @IsNotEmpty()
    @IsInt()
    pacienteId!:number;

    @Type(()=> Number)
    @IsNotEmpty()
    @IsInt()
    doctorId!: number
}