import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFacturaDto {
  @ApiProperty({ description: 'Cita completada que se va a facturar' })
  @IsInt()
  @Type(() => Number)
  citaId: number;

  @ApiPropertyOptional({ description: 'Descuento aplicado, en lempiras' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentos?: number;

  /**
   * RTN del cliente. Obligatorio cuando el total supera L.100.
   *
   * Si no viene, se usa el que la persona tenga registrado. Si tampoco lo
   * tiene, la emision falla con un mensaje claro en vez de que la restriccion
   * de la base tire un error incomprensible.
   */
  @ApiPropertyOptional({ description: 'RTN del cliente (14 dígitos)' })
  @IsOptional()
  @IsString()
  @Matches(/^[\d-\s]{14,20}$/, {
    message: 'El RTN debe tener 14 dígitos.',
  })
  rtnCliente?: string;
}

export class AnularFacturaDto {
  @ApiProperty({ description: 'Por qué se anula la factura' })
  @IsString()
  motivo: string;
}
