import { IsInt, IsNotEmpty, IsString } from "class-validator";

export class HistorialCancelaDto {

    @IsNotEmpty()
    @IsString()
    motivoCancelacion!: string;

    @IsNotEmpty()
    @IsInt()
    usuarioCancelaId!: number;

    @IsString()
    @IsNotEmpty()
    rolCancela!:  'ADMIN' | 'DOCTOR' | 'RECEPCIONISTA' | 'CLIENTE';


}