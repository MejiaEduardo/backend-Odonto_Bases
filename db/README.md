# Base de datos — orden de los scripts

Esta carpeta tiene las migraciones que corrigen el esquema (003, 004 y 005),
sus reversos y la documentación del modelo.

**El orden importa.** Cada migración supone que la anterior ya corrió.

---

## Si ya tenés la base montada

Es el caso normal: instalaste siguiendo `INSTALACION.md` y querés ponerte al
día con los cambios nuevos (los cuatro campos de nombre, la tabla `Paciente`,
los datos fiscales).

Desde la raíz del repositorio, en PowerShell:

```powershell
# 1. Respaldo. No te lo saltes: estas migraciones cambian tablas.
docker exec odonto-db pg_dump -U postgres -d odontologia > respaldo_antes_de_migrar.sql

# 2. Copiar los scripts al contenedor
docker cp 001_agregar_campos_persona.sql odonto-db:/tmp/
docker cp 002_migrar_datos_persona.sql   odonto-db:/tmp/
docker cp db/003_pulido_esquema.sql      odonto-db:/tmp/
docker cp db/004_correcciones_ingeniero.sql odonto-db:/tmp/
docker cp db/005_paciente_y_fiscal.sql   odonto-db:/tmp/
docker cp db/006_filepath_desde_storagename.sql odonto-db:/tmp/

# 3. Ejecutarlos EN ESTE ORDEN
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/001_agregar_campos_persona.sql
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/002_migrar_datos_persona.sql
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/003_pulido_esquema.sql
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/004_correcciones_ingeniero.sql
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/005_paciente_y_fiscal.sql
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/006_filepath_desde_storagename.sql
```

Cada migración avisa al terminar (`Migracion 00X aplicada correctamente`).
Todas corren dentro de una transacción: si algo falla, no se aplica nada y la
base queda intacta.

> **En DataGrip**, el modo de transacción `Auto` confirma cada sentencia por
> separado y anula esa garantía. Usá `Manual`, o corré por línea de comandos.

### Comprobar que quedó bien

```powershell
node db/comprobar-sistema.mjs
```

Tiene que decir que las migraciones 003, 004 y 005 están aplicadas y que
`Cita.fechaHora` existe.

---

## Si estás instalando desde cero

El orden completo, ya verificado de punta a punta sobre una base vacía:

| # | Script | Para qué |
|---|---|---|
| 1 | `tablas.sql` | Crea el esquema base |
| 2 | `arreglar-updatedAt.sql` | Pone el valor por defecto de `updatedAt` |
| 3 | `datos.sql` | Datos de prueba |
| 4 | `arreglar-passwords.sql` | Deja las contraseñas de prueba en `123456` |
| 5 | `migracion-estado-solicitada.sql` | Estado SOLICITADA de las citas |
| 6 | `migracion-servicios-odontologicos.sql` | Catálogo de servicios |
| 7 | `migracion-aviso-cancelacion.sql` | Aviso de cancelación al paciente |
| 8 | `migracion-evitar-duplicados.sql` | Evita pacientes repetidos |
| 9 | `migracion-expedientes-odontologicos.sql` | Expedientes |
| 10 | `001_agregar_campos_persona.sql` | Las cuatro columnas de nombre |
| 11 | `002_migrar_datos_persona.sql` | Copia los nombres a las columnas nuevas |
| 12 | `db/003_pulido_esquema.sql` | Tipos, catálogos, integridad e índices |
| 13 | `db/004_correcciones_ingeniero.sql` | Permisos, auditoría, facturación |
| 14 | `db/005_paciente_y_fiscal.sql` | Paciente, `fechaHora` y punto 6.2 |
| 15 | `db/006_filepath_desde_storagename.sql` | Corrige la ruta de los archivos de expediente |

Los pasos 10 y 11 ya no hacen falta en una base nueva, porque `tablas.sql` crea
esas columnas. Se dejan porque son inofensivos: `001` usa `IF NOT EXISTS`.

El paso 15 tampoco hace falta si la `004` que corriste ya es la corregida: la
`006` lo detecta y no cambia nada. Correrla de más no cuesta.

**Atajo:** `esquema_final.sql` crea la base entera ya corregida, sin pasar por
las catorce. Pero la deja **vacía**, solo con los catálogos. Sirve para un
entorno limpio, no para tener los datos de prueba.

---

## Los archivos

| Archivo | Qué es |
|---|---|
| `003_pulido_esquema.sql` | Nombres en cuatro columnas, tipos de datos, catálogos `Rol` y `Puesto`, integridad, índices |
| `003_rollback.sql` | Revierte la 003 |
| `004_correcciones_ingeniero.sql` | Permisos, auditoría, `empleadoId`, tokens, recordatorios, rango de facturación |
| `005_paciente_y_fiscal.sql` | `Cita.fechaHora`, tabla `Paciente`, `Emisor`, RTN, importes gravados, anulación de facturas |
| `005_rollback.sql` | Revierte la 005 |
| `006_filepath_desde_storagename.sql` | Corrige `filePath`: la 004 lo derivaba del `expedienteId` y así rompía la ruta real de los archivos subidos. Ahora se deriva de `storageName` |
| `esquema_final.sql` | Crea la base desde cero, ya con todo aplicado. Es la documentación del modelo |
| `CAMBIOS_Y_IMPACTO.md` | Qué cambió, por qué, y qué queda pendiente |
| `Correcciones_Base_de_Datos.pdf` | El informe de la auditoría |
| `comprobar-sistema.mjs` | Revisa base, backend y frontend de una sola pasada |

---

## Antes de usar el sistema de verdad

El **RTN, la dirección y el teléfono del `Emisor`**, y el **CAI** del rango de
facturación, están cargados con valores **PROVISIONALES**. Hay que
reemplazarlos por los que autorice el SAR:

```sql
UPDATE "Emisor" SET rtn = '...', direccion = '...', telefono = '...' WHERE id = 1;
UPDATE "RangoFacturacion" SET cai = '...', "fechaLimiteEmision" = '...' WHERE id = 1;
```
