import { Controller, Get, Patch, Body, BadRequestException,Param,Query} from "@nestjs/common";
import { ModificarInfoService } from "./modificarInfo.service";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { UpdateModificarInfoDto } from "./dtoModificar/update.modificarInfo";
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UseGuards } from '@nestjs/common/decorators/core/use-guards.decorator';


@ApiTags('Modificar')
@Controller('Modificar')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ModificadorInfoController {
    constructor(private readonly modificadorInfoService: ModificarInfoService) {}

    // get para obtener un usuarion por corro deni o telefono

    @Get('buscar')
    @Roles('RECEPCIONISTA')
    @ApiResponse({ description: "Obtener el cliente por correo DNI o telefono"})
    @ApiResponse ({ status: 200, description: "Cliente encontrado correctamente"})
    @ApiResponse ({ status: 404, description: "El cliente no existe o el criterio es invalido"})
    async findOneByCriterion(
        @Query('tipo') tipo:string ,
        @Query('valor') valor:string
    ) {
        if (!tipo || !valor ) {
            throw new BadRequestException("Debe proporcionar un tipo y un valor para la busqueada.");
        }
        let usuario;

        switch (tipo.toLowerCase()) {
            case 'correo':
                usuario =await this.modificadorInfoService.buscarPorCorreo(valor);
                break;
            case 'dni':
                usuario = await this.modificadorInfoService.buscarPorDni(valor);
                break;
            case 'telefono':
                usuario = await this.modificadorInfoService.buscarPorTelefono(valor);
                break;
            default:
                throw new BadRequestException(`Tipo de busqueda '${tipo}' no soportado. Use 'correo', 'dni' o 'telefono'.`);
        }   
        
        



        return {
            message: `Cliente con ${tipo} ${valor} encontrado correctamente`,
            data: usuario,
        }
    }

    //PUT para completar datos por correo

    @Patch(':correo')
    @Roles('RECEPCIONISTA')
    @ApiResponse({ description: "Actualizar la informacion del cliente por corrreo"})
    @ApiResponse({ status: 200, description: "Informacion del cliente actualizada correctamente"})
    @ApiResponse({ status: 404,description: "El cliente no existe o el correo no es valido"})
    async updateInfoByCorreo(
        @Param('correo') correo: string,
        @Body () data: UpdateModificarInfoDto,
    ){
        try{
            return await this.modificadorInfoService.completarDatosPorCorreo(correo, data);
        } catch (error) {
            throw new BadRequestException (error.message);

        }
    }

}
