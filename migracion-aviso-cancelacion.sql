-- =====================================================================
--  MIGRACIÓN: avisar al paciente cuando le cancelan la cita
-- =====================================================================
--
--  EL PROBLEMA
--  -----------
--  Cuando recepción cancelaba o rechazaba una cita, el paciente nunca se
--  enteraba. Dos razones:
--
--    1. `getCitasPorPaciente` filtra con
--       `AND c.estado NOT IN ('CANCELADA', 'COMPLETADA')`,
--       así que la cita desaparecía de su pantalla sin dejar rastro.
--
--    2. Las notificaciones del gateway son WebSocket en vivo: no se
--       guardan en ninguna tabla. Si el paciente no tenía la app abierta
--       en ese instante, el aviso se perdía para siempre.
--
--  LA SOLUCIÓN
--  -----------
--  El motivo YA se guarda en "HistorialCancelacionCita". Lo único que
--  falta es saber si el paciente ya lo leyó, para poder mostrarle el
--  aviso hasta que pulse "Entendido" y no repetírselo después.
--
--  Se agrega una sola columna. No hace falta una tabla de notificaciones:
--  la cancelación ya está registrada, solo le faltaba el acuse de recibo.
--
--  Correr:
--      docker cp migracion-aviso-cancelacion.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-aviso-cancelacion.sql
--
--  Es idempotente: se puede correr las veces que haga falta.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  1. Acuse de recibo del paciente
--     false = todavía hay que avisarle.
--     true  = ya vio el motivo y pulsó "Entendido".
-- ---------------------------------------------------------------------
ALTER TABLE "HistorialCancelacionCita"
  ADD COLUMN IF NOT EXISTS "vistoPorPaciente" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
--  2. Las cancelaciones viejas se dan por vistas
--     Si no, al entrar el paciente le saltarían de golpe todos los avisos
--     históricos de citas que ya ni recuerda.
-- ---------------------------------------------------------------------
UPDATE "HistorialCancelacionCita"
SET "vistoPorPaciente" = true
WHERE "fechaCancelacion" < CURRENT_TIMESTAMP - INTERVAL '7 days'
  AND "vistoPorPaciente" = false;

-- ---------------------------------------------------------------------
--  3. Índice para la consulta del paciente
--     getCitasPorPaciente busca por citaId las cancelaciones sin ver.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "HistorialCancelacionCita_citaId_idx"
  ON "HistorialCancelacionCita" ("citaId");

COMMIT;

-- ---------------------------------------------------------------------
--  Comprobación
-- ---------------------------------------------------------------------
SELECT h.id,
       h."citaId",
       h."motivoCancelacion",
       h."rolCancela",
       h."vistoPorPaciente",
       h."fechaCancelacion"
FROM "HistorialCancelacionCita" h
ORDER BY h."fechaCancelacion" DESC
LIMIT 20;
