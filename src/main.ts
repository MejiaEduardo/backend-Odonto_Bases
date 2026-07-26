/*
 * Esto debe ir en la PRIMERA linea del archivo. Antes el .env solo se
 * cargaba desde database/db.ts, que se importa a media cadena de modulos:
 * cualquier codigo que leyera process.env antes de eso veia undefined.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS: sin esto el navegador bloquea TODAS las peticiones que vienen
  // del frontend (Vite corre en 5173) antes de que lleguen al servidor.
  app.enableCors({
    origin: ['http://localhost:5173'],
    credentials: true,
  });

  // Los pipes y el CORS deben registrarse ANTES de listen(), si no el
  // servidor empieza a aceptar peticiones sin ellos configurados.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina propiedades que no estén en el DTO
      forbidNonWhitelisted: true, // rechaza el request si envían props extra
      transform: true, // convierte tipos automáticamente (ej: string a number)
    }),
  );

  const PORT = process.env.PORT ?? 3000;
  await app.listen(PORT);
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
}
bootstrap();
