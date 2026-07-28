// src/auth/dto/signup.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  IsDateString,
  MaxLength,
} from 'class-validator';

/** Un nombre propio: letras, espacios, apostrofes y guiones. */
const SOLO_LETRAS = /^[\p{L}][\p{L}\s'’-]{1,49}$/u;

export class SignupDto {
  // --- Nombres -------------------------------------------------------------
  // La base guarda cuatro columnas separadas. El segundo nombre y el segundo
  // apellido son OPCIONALES: mucha gente no tiene.

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(SOLO_LETRAS, {
    message: 'El primer nombre solo puede contener letras, espacios y guiones.',
  })
  primerNombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(SOLO_LETRAS, {
    message: 'El segundo nombre solo puede contener letras, espacios y guiones.',
  })
  segundoNombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(SOLO_LETRAS, {
    message: 'El primer apellido solo puede contener letras, espacios y guiones.',
  })
  primerApellido?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(SOLO_LETRAS, {
    message: 'El segundo apellido solo puede contener letras, espacios y guiones.',
  })
  segundoApellido?: string;

  /**
   * Campos viejos, aceptados por compatibilidad.
   *
   * El alta con Google los sigue usando porque Google solo entrega givenName
   * y familyName. Si vienen y no vienen los cuatro nuevos, el servicio los
   * parte: 'Juan Carlos' -> primerNombre 'Juan', segundoNombre 'Carlos'.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  apellido?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$/, {
    message: 'El RTN debe tener 14 dígitos.',
  })
  rtn?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{4}-\d{4}-\d{5}|\d{13})$/, {
    message: 'El DNI debe tener el formato ####-####-##### o 13 dígitos.',
  })
  dni?: string;

  @IsOptional() // TELÉFONO: Mantenido como opcional
  @IsString()
  @Matches(/^(?:\+?504[-\s]?)?(?:\d{8}|\d{4}[-\s]?\d{4})$/, {
    message:
      'El teléfono debe tener 8 dígitos o incluir el código de país (+504).',
  })
  telefono?: string;

  @IsOptional() // DIRECCIÓN: Mantenido como opcional
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  direccion?: string;

  @IsOptional() 
  @IsDateString({})
  @ApiProperty({ description: 'La fecha debe tener formato ISO (YYYY-MM-DD).' })
  fechaNac?: Date;

  @IsEmail({})
  @IsString()
  correo?: string;

  @IsOptional() // PASSWORD: Ahora es opcional por el registro con Google
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message: 'La contraseña debe incluir mayúscula, minúscula, número y carácter especial.',
  })
  password?: string;
}
