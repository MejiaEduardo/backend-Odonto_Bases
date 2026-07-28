import { Pool, PoolClient } from 'pg';

/**
 * Traduccion entre id de Persona e id de Paciente.
 *
 * Desde la migracion 005 existe la tabla "Paciente", igual que ya existia
 * "Empleado": una persona puede ser paciente, empleado, las dos cosas o
 * ninguna. "Cita", "Factura" y "Expediente" apuntan a "Paciente", no a
 * "Persona".
 *
 * La API publica sigue hablando en ids de PERSONA, que es lo que el frontend
 * tiene a mano (`user.persona.id`). Estas funciones hacen la traduccion en el
 * borde, para no tener que cambiar todas las pantallas.
 */

type Ejecutor = Pool | PoolClient;

/**
 * Devuelve el id de Paciente de una persona. Si esa persona todavia no estaba
 * registrada como paciente, la registra.
 *
 * Es lo que pasa cuando recepcion agenda la primera cita de alguien que solo
 * existia como usuario.
 */
export async function idPacienteDesdePersona(
  db: Ejecutor,
  personaId: number,
): Promise<number | null> {
  const existe = await db.query(
    `SELECT id FROM "Paciente" WHERE "personaId" = $1`,
    [personaId],
  );
  if (existe.rows.length > 0) {
    return existe.rows[0].id as number;
  }

  const persona = await db.query(`SELECT id FROM "Persona" WHERE id = $1`, [
    personaId,
  ]);
  if (persona.rows.length === 0) {
    return null;
  }

  const creado = await db.query(
    `INSERT INTO "Paciente" ("personaId") VALUES ($1)
     ON CONFLICT ("personaId") DO UPDATE SET "personaId" = EXCLUDED."personaId"
     RETURNING id`,
    [personaId],
  );
  return creado.rows[0].id as number;
}

/** Igual que el anterior pero sin crear nada: null si no es paciente. */
export async function buscarPacienteDesdePersona(
  db: Ejecutor,
  personaId: number,
): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT id FROM "Paciente" WHERE "personaId" = $1`,
    [personaId],
  );
  return rows.length > 0 ? (rows[0].id as number) : null;
}

/** Paciente -> Persona. */
export async function idPersonaDesdePaciente(
  db: Ejecutor,
  pacienteId: number,
): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT "personaId" FROM "Paciente" WHERE id = $1`,
    [pacienteId],
  );
  return rows.length > 0 ? (rows[0].personaId as number) : null;
}
