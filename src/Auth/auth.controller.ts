import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthPayloadDto } from './dto/auth.dto';
import { SignupDto } from './dto/signup.dto';
import { GOOGLE_HABILITADO } from './config/google.enabled';
import { JwtAuthGuard } from './guards/jwt.guard';


interface RequestWithUser extends Request {
  user: SignupDto;
}

const LOGIN_CODE_TO_HTTP_STATUS: Record<number, HttpStatus> = {
  9: HttpStatus.CONFLICT, // el DNI ya existe (solo aplica en signup, no en login)
  11: HttpStatus.UNAUTHORIZED, // credenciales inválidas (usuario no existe)
  13: HttpStatus.UNAUTHORIZED, // credenciales inválidas (password incorrecto) / password requerida (signup)
  25: HttpStatus.UNAUTHORIZED, // password temporal expirada
  99: HttpStatus.TOO_MANY_REQUESTS, // demasiados intentos fallidos
  500: HttpStatus.INTERNAL_SERVER_ERROR,
};

const SIGNUP_CODE_TO_HTTP_STATUS: Record<number, HttpStatus> = {
  9: HttpStatus.CONFLICT, // DNI ya existe
  12: HttpStatus.CONFLICT, // correo ya registrado
  13: HttpStatus.BAD_REQUEST, // contraseña requerida
  500: HttpStatus.INTERNAL_SERVER_ERROR,
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private throwIfError(
    result: any,
    successCode: number,
    codeMap: Record<number, HttpStatus>,
  ) {
    if (result && typeof result === 'object' && result.code !== successCode) {
      const status = codeMap[result.code] ?? HttpStatus.BAD_REQUEST;
      throw new HttpException(result, status);
    }
    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión con correo y contraseña' })
  @ApiResponse({ status: 200, description: 'Autenticación exitosa' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos fallidos' })
  async login(@Body() authPayloadDto: AuthPayloadDto) {
    const result = await this.authService.validateUser(authPayloadDto);
    return this.throwIfError(result, 0, LOGIN_CODE_TO_HTTP_STATUS);
  }

  @Post('signup')
  @ApiOperation({ summary: 'Registrar un nuevo usuario' })
  @ApiResponse({ status: 201, description: 'Usuario registrado con éxito' })
  @ApiResponse({ status: 409, description: 'Correo o DNI ya registrado' })
  async signup(@Body() signupDto: SignupDto) {
    const result = await this.authService.signupUser(signupDto);
    return this.throwIfError(result, 10, SIGNUP_CODE_TO_HTTP_STATUS);
  }


  /**
   * Le dice al frontend si el login con Google esta configurado.
   *
   * Sin esto el boton se mostraba siempre y, al no haber credenciales,
   * respondia 500 "Unknown authentication strategy 'google'". Ahora la
   * pantalla de login lo oculta cuando no esta disponible.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Datos del usuario dueño del token' })
  @ApiResponse({ status: 200, description: 'Perfil del usuario autenticado' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o vencido' })
  async me(@Req() req: Request & { user?: { correo?: string } }) {
    const correo = req.user?.correo;
    if (!correo) {
      throw new HttpException(
        { message: 'Token sin correo', code: 11 },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.authService.obtenerPerfil(correo);
    return this.throwIfError(result, 0, LOGIN_CODE_TO_HTTP_STATUS);
  }

  @Get('google/status')
  @ApiOperation({ summary: 'Indica si el login con Google esta disponible' })
  googleStatus() {
    return { habilitado: GOOGLE_HABILITADO };
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Iniciar el flujo de autenticación con Google' })
  async googleAuth() {
    // El guard redirige a Google; este método nunca ejecuta lógica propia.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Callback de Google OAuth2' })
  async googleAuthCallback(@Req() req: RequestWithUser, @Res() res: Response) {
    // `req.user` lo llena la GoogleStrategy con los datos básicos del perfil
    const googleUser = req.user;

    const result = await this.authService.validateGoogleUser(googleUser);

    if (result.code !== 0) {
      return res
        .status(LOGIN_CODE_TO_HTTP_STATUS[result.code] ?? HttpStatus.BAD_REQUEST)
        .json(result);
    }

    /*
     * El frontend recoge el token en /auth/callback, lo guarda y pide
     * GET /auth/me para completar los datos del usuario.
     * La URL sale del .env para no dejarla clavada a localhost.
     */
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(
      `${frontend}/auth/callback?token=${encodeURIComponent(result.token)}`,
    );
  }
}