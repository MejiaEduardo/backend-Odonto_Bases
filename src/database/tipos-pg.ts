import { types } from 'pg';

/**
 * Como el driver `pg` convierte los tipos de PostgreSQL a JavaScript.
 *
 * Se registra una sola vez y aplica a TODAS las consultas del proceso, asi
 * que no hay que andar convirtiendo a mano en cada servicio.
 *
 * Importar este archivo ya lo activa (el efecto es al cargar el modulo).
 */

/*
 * 1700 = NUMERIC.
 *
 * Por defecto `pg` lo devuelve como STRING, porque un NUMERIC de PostgreSQL
 * puede tener mas precision de la que aguanta un `number` de JavaScript.
 *
 * Desde la migracion 003 todo el dinero es NUMERIC(12,2). Sin esto el
 * frontend recibiria "575.00" en vez de 575, y al sumar concatenaria en lugar
 * de sumar: 500 + "75.00" da "50075.00".
 *
 * Los importes de esta clinica estan muy lejos del limite de precision de un
 * `number`, asi que la conversion es segura.
 */
types.setTypeParser(1700, (valor) => (valor === null ? null : parseFloat(valor)));

/*
 * 1082 = DATE.
 *
 * Por defecto `pg` lo convierte a un objeto Date en la zona horaria del
 * servidor, y una cita guardada como 2026-08-04 puede llegar al frontend como
 * 2026-08-03T23:00:00Z: un dia menos.
 *
 * Una columna DATE no tiene hora ni zona, asi que se deja el texto tal cual:
 * 'YYYY-MM-DD', que es justo lo que espera el frontend.
 */
types.setTypeParser(1082, (valor) => valor);
