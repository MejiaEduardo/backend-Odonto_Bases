import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';
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
}
