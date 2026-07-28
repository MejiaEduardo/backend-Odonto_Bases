/**
 * COMPROBACION RAPIDA DEL SISTEMA COMPLETO
 *
 * Revisa, en orden, los tres pisos del proyecto:
 *
 *   1. La base de datos (PostgreSQL en Docker, puerto 5433)
 *   2. El backend NestJS (puerto 3000)
 *   3. El frontend Vite (puerto 5173)
 *
 * y ademas hace un login de verdad y pide algunos datos, para comprobar que
 * los tres se estan hablando entre si.
 *
 * COMO SE USA
 * -----------
 * Con las tres cosas ya levantadas (ver la guia), desde esta carpeta:
 *
 *     node comprobar-sistema.mjs
 *
 * No modifica nada: solo lee.
 */

import { execFileSync } from 'node:child_process';

const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMARILLO = '\x1b[33m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

let ok = 0;
let fallos = 0;

function bien(texto, detalle = '') {
  console.log(`  ${VERDE}OK${FIN}     ${texto}${detalle ? `  ${GRIS}${detalle}${FIN}` : ''}`);
  ok++;
}

function mal(texto, comoArreglarlo) {
  console.log(`  ${ROJO}FALLA${FIN}  ${texto}`);
  if (comoArreglarlo) console.log(`         ${AMARILLO}→ ${comoArreglarlo}${FIN}`);
  fallos++;
}

function titulo(texto) {
  console.log(`\n${texto}`);
}

/**
 * Ejecuta un programa con sus argumentos y devuelve la salida, o null si
 * falla.
 *
 * Se usa execFileSync y NO execSync a proposito: execSync pasa el comando por
 * la shell, y en Windows eso significa cmd.exe, que se come las comillas
 * dobles. Como el SQL lleva identificadores entre comillas ("Persona"), la
 * consulta llegaba partida. Con execFileSync los argumentos van directos al
 * programa, sin shell de por medio.
 */
function correr(programa, args) {
  try {
    return execFileSync(programa, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Consulta a la base a traves del contenedor de Docker. */
function consultar(sql) {
  return correr('docker', [
    'exec', 'odonto-db',
    'psql', '-U', 'postgres', '-d', 'odontologia', '-t', '-A', '-c', sql,
  ]);
}

async function pedir(metodo, ruta, { token, body } = {}) {
  const res = await fetch(API + ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// =====================================================================
//  1. BASE DE DATOS
// =====================================================================
titulo('1. BASE DE DATOS (Docker, puerto 5433)');

const contenedor = correr('docker', [
  'ps', '--filter', 'name=odonto-db', '--format', '{{.Status}}',
]);

if (!contenedor) {
  mal(
    'El contenedor odonto-db no esta corriendo',
    'cd ..\\backend-Odonto_Bases-main  y luego  docker compose up -d',
  );
} else {
  bien('Contenedor odonto-db levantado', contenedor);

  const version = consultar('SELECT current_setting(\'server_version\')');
  if (version) bien('Se puede consultar la base', `PostgreSQL ${version}`);
  else mal('No responde a las consultas', 'docker compose restart');

  // Las tablas que tienen que existir despues de las migraciones 003/004/005
  const tablas = consultar(
    "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'",
  );
  const esperadas = ['Paciente', 'Emisor', 'RangoFacturacion', 'Permiso', 'TokenAcceso'];
  const faltan = esperadas.filter((t) => !tablas?.includes(t));

  if (faltan.length === 0) {
    bien('Las migraciones 003, 004 y 005 estan aplicadas', `${tablas.split(',').length} tablas`);
  } else {
    mal(
      `Faltan tablas: ${faltan.join(', ')}`,
      'Hay migraciones sin aplicar. Ver la seccion "Si la base esta sin migrar" de la guia.',
    );
  }

  // "fechaHora" es la senal de que la 005 corrio
  const fechaHora = consultar(
    `SELECT count(*) FROM information_schema.columns WHERE table_name='Cita' AND column_name='fechaHora'`,
  );
  if (fechaHora === '1') bien('Cita.fechaHora existe (migracion 005)');
  else mal('Cita todavia tiene fecha y hora separadas', 'Falta aplicar 005_paciente_y_fiscal.sql');

  const conteos = consultar(
    `SELECT 'personas=' || (SELECT count(*) FROM "Persona") ||
            ' pacientes=' || (SELECT count(*) FROM "Paciente") ||
            ' citas=' || (SELECT count(*) FROM "Cita") ||
            ' facturas=' || (SELECT count(*) FROM "Factura")`,
  );
  if (conteos) bien('Hay datos cargados', conteos);
}

// =====================================================================
//  2. BACKEND
// =====================================================================
titulo('2. BACKEND NestJS (puerto 3000)');

let token = null;

try {
  const login = await pedir('POST', '/auth/login', {
    body: { correo: 'roberto.diaz@clinica.com', password: '123456' },
  });
  token = login.token;

  if (token) {
    bien('Login correcto', `${login.user?.persona?.nombreCompleto} (${login.user?.rol})`);
  } else {
    mal('El login respondio pero sin token', JSON.stringify(login));
  }
} catch (e) {
  if (e.message.includes('fetch failed') || e.name === 'TimeoutError') {
    mal(
      'El backend no responde en el puerto 3000',
      'En otra terminal: cd al backend y  npm run start:dev',
    );
  } else {
    mal(`El login fallo: ${e.message}`, 'Revisa la contrasena o corre arreglar-passwords.sql');
  }
}

if (token) {
  const rutas = [
    ['/citas', 'Citas'],
    ['/empleado', 'Empleados'],
    ['/servicios', 'Servicios'],
    ['/expediente', 'Expedientes'],
    ['/facturas', 'Facturas'],
    ['/facturas/pendientes', 'Citas por facturar'],
    ['/logs', 'Bitacora de accesos'],
  ];

  for (const [ruta, nombre] of rutas) {
    try {
      const datos = await pedir('GET', ruta, { token });
      const lista = Array.isArray(datos) ? datos : (datos?.data ?? []);
      bien(nombre, `${Array.isArray(lista) ? lista.length : '?'} registros  ${GRIS}GET ${ruta}${FIN}`);
    } catch (e) {
      mal(`${nombre} (GET ${ruta})`, e.message);
    }
  }

  // Comprobacion concreta del punto 6.2: la factura trae los datos del emisor
  try {
    const facturas = await pedir('GET', '/facturas', { token });
    const primera = Array.isArray(facturas) ? facturas[0] : facturas?.data?.[0];

    if (!primera) {
      console.log(`  ${GRIS}·      No hay facturas para comprobar los datos fiscales${FIN}`);
    } else {
      const f = await pedir('GET', `/facturas/${primera.id}`, { token });
      if (f.emisorRtn && f.cai) {
        bien(
          'Datos fiscales completos (punto 6.2)',
          `emisor RTN ${f.emisorRtn} · CAI ${String(f.cai).slice(0, 10)}… · gravado15 ${f.importeGravado15}`,
        );
        if (f.emisorRtn === '00000000000000') {
          console.log(`         ${AMARILLO}Aviso: el RTN del emisor sigue siendo el PROVISIONAL.${FIN}`);
        }
      } else {
        mal('La factura no trae los datos del emisor ni el CAI');
      }
    }
  } catch (e) {
    mal('No se pudo leer una factura', e.message);
  }
}

// =====================================================================
//  3. FRONTEND
// =====================================================================
titulo('3. FRONTEND Vite (puerto 5173)');

try {
  const res = await fetch(WEB, { signal: AbortSignal.timeout(8000) });
  const html = await res.text();

  if (res.ok && html.includes('<div id="root"')) {
    bien('El frontend responde', WEB);
  } else {
    mal('Responde pero no parece la aplicacion', `HTTP ${res.status}`);
  }
} catch {
  mal(
    'El frontend no responde en el puerto 5173',
    'En otra terminal: cd al frontend y  npm run dev',
  );
}

// =====================================================================
//  RESUMEN
// =====================================================================
console.log('\n' + '─'.repeat(60));

if (fallos === 0) {
  console.log(`${VERDE}Todo funcionando: ${ok} comprobaciones OK.${FIN}`);
  console.log(`\nAbri ${WEB} y entra con:`);
  console.log(`  Admin          roberto.diaz@clinica.com   / 123456`);
  console.log(`  Recepcionista  sandra.gomez@clinica.com   / 123456`);
  console.log(`  Doctor         carlos.martinez@clinica.com / 123456`);
  console.log(`  Paciente       pedro.sanchez@gmail.com    / 123456`);
} else {
  console.log(`${ROJO}${fallos} problema(s).${FIN} ${ok} comprobaciones OK.`);
  console.log('Segui la flecha amarilla de cada falla, de arriba hacia abajo.');
}

process.exit(fallos > 0 ? 1 : 0);
