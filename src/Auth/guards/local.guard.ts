import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

//el guard maneja la lógica de autenticación
@Injectable()
export class LocalGuard extends AuthGuard('local') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {    
    return super.canActivate(context); // Llama al método validate de local.strategy para la lógica de autenticación
  }
}
