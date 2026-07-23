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

    // Ajusta esta redirección a la URL real de tu frontend
    return res.redirect(`http://localhost:5173/auth/callback?token=${result.token}`);
  }
}