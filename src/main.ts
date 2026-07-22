import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);

  const PORT = process.env.PORT ?? 3000;
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina propiedades que no estén en el DTO
      forbidNonWhitelisted: true, // rechaza el request si envían props extra
      transform: true, // convierte tipos automáticamente (ej: string a number)
    }),
  );
}
bootstrap();
