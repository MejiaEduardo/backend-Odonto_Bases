/**
 * ¿Está configurado el inicio de sesión con Google?
 *
 * Vive en su propio archivo a propósito. Si esta constante estuviera en
 * auth.module.ts, el controlador tendría que importarla desde el módulo
 * y el módulo importa al controlador: una dependencia circular que en
 * tiempo de ejecución deja la constante en `undefined` según el orden en
 * que Node resuelva los archivos.
 *
 * Se evalúa una sola vez, al cargar el archivo. Por eso main.ts hace
 * `import 'dotenv/config'` en su primera línea: si el .env se cargara
 * después, aquí se leería siempre undefined.
 */
export const GOOGLE_HABILITADO = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_SECRET,
);
