-- =====================================================================
--  ARREGLAR LAS CONTRASEÑAS DE PRUEBA
-- =====================================================================
--
--  PROBLEMA
--  --------
--  En datos.sql las contraseñas son marcadores de posición:
--
--      '$2b$10$hashpassword01'
--
--  Parecen hashes de bcrypt porque empiezan con "$2b$10$", pero no lo son:
--  miden 21 caracteres y un hash real de bcrypt mide exactamente 60.
--  El texto después del prefijo es literalmente "hashpassword01".
--
--  El backend compara con bcrypt.compare() (src/Auth/auth.service.ts:135),
--  que devuelve false para estos valores. Resultado: NADIE PUEDE INICIAR
--  SESIÓN, y el error que se ve es "Credenciales Invalidas" (code 11/13),
--  lo cual despista porque los datos sí están en la base.
--
--  SOLUCIÓN
--  --------
--  Este script reemplaza las 10 contraseñas por un hash real de bcrypt.
--  La contraseña de todos queda como:  123456
--
--  Correr DESPUÉS de tablas.sql y datos.sql:
--      psql -U postgres -d odontologia -f arreglar-passwords.sql
--
--  ⚠️  SOLO PARA DESARROLLO. En producción cada usuario debe tener su
--      propia contraseña, generada por el backend al registrarse.
-- =====================================================================

-- Hash de "123456" generado con bcrypt, factor de costo 10.
UPDATE "User"
SET password = '$2b$10$Hw7PAs2IrgTehF8rT4EFK.oRjGvTXEhBx3.bB9vQkcaQICS3qBgGG';

-- Comprobación: todos deben quedar con 60 caracteres.
SELECT
  correo,
  rol,
  LENGTH(password) AS largo_hash,
  CASE WHEN LENGTH(password) = 60 THEN 'OK' ELSE 'REVISAR' END AS estado
FROM "User"
ORDER BY id;

-- =====================================================================
--  USUARIOS PARA PROBAR  (contraseña: 123456)
--
--    roberto.diaz@clinica.com      ADMIN
--    carlos.martinez@clinica.com   DOCTOR
--    sandra.gomez@clinica.com      RECEPCIONISTA
--    pedro.sanchez@gmail.com       CLIENTE
--
--  Los demás doctores:
--    maria.fernandez@clinica.com, jose.rodriguez@clinica.com,
--    ana.lopez@clinica.com, luis.hernandez@clinica.com
--
--  Los demás clientes:
--    laura.torres@gmail.com, miguel.ramirez@gmail.com
-- =====================================================================
