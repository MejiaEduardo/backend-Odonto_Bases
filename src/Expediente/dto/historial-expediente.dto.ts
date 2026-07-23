import { ApiProperty } from '@nestjs/swagger';

export class HistorialArchivoDTo{
    @ApiProperty()
    nombreArchivo: string;

    @ApiProperty()
    url: string;

    @ApiProperty({ required: false })
    tipoArchivo?: string;

    @ApiProperty({ required: false })
    creadorPor?: string;
}

export class HistoriaDetalleDto{
    @ApiProperty()
    fecha: Date;

    @ApiProperty({ required: false })
    motivo?: string;

    @ApiProperty({ required: false })
    diagnostico?: string;

    @ApiProperty({ required: false })
    tratamiento?: string;

    @ApiProperty({ required: false})
    planTratamiento?: string;

    @ApiProperty({ required: false })
    doctorNombre?: string;

    @ApiProperty ({ type: [HistorialArchivoDTo], required: false })
    archivos?: HistorialArchivoDTo[]

}    