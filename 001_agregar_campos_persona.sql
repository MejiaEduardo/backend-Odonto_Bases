-- Agrega las cuatro columnas de nombre a "Persona".
--
-- OJO: en una instalacion NUEVA este script ya no hace falta, porque
-- tablas.sql ya crea estas columnas. Se deja por si alguien tiene una base
-- creada antes de ese cambio.
--
-- Por eso lleva IF NOT EXISTS: asi se puede correr siempre, sobre una base
-- vieja o sobre una nueva, sin que reviente con
-- "column primerNombre already exists".
ALTER TABLE "Persona"
ADD COLUMN IF NOT EXISTS "primerNombre" TEXT,
ADD COLUMN IF NOT EXISTS "segundoNombre" TEXT,
ADD COLUMN IF NOT EXISTS "primerApellido" TEXT,
ADD COLUMN IF NOT EXISTS "segundoApellido" TEXT;
