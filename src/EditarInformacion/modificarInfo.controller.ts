import {
    Controller, Get, Patch, Body, BadRequestException, ForbiddenException,
    HttpException, Param, Query, Req,
} from "@nestjs/common";
import { ModificarInfoService } from "./modificarInfo.service";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { UpdateModificarInfoDto } from "./dtoModificar/update.modificarInfo";
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';
import { UseGuards } from '@nestjs/common/decorators/core/use-guards.decorator';

/**
 * Lo que la estrategia JWT deja en `req.user`: el contenido del token,
 * que se firma en auth.service como { id, correo, rol }.
 */
interface PeticionConUsuario {
    user?: { id?: number; correo?: string; rol?: string };
}

/** Compara dos correos como lo hace la base: sin distinguir mayusculas. */
function mismoCorreo(a?: string, b?: string): boolean {
    return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}


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

    /**
     * Actualiza los datos de un cliente.
     *
     * Lo usan DOS pantallas distintas:
     *   - Recepcion, editando la ficha de cualquier paciente.
     *   - El propio paciente, desde "Editar Perfil".
     *
     * Antes solo permitia RECEPCIONISTA, asi que al paciente le devolvia un
     * 403 y no podia editar ni sus propios datos.
     *
     * OJO: no alcanza con agregar CLIENTE a la lista de roles. El correo va
     * en la URL, asi que sin la comprobacion de abajo cualquier paciente
     * podria cambiarle el DNI -- o la CONTRASENA -- a otro con solo poner su
     * correo. Un CLIENTE solo puede tocar su propio perfil.
     */
    @Patch(':correo')
    @Roles('RECEPCIONISTA', 'ADMIN', 'CLIENTE')
    @ApiResponse({ description: "Actualizar la informacion del cliente por corrreo"})
    @ApiResponse({ status: 200, description: "Informacion del cliente actualizada correctamente"})
    @ApiResponse({ status: 403, description: "Un cliente intento editar un perfil que no es el suyo"})
    @ApiResponse({ status: 404,description: "El cliente no existe o el correo no es valido"})
    async updateInfoByCorreo(
        @Param('correo') correo: string,
        @Body () data: UpdateModificarInfoDto,
        @Req() req: PeticionConUsuario,
    ){
        const usuario = req.user;

        if (usuario?.rol === 'CLIENTE' && !mismoCorreo(usuario.correo, correo)) {
            throw new ForbiddenException(
                'Solo podés editar tu propio perfil.',
            );
        }

        try{
            return await this.modificadorInfoService.completarDatosPorCorreo(correo, data);
        } catch (error) {
            /*
             * Las excepciones de Nest ya traen su codigo y su mensaje
             * (404 "Usuario no encontrado", 400 "El DNI ya esta en uso"...).
             * Antes se envolvian todas en un BadRequest, asi que un 404 salia
             * como 400 y se perdia el motivo.
             */
            if (error instanceof HttpException) throw error;
            throw new BadRequestException ((error as Error).message);

        }
    }

}
