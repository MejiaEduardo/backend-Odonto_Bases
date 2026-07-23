import { PartialType } from "@nestjs/mapped-types";
import { ApiPropertyOptional, ApiPropertyOptions } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString } from "class-validator";

export class UpdateModificarInfoDto {
    @IsString()
    @IsOptional()
    nombre?: string;

    @IsString()
    @IsOptional()
    dni?: string

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