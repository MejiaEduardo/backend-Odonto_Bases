# Pulido de la base de datos — qué cambió y qué hay que tocar después

Auditoría y corrección del esquema de la clínica odontológica.
Migración `003_pulido_esquema.sql`, verificada ejecutándola sobre el respaldo real.

---

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `003_pulido_esquema.sql` | Primera migración: nombres, tipos de datos, catálogos, integridad e índices. |
| `003_rollback.sql` | Deshace la 003. |
| `004_correcciones_ingeniero.sql` | Segunda migración: permisos, auditoría, nombres mnemónicos, tokens, facturación. |
| `005_paciente_y_fiscal.sql` | Tercera migración: `Cita.fechaHora`, tabla `Paciente` y el punto 6.2 fiscal. |
| `005_rollback.sql` | Deshace la 005. |
| `esquema_final.sql` | Crea la base desde cero ya corregida. Es la documentación del modelo. |

**Orden de aplicación:** 003 → 004 → 005. Cada una supone que la anterior ya corrió.

**Cómo aplicarla** (la base corre en Docker: contenedor `odonto-db`, base `odontologia`, puerto 5433). Desde la carpeta `odonto-db` en PowerShell:

```powershell
# 1. Respaldo previo. No te lo saltes.
docker exec odonto-db pg_dump -U postgres -d odontologia > respaldo_previo.sql

# 2. Copiar la migración al contenedor y ejecutarla
docker cp 003_pulido_esquema.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/003_pulido_esquema.sql
```

Si sale bien, la última línea dice `Migracion 003 aplicada correctamente` junto con el
conteo de filas. Todo corre dentro de una transacción: si algo falla, no se aplica
ningún cambio y la base queda intacta.

Para deshacerlo:

```powershell
docker cp 003_rollback.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/003_rollback.sql
```

---

## Verificación realizada

La migración se ejecutó sobre una copia real de `respaldo_completo.sql` (18 personas,
13 usuarios, 8 empleados, 29 citas, 10 facturas, 86 logs).

- Ninguna fila se perdió ni se alteró.
- El `003_rollback.sql` devuelve el esquema **exactamente** al estado original, incluidos `nombre` y `apellido` reconstruidos idénticos.
- `esquema_final.sql` produce las mismas 141 columnas, 57 índices, 17 triggers y 2 vistas que la base migrada.
- 19 pruebas de comportamiento verificando que cada restricción realmente bloquee lo que debe bloquear: todas pasan.

---

## 1. El problema principal: nombres duplicados

`Persona` guardaba el mismo dato dos veces. Tu compañero corrió las migraciones
`001` y `002` (agregar las cuatro columnas y copiar los datos) pero nunca eliminó
las viejas, y el backend siguió usando únicamente `nombre` y `apellido`
(0 referencias a `primerNombre` en todo `src/`). Las columnas nuevas estaban muertas.

**Antes**

```
nombre  apellido  primerNombre  segundoNombre  primerApellido  segundoApellido
```

**Ahora**

```
primerNombre*  segundoNombre  primerApellido*  segundoApellido  nombreCompleto†
```

`*` obligatorio  `†` columna calculada, la mantiene PostgreSQL

`nombreCompleto` se arma solo a partir de las otras cuatro. No se puede desincronizar
porque no se puede escribir en ella. Sirve para que el backend y el frontend sigan
teniendo un solo campo para mostrar.

---

## 2. Resto de cambios

**Tipos de datos**

- `Cita.fecha` y `Cita.hora` eran **texto** → `DATE` y `TIME`. Antes nada impedía guardar `'manana'`.
- Todo el dinero pasó de `double precision` a `NUMERIC(12,2)`. Con punto flotante los centavos se pierden y el total de la factura deja de cuadrar con la suma de sus líneas.
- `Persona.fechaNac` → `DATE`.
- `DetalleFactura.totalLinea` ahora es calculada: `cantidad * precioUnitario`.

**Catálogos**

- Los `ENUM` `Rol` y `Puesto` se reemplazaron por tablas. Guardaban el mismo hecho por duplicado y un `ENUM` no se puede modificar sin `ALTER TYPE`.
- `User.rol` → `User.rolId`, `Empleado.puesto` → `Empleado.puestoId`, `HistorialCancelacionCita.rolCancela` → `rolCancelaId`.
- `EstadoCita` **sigue siendo `ENUM`** a propósito: es un conjunto cerrado que define la lógica de negocio, no un catálogo administrable.

**Reglas nuevas**

- Un doctor ya no puede tener dos citas activas a la misma hora. El índice es **parcial**: una cita cancelada libera su horario. (Sin esto era el bug de negocio más grave que tenía la base.)
- Un paciente tampoco puede estar en dos citas activas a la vez.
- `Persona.dni` único → se acabaron los pacientes duplicados.
- Un trigger valida que todo `doctorId` apunte a un empleado con puesto `DOCTOR`. Antes se podía agendar una cita con la recepcionista.
- El correo ahora es único **sin distinguir mayúsculas**: antes `Juan@Mail.com` y `juan@mail.com` eran dos cuentas distintas.
- Montos no negativos, cantidades mayores que cero, formato de DNI (13 dígitos) y teléfono (8 dígitos).
- Faltaba la clave foránea de `HistorialCancelacionCita.usuarioCancelaId`.

**Arreglos menores**

- `Logs.logout` tenía `DEFAULT CURRENT_TIMESTAMP`: una sesión abierta quedaba con hora de salida igual a la de entrada. Ahora queda `NULL` hasta el cierre real.
- `HistorialCancelacionCita` tenía `UNIQUE` en `citaId`: una tabla llamada "historial" solo admitía un registro por cita. Se quitó.
- `CodigoVerificacion` tenía `UNIQUE` en `userId`: el segundo intento de verificación de un mismo usuario fallaba. Se quitó.
- `updatedAt` tenía valor por defecto pero **nada lo actualizaba nunca**. Se agregaron triggers en las 12 tablas que lo tienen.
- Borrado en cascada donde corresponde: al borrar una factura ahora se borran sus líneas.
- **24 índices nuevos en claves foráneas.** PostgreSQL crea el de la clave primaria pero no el de las foráneas; sin ellos cada `JOIN` recorre la tabla entera.

**Dato inválido encontrado y corregido**

Los 10 registros de `CodigoVerificacion` tenían `fechaExpiracion` **8 días anterior** a
`fechaCreacion` — expiraban antes de existir. La migración los corrige y agrega la
restricción que impide que vuelva a pasar.

---

## 3. Lo que va a romperse (paso 2)

El backend es NestJS con SQL crudo sobre `pg`, sin ORM: hay que tocar las consultas a mano.

### Crítico

| Qué | Dónde | Qué hacer |
|---|---|---|
| `INSERT INTO "Persona" (nombre, apellido, ...)` | `Auth/auth.service.ts:267`, `Empleado/empleado.service.ts:30` | Usar las cuatro columnas nuevas |
| `INSERT INTO "User" (..., rol, ...)` | `Empleado/empleado.service.ts:51` | `rolId` |
| `INSERT INTO "Empleado" (..., puesto, ...)` | `Empleado/empleado.service.ts:40` | `puestoId` |
| `INSERT ... "totalLinea"` | `Factura/factura.service.ts:166` y `:217` | **Quitar la columna del INSERT.** Es calculada; incluirla da error |
| `UPDATE "Persona" SET` dinámico | `EditarInformacion/modificarInfo.service.ts:197`, `Empleado/empleado.service.ts:211` | Actualizar la lista de campos permitidos |
| `hc."rolCancela"` | `Citas/citas.service.ts:386` | `JOIN "Rol" r ON r.id = hc."rolCancelaId"` y seleccionar `r.nombre AS "rolCancela"` |

### Trampa con `pg` y NUMERIC

El driver `pg` devuelve las columnas `NUMERIC` **como string**, no como número.
`totalPagar` va a llegar como `"575.00"` en vez de `575`. Si el frontend hace
operaciones aritméticas, va a concatenar en lugar de sumar.

La solución en un solo lugar, en `src/database/db.ts`:

```ts
import pg from 'pg';
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
```

### Fecha y hora de las citas

Ahora son `DATE` y `TIME`, así que `pg` devuelve un objeto `Date` y el string
`'08:00:00'` en vez de `'2026-08-04'` y `'08:00'`. Para no tocar el frontend,
formatéalo en la consulta:

```sql
SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha,
       to_char(c.hora,  'HH24:MI')    AS hora
```

### Lo fácil

Los ~55 `SELECT p.nombre, p.apellido` repartidos en 26 archivos se resuelven casi
todos cambiando a `p."nombreCompleto"`, o seleccionando los cuatro campos cuando
el formulario los necesite por separado.

Para el rol y el puesto dejé dos vistas listas, `vw_Usuario` y `vw_Empleado`, que
ya devuelven `rol` y `puesto` como texto igual que antes. Consultándolas, el login
y la pantalla de empleados no necesitan cambios.

### Frontend

30 archivos mencionan `apellido`. Si el backend responde con la misma forma de
siempre (usando `to_char` y las vistas), la mayoría no necesita cambios.

Los que sí hay que tocar son los formularios de registro y edición, que es
justamente lo que pidió el profesor: agregar los campos de segundo nombre y
segundo apellido.

- `src/components/RegisterForm.tsx`
- `src/components/RecepcionistaComponentes/RegisterForm.tsx`
- `src/components/EditarPacienteModal.tsx`
- `src/components/EmpleadoModal.tsx`
- `src/pages/Registro.tsx`

---

## 4. Cosas que dejé como estaban

**~~No existe la entidad `Paciente`.~~ RESUELTO en la migración 005.** Ver la sección 5.

**`HistorialCancelacionCita.fechaCancelacion` es `TIMESTAMPTZ`** mientras el resto de
la base usa `TIMESTAMP` sin zona horaria. Convertirla desplazaría los valores según la
zona del servidor, así que no la toqué. Vale la pena mencionarlo pero no arreglarlo ahora.

**`Factura.subtotal` e `isv` siguen almacenados** aunque sean calculables desde las
líneas. Esto **no** es un error de normalización: una factura emitida es un documento
legal y debe reflejar lo que se cobró ese día, aunque después cambien los precios.
Si el profesor lo pregunta, esa es la justificación.

**Las descripciones de `DetalleFactura` son de otra clínica.** Los datos de prueba
dicen "Consulta dermatológica", "Consulta pediátrica" y "Electrocardiograma", que
no tienen nada que ver con odontología. Es basura de los datos semilla, no un
problema del esquema, pero conviene limpiarla antes de presentar.


---

# 5. Migración 005 — Paciente, fecha/hora de la cita y punto 6.2

Tercera ronda. Cubre tres cosas: la observación de tu compañero sobre `Cita`,
la tabla `Paciente` que había quedado pendiente, y el punto 6.2 del informe
(los requisitos fiscales que se habían documentado sin implementar).

**Verificación:** se aplicó sobre una copia real de la base (18 personas, 29
citas, 10 facturas). 36 pruebas de comportamiento, todas pasan. El rollback
devuelve el esquema al estado de la 004, con una única diferencia inevitable:
`updatedAt` cambia en las filas que la migración tocó, que es exactamente lo
que esa columna debe hacer.

---

## 5.1 `Cita.fecha` + `Cita.hora` → `Cita.fechaHora`

**La opinión que pediste, con el matiz importante.**

Tu compañero tiene razón en la conclusión pero no en el motivo. Guardar la
fecha y la hora por separado **no es un problema de normalización**: las formas
normales hablan de dependencias funcionales respecto de la clave, y tanto
`fecha` como `hora` son atómicas y dependen por completo de `Cita.id`. No se
viola 1FN, ni 2FN, ni 3FN, ni Boyce-Codd. Si en la defensa alguien dice "eso
está mal normalizado", la respuesta correcta es que no, que el problema es otro.

Pero **sí está mal**, por tres razones que no tienen que ver con normalización:

1. Son dos mitades de **un solo hecho**: cuándo es la cita. Separadas se pueden
   guardar a medias o quedar incoherentes entre sí.
2. Cualquier cálculo de intervalo obliga a recomponerlas. "Las citas de las
   próximas 24 horas" cruzando la medianoche no se resuelve comparando fecha y
   hora por separado sin escribir una condición con `OR`. El servicio de
   recordatorios tenía justamente ese bug.
3. Ordenar cronológicamente exige siempre `ORDER BY fecha, hora`.

**Qué se hizo.** Ahora hay una sola columna `fechaHora TIMESTAMP(3)`. `fecha` y
`hora` siguen existiendo, pero como columnas **generadas**: las calcula
PostgreSQL y no se puede escribir en ellas, así que no pueden desincronizarse.
Las consultas por día y la grilla de horarios siguen funcionando igual.

Una columna generada no es redundancia en el sentido que castiga la
normalización: la mantiene el motor, no la aplicación, y no puede quedar
desactualizada.

---

## 5.2 Entidad `Paciente`

`Cita`, `Factura` y `Expediente` apuntaban directo a `Persona`, mientras que el
empleado sí tenía tabla propia. Eso tenía dos consecuencias reales:

- No había forma de saber qué personas son pacientes. Había que deducirlo
  preguntando "¿aparece en alguna cita?", que no es lo mismo: un paciente
  registrado que todavía no agendó nada era invisible.
- Nada impedía agendarle una cita a alguien que solo existe como empleado, ni
  distinguir un paciente activo de uno dado de baja.

Ahora existe `Paciente(id, personaId UNIQUE, fechaRegistro, activo)` y las tres
tablas apuntan ahí. El modelo queda simétrico: `Persona` guarda lo que es cierto
de cualquier ser humano, `Empleado` y `Paciente` lo que es cierto de cada rol.

La migración creó los 10 pacientes que ya existían y remapeó las 29 citas, las
10 facturas y los 10 expedientes sin perder una sola fila.

---

## 5.3 Punto 6.2 — los requisitos fiscales que faltaban

| Faltaba | Qué se hizo |
|---|---|
| **RTN del emisor** | Tabla `Emisor` con razón social, RTN, dirección del punto de emisión, teléfono y correo. Cuelga de `RangoFacturacion`, no de cada factura: el SAR autoriza el CAI a un emisor concreto. |
| **RTN del cliente** | `Persona.rtn` (14 dígitos, único) y `Factura.rtnCliente`, que es la copia congelada al momento de emitir. Un trigger exige el RTN cuando el total supera L.100. |
| **Importes gravados** | `Factura.importeGravado15` e `importeGravado18`: las bases sobre las que se calcula cada ISV. Sin ellas el pie de la factura no se puede reconstruir, que es lo primero que revisa el SAR. Tres `CHECK` verifican que el pie cuadre al centavo. |
| **Estado y tipo de documento** | `tipoDocumento` (FACTURA / NOTA_CREDITO / NOTA_DEBITO) y `estado` (EMITIDA / ANULADA), con motivo y fecha de anulación. Un trigger **rechaza el `DELETE`**: una factura no se borra, se anula y se conserva. Anular una factura libera su cita para volver a facturarla. |

**Por qué el RTN va en dos lugares y no es redundancia.** `Persona.rtn` es el
dato vigente de la persona y cambia si ella lo cambia. `Factura.rtnCliente` es
lo que decía la factura el día que se emitió. Es el mismo criterio que ya se
usaba con el precio en `DetalleFactura`.

**Sigue pendiente y hay que corregirlo antes de usar el sistema de verdad:** el
RTN, la dirección y el teléfono del `Emisor` están cargados con valores
**PROVISIONALES**, igual que el CAI de la migración 004. Hay que reemplazarlos
por los reales.

Las 10 facturas viejas se emitieron cuando el RTN ni siquiera se guardaba, así
que quedaron sin él. La regla se aplica solo a lo que se emita de ahora en
adelante: no se inventaron RTN para rellenarlas.

---

## 5.4 Qué se tocó en el backend

El backend seguía escrito contra el esquema **anterior a la 003**: consultaba
`p.nombre`, `u.rol`, `e.puesto`, `c."doctorId"`, `f.cai`, `"aplicaISV"` y tres
columnas de contraseña temporal que nunca existieron. Estaba roto desde la
primera migración, no desde la 005.

**Criterio para no romper el frontend:** la API pública sigue hablando el mismo
idioma de antes. El backend traduce en el borde.

| La API sigue diciendo | La base guarda | Dónde se traduce |
|---|---|---|
| `pacienteId` (id de Persona) | id de `Paciente` | `src/common/pacientes.ts` |
| `doctorId` | `empleadoId` | alias en el `SELECT` |
| `nombre`, `apellido` | cuatro columnas | `src/common/nombres.ts` |
| `rol`, `puesto` como texto | `rolId`, `puestoId` | `JOIN` con el catálogo |
| `fecha` y `hora` por separado | `fechaHora` | `to_char()` en el `SELECT` |

Además:

- **Parser de `NUMERIC`** (`src/database/tipos-pg.ts`). El driver `pg` devuelve
  las columnas `NUMERIC` como **string**. Sin esto el frontend recibía
  `"575.00"` en vez de `575` y al sumar concatenaba: `500 + "75.00"` daba
  `"50075.00"`. Se arregla en un solo lugar, no en cada pantalla.
- **Parser de `DATE`**, por la razón inversa: un `DATE` convertido a `Date` de
  JavaScript se corría un día según la zona horaria del servidor.
- `filePath` y `totalLinea` salieron de los `INSERT`: son columnas generadas.
- Endpoint nuevo `POST /facturas/:id/anular`. No hay `DELETE` a propósito.
- El registro ahora crea también la fila en `Paciente`. Sin eso, un usuario
  nuevo podía entrar pero no agendar nada.

**Verificación:** 76 pruebas unitarias pasan, y `verificar-consultas.ts` ejecuta
las 38 consultas de todos los servicios contra una copia real de la base
migrada. Sirve para atrapar SQL roto, que el compilador de TypeScript no puede
ver porque son cadenas de texto.

```bash
npx ts-node verificar-consultas.ts
```

---

## 5.5 Qué se tocó en el frontend

- **Segundo nombre y segundo apellido, opcionales**, en el registro público
  (`RegisterForm.tsx`), el registro que hace recepción y el alta y edición de
  empleados (`EmpleadoModal.tsx`).
- `EditarPacienteModal.tsx`: los nombres pasaron de estar **deshabilitados** a
  ser editables. Antes no había forma de corregir un nombre mal escrito.
- Campo de **RTN** en el alta de pacientes, en la edición y en la pantalla de
  generar factura, con el aviso de que arriba de L.100 es obligatorio.
- La factura impresa muestra los datos reales del `Emisor`, el rango autorizado,
  los importes gravados y el sello **ANULADA** cuando corresponde. Antes la
  razón social y el RTN estaban escritos a mano en el HTML.

---

## 5.6 Lo que sigue pendiente

Ninguno de estos es un defecto introducido por este trabajo.

| Pendiente | Por qué |
|---|---|
| Datos reales del emisor y del CAI | Los cargados son provisionales. Hay que poner los que autorice el SAR. |
| Duración de la cita | `fechaHora` dice cuándo empieza, pero no cuánto dura. Hoy dos citas solo chocan si coinciden exactamente en el minuto. |
| Horario de atención por doctor | Nada impide agendar a las tres de la mañana. Los datos van de 08:00 a 16:00 por casualidad, no porque la base lo exija. |
| Bandera de cambio de contraseña | La pidió el ingeniero. La tabla `TokenAcceso` ya existe para eso; falta conectar el flujo. |
| `Logs` para clientes | Apunta a `Empleado`, así que los usuarios con rol cliente no dejan rastro. |
| `fechaCancelacion` con zona horaria | Es la única columna `TIMESTAMPTZ` de las treinta y una. Convertirla desplazaría los valores. |
| Datos semilla de otra clínica | Las líneas de factura de prueba dicen "Consulta dermatológica" y "Electrocardiograma". Conviene limpiarlo antes de presentar. |
