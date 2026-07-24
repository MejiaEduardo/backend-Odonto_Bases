import { ApiTags } from '@nestjs/swagger';
import { LogsService } from './logs.service';
import { Post, Param, Get, ParseIntPipe, Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../Auth/guards/jwt.guard';
import { RolesGuard } from '../Auth/roles.guard';
import { Roles } from '../Auth/roles.decorator';



 
@ApiTags('logs')
@Controller('logs')
@UseGuards(JwtAuthGuard,RolesGuard)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @Roles('ADMIN')
  async findAll() {
    return await this.logsService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return await this.logsService.findOne(id);
  }

  @Get('empleado/:empleadoId')
  @Roles('ADMIN')
  async getLogsByEmpleado(
    @Param('empleadoId', ParseIntPipe) empleadoId: number,
  ) {
    return await this.logsService.getLogsByEmpleado(empleadoId);
  }

  @Post('logout/:empleadoId')
  @Roles('DOCTOR','RECEPCIONISTA')
  async logoutEmpleado(@Param('empleadoId') empleadoId: string) {
    return this.logsService.registrarLogout(Number(empleadoId));
  }
}
