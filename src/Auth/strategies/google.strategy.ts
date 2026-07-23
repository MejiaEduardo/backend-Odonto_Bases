import { Injectable, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import type { ConfigType } from '@nestjs/config';
import googleOauthConfig from '../config/google-oauth.config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy as new (...args: any[]) => Strategy,
  'google',) {
  constructor(
    @Inject(googleOauthConfig.KEY)
    private googleConfiguracion: ConfigType<typeof googleOauthConfig>,
    private authService: AuthService,
  ) {
    super({
      clientID: googleConfiguracion.clienteId,
      clientSecret: googleConfiguracion.clienteSecret,
      callbackURL: googleConfiguracion.callbackURL,
      scope: ['email', 'profile'],
      prompt: 'select_account',      
    });
  }

  async validate(
  accessToken: string,
  refreshToken: string,
  profile: any,
  done: VerifyCallback,
){
const correo = profile.emails?.[0]?.value || profile._json?.email;
const nombre = profile.name?.givenName || profile._json?.given_name || '';
const apellido = profile.name?.familyName || profile._json?.family_name || '';

if (!correo) {
  console.error('Perfil de Google no tiene correo:', profile);
  return done(new Error('El perfil de Google no tiene correo'), false);
}

const googleUser = { correo, nombre, apellido };
done(null, googleUser);

 
}

}
