-- =====================================================================
--  MIGRACIÓN: nuevo estado SOLICITADA para las citas
-- =====================================================================
--
--  MOTIVO
--  ------
--  El flujo original (el del Manual de Usuario) era:
--
--      cliente crea la cita -> PENDIENTE -> cliente confirma -> CONFIRMADA
--
--  No existía aprobación por parte de la clínica: cualquier paciente podía
--  ocupar la agenda directamente.
--
--  El flujo nuevo agrega ese control:
--
--      SOLICITADA   el cliente pide la cita
--          |        (recepción la revisa)
--          v
--      PENDIENTE    recepción la aprobó; falta que el cliente confirme
--          |        (o la rechaza -> CANCELADA)
--          v
--      CONFIRMADA   el cliente confirmó su asistencia
--          |
--          v
--      COMPLETADA   el doctor la atendió
--
--  CANCELADA sigue siendo alcanzable desde cualquier punto.
--
--  Correr:
--      docker cp migracion-estado-solicitada.sql odonto-db:/tmp/
--      docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-estado-solicitada.sql
--
--  Es idempotente: se puede correr varias veces sin romper nada.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Agregar el valor al enum
--     IF NOT EXISTS evita el error si la migración ya se aplicó.
-- ---------------------------------------------------------------------
ALTER TYPE "EstadoCita" ADD VALUE IF NOT EXISTS 'SOLICITADA';

-- ---------------------------------------------------------------------
--  2. Comprobación
-- ---------------------------------------------------------------------
SELECT
  enumlabel AS estado,
  enumsortorder AS orden
FROM pg_enum
WHERE enumtypid = 'public."EstadoCita"'::regtype
ORDER BY enumsortorder;

-- =====================================================================
--  NOTAS
--  -----
--  * Los datos existentes NO cambian. Las citas que ya estaban en
--    PENDIENTE se consideran "ya aprobadas por recepción", que es lo
--    razonable: alguien de la clínica las cargó.
--
--  * Si quieres que algunas queden como solicitudes por revisar, para
--    probar el flujo completo:
--
--      UPDATE "Cita" SET estado = 'SOLICITADA'
--      WHERE estado = 'PENDIENTE' AND fecha::date >= CURRENT_DATE;
--
--  * PostgreSQL no permite ADD VALUE dentro de una transacción en
--    versiones antiguas. Si da error "ALTER TYPE ... ADD cannot run
--    inside a transaction block", ejecutar esa línea suelta.
-- =====================================================================
