# Estado actual — sesión del 26 de julio de 2026

> **Ambos proyectos compilan limpio.**
> Frontend: `npx tsc --noEmit -p tsconfig.app.json` → 0 errores, `npm run build` → OK
> Backend: `npx tsc --noEmit -p tsconfig.json` → 0 errores

Este archivo es el punto de partida para retomar. El histórico anterior está en
`Bases_Frontend_odontologia_lurvin/CONTEXTO_TRABAJO.md`.

---

## 1. PENDIENTE INMEDIATO — correr estos scripts, en este orden

Ninguno se ha ejecutado todavía. El código ya los espera, así que hasta
que no corran, esas funciones no andan.

```powershell
cd C:\Users\ferna\Downloads\backend-Odonto_Bases-main

# a) Aviso de cancelación al paciente (agrega vistoPorPaciente)
docker cp migracion-aviso-cancelacion.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-aviso-cancelacion.sql

# b) Borrar el David Lopex duplicado (persona 22, vacía)
docker cp limpiar-duplicado-david.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/limpiar-duplicado-david.sql

# c) Índice único sobre el DNI — DESPUÉS de (b)
docker cp migracion-evitar-duplicados.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-evitar-duplicados.sql
```

Luego **reiniciar el backend** (`npm run start:dev`): en esta sesión se
instaló `passport-google-oauth20`, que no estaba.

---

## 2. LO QUE QUEDÓ ABIERTO — retomar por aquí

### 2.1 Los expedientes no se actualizan (David Lopex) — SIGUE PENDIENTE

El diagnóstico probó que **la consulta
nunca llegó a la base**: los expedientes 9 y 10 tienen 0 detalles.

Causa encontrada: en `ExpedienteDetails.tsx` el `doctorId` estaba clavado
en `1` con un TODO sin hacer. Ya se corrigió (ahora sale de
`useAuth().idEmpleado`), y el formulario ya muestra el mensaje real del
backend en vez de un "Error al guardar el detalle" genérico.

**Falta probarlo.** Entrar como doctor, registrar una consulta para David
y ver qué pasa. Si vuelve a fallar, la pantalla ahora dice por qué.

Dato para tener a mano: las 11 consultas que existen están todas
atribuidas al **empleado 1**, porque se crearon con el valor clavado. Si
importa para la defensa, hay que repartirlas a los doctores reales.

### 2.2 Reportes de administración no incluye a los doctores nuevos

La pestaña de reportes no se actualiza cuando se agrega un doctor: sigue
mostrando solo los que ya estaban.

Sospecha a revisar: la consulta de `GET /facturas/reportes` (en
`src/Factura/factura.service.ts`, método `reportes`) probablemente une
contra los doctores que **tienen facturas** en lugar de listarlos todos,
así que un doctor recién creado —que todavía no facturó nada— queda fuera.
Si es eso, se arregla cambiando el JOIN por un LEFT JOIN desde
`Empleado`.

### 2.3 Subir archivos a los expedientes — falta que Hugo pase las credenciales

Los adjuntos van a Firebase Storage y hacen falta dos variables que **no
están en el repositorio**:

```env
FIREBASE_SERVICE_ACCOUNT_KEY=   # JSON de la cuenta de servicio, en UNA linea
FIREBASE_STORAGE_BUCKET=        # nombre-del-bucket.appspot.com
```

**Hugo las tiene y debe compartirlas.** No es un bug del código: el
backend arranca igual y avisa por consola; solo falla esa función.

### 2.4 Login con Google — falta el trámite en Google Cloud

Todo el código está listo y probado por compilación. Falta que Fernando
cree las credenciales y las pegue en el `.env`. Paso a paso en
**`GUIA_LOGIN_GOOGLE.md`**.

Mientras tanto el proyecto funciona igual: el botón simplemente no
aparece (el frontend consulta `GET /auth/google/status`).

### 2.5 Prueba de humo de permisos — sin hacer

Se cerraron cuatro controladores que estaban abiertos. **Hay que recorrer
la app con los cinco roles** para detectar cualquier llamada a la que se
le haya olvidado mandar el token. La guía está en
**`PRUEBAS_PERMISOS.md`**, sección 4.

---

## 3. LO QUE SE HIZO EN ESTA SESIÓN

### 3.1 Quién marca una cita como COMPLETADA

Antes ninguna cita llegaba a ese estado, así que "Generar Factura"
aparecía siempre vacío: `/facturas/pendientes` filtra por
`WHERE c.estado = 'COMPLETADA'`.

Ahora el doctor la cierra de dos formas:

- **Botón** en cada tarjeta de "Mis Citas": *Marcar como atendida* y
  *No asistió*.
- **Automático** al registrar una consulta en el expediente.

Ciclo completo:

```
SOLICITADA ──aprobar(recepción)──> PENDIENTE ──confirmar(cliente)──> CONFIRMADA
                                       └────── completar (doctor) ──────┘
                                                       ↓
                                                  COMPLETADA → facturable
```

### 3.2 Motivos de cancelación por rol

`DialogoCancelarCita` tenía una sola lista para todos, con motivos
personales ("Emergencia personal", "Motivo económico") que no tienen
sentido cuando quien cancela es la clínica. Ahora hay cuatro perfiles:

| Variante | Quién y qué | Título del botón |
|---|---|---|
| `paciente` | el cliente cancela su cita | Cancelar cita |
| `recepcion` | recepción cancela una cita agendada | Cancelar cita |
| `rechazo` | recepción niega una solicitud | Rechazar solicitud |
| `inasistencia` | el doctor registra que no se presentó | Registrar inasistencia |

En el panel de solicitudes la variante se elige sola según el estado.
El chip **"Otro motivo"** vacía el campo en lugar de escribir "Otro
motivo", que sería un dato inútil en el historial.

### 3.3 El paciente ahora se entera de que le cancelaron

Antes la cita desaparecía de su pantalla sin explicación, por dos
filtros encadenados:

- backend: `AND c.estado NOT IN ('CANCELADA', 'COMPLETADA')`
- frontend: `filter(c => c.estado === "PENDIENTE" || c.estado === "CONFIRMADA")`
  — que además dejaba fuera las **SOLICITADA**, así que sus propias
  solicitudes tampoco se veían.

Y las notificaciones del gateway son WebSocket en vivo, sin persistencia:
si no tenía la app abierta en ese segundo, el aviso se perdía.

Ahora aparece una tarjeta roja arriba de todo con el motivo, quién
canceló y cuándo, más los botones *Entendido* y *Solicitar otra cita*.
El acuse se guarda en `HistorialCancelacionCita.vistoPorPaciente`.

Solo se avisa si canceló **otra persona**: si canceló él mismo, ya sabe
por qué.

### 3.4 Seguridad del backend

Cuatro controladores respondían **sin token**: `citas`, `facturas`,
`especialidad`, `Servicios`. Cualquiera con `curl` podía cancelar citas
ajenas o listar todas las facturas.

Los permisos se pusieron **por endpoint**, no por controlador, porque
cada transición la ejecuta un rol distinto:

| Endpoint | Quién |
|---|---|
| `POST /citas` | CLIENTE, RECEPCIONISTA, ADMIN |
| `GET /citas` | RECEPCIONISTA, ADMIN |
| `PATCH /citas/:id/aprobar` | RECEPCIONISTA, ADMIN |
| `PATCH /citas/:id/confirmar` | CLIENTE, RECEPCIONISTA, ADMIN |
| `PATCH /citas/:id/completar` | DOCTOR, ADMIN |
| `PATCH /citas/:id/enterado` | CLIENTE |
| `PATCH /citas/:id/cancelar` | cualquiera con sesión |
| `/facturas/*` | RECEPCIONISTA + ADMIN; `reportes` solo ADMIN |
| `/especialidad` | leer con sesión, modificar solo ADMIN |
| `GET /Servicios` | **público** |

`GET /Servicios` quedó público a propósito: `/services` es ruta abierta y
manda `Bearer null` cuando nadie inició sesión. Cerrarlo dejaba la
landing sin servicios para cualquier visitante.

### 3.5 Login: regreso, Google y contraseña olvidada

- **Botón "Volver al inicio"** en login y registro. Antes no había salida
  sin editar la URL a mano.
- **Google**: estaba roto en cinco puntos independientes (ver
  `GUIA_LOGIN_GOOGLE.md`). Todos corregidos.
- **"Olvidé mi contraseña"** era `alert("Redirigir a recuperar
  contraseña")`. Ahora es la página `/recuperar-password`, que explica el
  proceso real: recepción verifica identidad y emite una contraseña
  temporal. No se inventó un flujo por correo porque el backend no lo
  tiene; esto es lo que la columna `passwordTemporal` ya implementa.
- **`NotFoundPage`** por fin enrutada. El comodín `*` mostraba la
  landing, así que una URL mal escrita parecía funcionar.

### 3.6 Pacientes duplicados

"David Lopex" aparecía dos veces con dos expedientes distintos.
`Persona.dni` no tenía restricción UNIQUE, y la única defensa (en
`signup`) tenía dos huecos: se saltaba entera con `isSocial`, y solo
comprobaba `if (dni)`.

Corregido en los dos niveles: índice único parcial en la base, y en el
código la comprobación ahora corre siempre, compara con `TRIM` y captura
el error `23505` de Postgres.

La ficha de expediente ahora muestra el **DNI** (o el correo) debajo del
nombre, y la lista viene ordenada alfabéticamente para que los homónimos
queden pegados.

---

## 4. BUGS LATENTES ENCONTRADOS DE PASO

Ninguno lo habíamos buscado; aparecieron auditando otra cosa.

1. **`AuthModule` no estaba en `app.module.ts`.** Llegaba a la aplicación
   de rebote porque `EmpleadoModule` lo importa. Tocar ese módulo habría
   tumbado el login sin motivo aparente.
2. **El `.env` solo se cargaba desde `database/db.ts`**, a media cadena
   de módulos. Ahora `main.ts` hace `import 'dotenv/config'` en su
   primera línea.
3. **`logoutService` mandaba el token como cuerpo**, no como cabecera
   (`api.post(url, headers)` en vez de `api.post(url, {}, headers)`). El
   endpoint respondía 401 y el `catch` se lo tragaba: **el logout nunca
   se registró en la tabla `Logs`**.
4. **`passport-google-oauth20` no estaba instalado**, solo los `@types`.
   Por eso TypeScript compilaba y el error solo salía al ejecutar.
5. **`GET /auth/me` no devolvía `empleadoId`**, así que un empleado que
   entrara por Google no habría podido firmar consultas.

---

## 5. LISTA DE LO QUE FALTA (de la auditoría)

Ordenada por lo que más pesa en una defensa.

1. **Pertenencia de los datos.** Los guards validan *qué rol* sos, no *de
   quién* es el dato. Un CLIENTE autenticado todavía puede pedir
   `GET /citas/paciente/7` con el token del paciente 3. Endpoints
   afectados y cómo cerrarlo: final de `PRUEBAS_PERMISOS.md`.
2. **La sesión vence a la hora y nadie lo maneja.** El token es
   `expiresIn: '1h'`, pero `ProtectedRoute` solo comprueba que exista.
   Pasada la hora, el usuario ve la pantalla y todo falla con 401 sin
   mensaje. El interceptor que lo arreglaría está escrito pero comentado
   en `services/https.ts`.
3. **Facturación nunca se probó de punta a punta.** Ahora que las citas
   llegan a COMPLETADA, hay que emitir una factura real y verificar CAI e
   ISV 15%/18%.
4. **Las pruebas unitarias no arrancan.** Hay 6 `.spec.ts`, pero
   `npx jest` muere con *"Module ts-jest in the transform option was not
   found"*. Para Ingeniería de Software probablemente pese en la nota.
5. **Código muerto que confunde.** `App.tsx` (45 líneas) es una tabla de
   rutas paralela **sin ninguna protección**; hoy no está conectada
   (`main.tsx` usa `AppRoutes`), pero si alguien la reconecta queda todo
   abierto. También: `pages/Login.tsx` y `pages/Registro.tsx` con
   `alert("simulado")`, los modales maqueta de `pages/`,
   `services/citaService.ts`, `services/pacientesMockService.ts`,
   `services/https.ts` y la carpeta `mock-server/`.
6. **`/Historial` y `/historial-clinico`** son dos rutas para lo mismo,
   ambas de CLIENTE.
7. **Formato de DNI inconsistente.** Conviven `0801200518920` y
   `0801-2005-18980`. Conviene decidir uno y normalizar al guardar.

---

## 6. CORRECCIONES A COSAS QUE AFIRMÉ MAL

Para que no queden en el informe:

- **El `.env` NO está versionado.** Sí figura en `.gitignore` (línea 39);
  yo había mirado solo las primeras 20 líneas. Verificado además con
  `git ls-files`: no está en el índice.
- **`services/axios.ts` NO es código muerto.** Lo importan
  `expedientesService` y `modificarInfoService` como `./axios`, ruta que
  mi búsqueda no capturó. El único cliente axios realmente muerto es
  `services/https.ts`.
- **El duplicado no explicaba la consulta perdida.** Atribuí el "no
  aparece el expediente" a que se había guardado en el David equivocado.
  El diagnóstico lo desmintió: los dos expedientes tenían 0 consultas. La
  causa real era el `doctorId` clavado.
- **Los dos DNI de David son números distintos** (`…18920` contra
  `…18980`), no el mismo mal formateado. El índice único no habría
  evitado ese caso concreto.

---

## 7. DATOS ÚTILES

**Base de datos** (Docker, contenedor `odonto-db`)

| | |
|---|---|
| Puerto | **5433** (el 5432 lo ocupa el PostgreSQL de Windows) |
| Base | `odontologia` |
| Usuario | `postgres` |
| Contraseña | `odonto123` |

> Si pgAdmin muestra la base vacía o con acentos raros, casi seguro está
> conectado al **5432** en lugar del 5433. Ya nos pasó y perdimos un rato
> buscando una corrupción que no existía.

**Arrancar todo**

```powershell
# Backend
cd C:\Users\ferna\Downloads\backend-Odonto_Bases-main\backend-Odonto_Bases-main
npm run start:dev          # → http://localhost:3000  (Swagger en /api)

# Frontend  (ojo: la carpeta está anidada un nivel)
cd C:\Users\ferna\Downloads\Bases_Frontend_odontologia_lurvin\Bases_Frontend_odontologia_lurvin
npm run dev                # → http://localhost:5173
```

**Cosas del entorno que ya nos mordieron**

- PowerShell se come el `<` y las comillas dobles: para SQL usar
  `docker cp` + `psql -f`, nunca `psql < archivo.sql`.
- En PowerShell, `curl` es un alias de `Invoke-WebRequest`. Para que se
  comporte como en Linux hay que escribir **`curl.exe`**.
- Los archivos tienen finales de línea mezclados (CRLF y LF). Al editar
  con scripts hay que normalizar a `\n` y restaurar al guardar.
- El proyecto usa **oxlint**, no ESLint (decisión del equipo).
- **No se usa ningún ORM.** Los nombres de tabla en PascalCase entre
  comillas (`"Persona"`, `"User"`) son residuo de un esquema estilo
  Prisma, pero es SQL plano con `pg`.

**Archivos de referencia**

| Archivo | Para qué |
|---|---|
| `GUIA_LOGIN_GOOGLE.md` | activar Google paso a paso |
| `PRUEBAS_PERMISOS.md` | verificar los guards + prueba de humo |
| `GUIA_BACKEND.md` | cómo funciona el backend |
| `HOJA_DE_RUTA.md` | plan general |
| `diagnostico-duplicados.sql` | revisar duplicados (solo lectura) |
| `RUTAS.pdf` | todas las rutas del frontend |
| `../Bases_Frontend_odontologia_lurvin/CONTEXTO_TRABAJO.md` | histórico de sesiones anteriores |
