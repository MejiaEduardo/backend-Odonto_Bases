import { PartialType } from "@nestjs/mapped-types";
import { ApiPropertyOptional, ApiPropertyOptions } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString } from "class-validator";

export class UpdateModificarInfoDto {
    // Los cuatro campos de nombre. El segundo nombre y el segundo apellido
    // son opcionales: mandarlos como cadena vacia los borra.
    @IsString()
    @IsOptional()
    primerNombre?: string;

    @IsString()
    @IsOptional()
    segundoNombre?: string;

    @IsString()
    @IsOptional()
    primerApellido?: string;

    @IsString()
    @IsOptional()
    segundoApellido?: string;

    /** Formato antiguo, aceptado por compatibilidad: se parte en dos. */
    @IsString()
    @IsOptional()
    nombre?: string;

    /** Formato antiguo, aceptado por compatibilidad: se parte en dos. */
    @IsString()
    @IsOptional()
    apellido?: string;

    @IsString()
    @IsOptional()
    dni?: string

    @IsString()
    @IsOptional()
    rtn?: string

    @IsString()
    @IsOptional()
    telefono?: string

    @IsString()
    @IsOptional()
    direccion?: string;

    @IsDateString()
    @IsOptional()
    fechaNac?: string;

    @IsString()
    @IsOptional()
    password?: string
}