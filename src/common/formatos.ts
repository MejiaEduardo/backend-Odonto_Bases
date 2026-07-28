/**
 * Normalizacion de los documentos y telefonos antes de guardarlos.
 *
 * La base exige un formato exacto (migracion 003):
 *   Persona.dni       13 digitos
 *   Persona.telefono   8 digitos
 *   Persona.rtn       14 digitos
 *
 * Pero el usuario los escribe como quiere: '0801-1999-12345', '+504 9999
 * 8888'. Si se guardaran tal cual, el CHECK de la base rechazaria el registro
 * con un error de restriccion que no le dice nada a nadie.
 *
 * Aca se quitan los separadores. Si despues de limpiarlos el largo no es el
 * que corresponde, se devuelve el valor limpio igual y deja que la base lo
 * rechace: es ella la que manda sobre lo que es valido.
 */

/** Deja solo los digitos. Cadena vacia -> null. */
export function soloDigitos(valor?: string | null): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).replace(/\D/g, '');
  return limpio === '' ? null : limpio;
}

/** DNI hondureno: 13 digitos, sin guiones. */
export function normalizarDni(valor?: string | null): string | null {
  return soloDigitos(valor);
}

/** RTN hondureno: 14 digitos. */
export function normalizarRtn(valor?: string | null): string | null {
  return soloDigitos(valor);
}

/**
 * Telefono: 8 digitos.
 * Si viene con el codigo de pais (+504), se le quita: en la base se guardan
 * solo los ocho digitos del numero.
 */
export function normalizarTelefono(valor?: string | null): string | null {
  const digitos = soloDigitos(valor);
  if (digitos === null) return null;
  if (digitos.length === 11 && digitos.startsWith('504')) {
    return digitos.slice(3);
  }
  return digitos;
}

/** Texto opcional: recorta y convierte la cadena vacia en null. */
export function textoOpcional(valor?: string | null): string | null {
  const limpio = (valor ?? '').trim();
  return limpio === '' ? null : limpio;
}
