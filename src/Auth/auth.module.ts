import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GOOGLE_HABILITADO } from './config/google.enabled';

/*
 * passport-google-oauth20 lanza "OAuth2Strategy requires a clientID option"
 * en el arranque si clientID viene vacio, y eso tumba TODO el backend.
 * Por eso la estrategia solo se registra cuando las credenciales existen:
 * sin ellas el proyecto sigue levantando y solo se desactiva el boton.
 */

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secreto',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ...(GOOGLE_HABILITADO ? [GoogleStrategy] : [])],
  exports: [JwtStrategy, PassportModule],
})
export class AuthModule {}