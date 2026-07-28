/**
 * Nombres de una persona.
 *
 * La base guarda cuatro columnas separadas -- "primerNombre",
 * "segundoNombre", "primerApellido", "segundoApellido" -- porque son cuatro
 * datos distintos: el segundo nombre y el segundo apellido son opcionales, y
 * guardarlos todos juntos en un solo campo "nombre" impedia buscar o mostrar
 * uno solo de ellos.
 *
 * La API sigue aceptando y devolviendo tambien `nombre` y `apellido` para no
 * romper las pantallas viejas del frontend. Este modulo traduce entre las dos
 * formas.
 */

export interface NombrePartes {
  primerNombre: string;
  segundoNombre: string | null;
  primerApellido: string;
  segundoApellido: string | null;
}

/** Entrada flexible: acepta los cuatro campos nuevos o los dos viejos. */
export interface NombreEntrada {
  primerNombre?: string | null;
  segundoNombre?: string | null;
  primerApellido?: string | null;
  segundoApellido?: string | null;
  nombre?: string | null;
  apellido?: string | null;
}

function limpiar(valor?: string | null): string {
  return (valor ?? '').replace(/\s+/g, ' ').trim();
}

function vacioANull(valor: string): string | null {
  return valor === '' ? null : valor;
}

/**
 * Parte "Juan Carlos" en ['Juan', 'Carlos'].
 * Si hay mas de dos palabras, la primera es el primer nombre y el resto se
 * junta como segundo: 'Maria de los Angeles' -> 'Maria' + 'de los Angeles'.
 */
function partirEnDos(texto: string): [string, string | null] {
  const partes = limpiar(texto).split(' ');
  if (partes.length === 0 || partes[0] === '') return ['', null];
  if (partes.length === 1) return [partes[0], null];
  return [partes[0], partes.slice(1).join(' ')];
}

/**
 * Normaliza lo que llega del cliente a las cuatro columnas de la base.
 *
 * Prioriza los campos nuevos. Si no vienen, parte `nombre` y `apellido`, que
 * es lo que sigue mandando el registro con Google (Google solo entrega
 * givenName y familyName).
 */
export function normalizarNombre(entrada: NombreEntrada): NombrePartes {
  let primerNombre = limpiar(entrada.primerNombre);
  let segundoNombre = limpiar(entrada.segundoNombre);
  let primerApellido = limpiar(entrada.primerApellido);
  let segundoApellido = limpiar(entrada.segundoApellido);

  if (primerNombre === '' && entrada.nombre) {
    const [uno, dos] = partirEnDos(entrada.nombre);
    primerNombre = uno;
    if (segundoNombre === '') segundoNombre = dos ?? '';
  }

  if (primerApellido === '' && entrada.apellido) {
    const [uno, dos] = partirEnDos(entrada.apellido);
    primerApellido = uno;
    if (segundoApellido === '') segundoApellido = dos ?? '';
  }

  return {
    primerNombre,
    segundoNombre: vacioANull(segundoNombre),
    primerApellido,
    segundoApellido: vacioANull(segundoApellido),
  };
}

/**
 * Igual que normalizarNombre pero para una edicion parcial: devuelve solo las
 * columnas que el cliente realmente mando, para no pisar con vacio lo que no
 * se toco.
 *
 * Un campo enviado como cadena vacia SI cuenta: es la forma de borrar el
 * segundo nombre o el segundo apellido.
 */
export function normalizarNombreParcial(
  entrada: NombreEntrada,
): Partial<NombrePartes> {
  const salida: Partial<NombrePartes> = {};

  if (entrada.primerNombre !== undefined) {
    salida.primerNombre = limpiar(entrada.primerNombre);
  }
  if (entrada.primerApellido !== undefined) {
    salida.primerApellido = limpiar(entrada.primerApellido);
  }
  if (entrada.segundoNombre !== undefined) {
    salida.segundoNombre = vacioANull(limpiar(entrada.segundoNombre));
  }
  if (entrada.segundoApellido !== undefined) {
    salida.segundoApellido = vacioANull(limpiar(entrada.segundoApellido));
  }

  // Compatibilidad: si solo llegan los campos viejos, se parten.
  if (salida.primerNombre === undefined && entrada.nombre !== undefined) {
    const [uno, dos] = partirEnDos(entrada.nombre ?? '');
    salida.primerNombre = uno;
    if (salida.segundoNombre === undefined) salida.segundoNombre = dos;
  }
  if (salida.primerApellido === undefined && entrada.apellido !== undefined) {
    const [uno, dos] = partirEnDos(entrada.apellido ?? '');
    salida.primerApellido = uno;
    if (salida.segundoApellido === undefined) salida.segundoApellido = dos;
  }

  return salida;
}

/**
 * Fragmento SQL que arma el objeto `persona` que espera el frontend.
 *
 * Devuelve las cuatro columnas nuevas Y los campos `nombre` / `apellido`
 * compuestos, para que las pantallas que todavia leen los viejos sigan
 * funcionando sin cambios.
 *
 * @param alias alias de la tabla "Persona" en la consulta (p. ej. 'p')
 */
export function personaJson(alias: string): string {
  return `json_build_object(
    'id',              ${alias}.id,
    'primerNombre',    ${alias}."primerNombre",
    'segundoNombre',   ${alias}."segundoNombre",
    'primerApellido',  ${alias}."primerApellido",
    'segundoApellido', ${alias}."segundoApellido",
    'nombreCompleto',  ${alias}."nombreCompleto",
    'nombre',          ${nombreSql(alias)},
    'apellido',        ${apellidoSql(alias)},
    'dni',             ${alias}.dni,
    'rtn',             ${alias}.rtn,
    'telefono',        ${alias}.telefono,
    'direccion',       ${alias}.direccion,
    'fechaNac',        ${alias}."fechaNac"
  )`;
}

/** "primerNombre segundoNombre" en SQL, para el campo `nombre` de siempre. */
export function nombreSql(alias: string): string {
  return `(${alias}."primerNombre" || COALESCE(' ' || ${alias}."segundoNombre", ''))`;
}

/** "primerApellido segundoApellido" en SQL. */
export function apellidoSql(alias: string): string {
  return `(${alias}."primerApellido" || COALESCE(' ' || ${alias}."segundoApellido", ''))`;
}
