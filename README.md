# Backend — Clínica Odontológica

API REST para un sistema de gestión de clínica dental: citas, expedientes
clínicos, empleados y facturación.

Proyecto de la clase **IS-802 Ingeniería de Software** — UNAH.

---

## Tecnologías

| | |
|---|---|
| Framework | NestJS (Node.js + TypeScript) |
| Base de datos | PostgreSQL 16 en Docker |
| Acceso a datos | `pg` (node-postgres) con **SQL puro, sin ORM** |
| Autenticación | JWT + Passport, con permisos por rol |
| Validación | `class-validator` con `ValidationPipe` global |
| Documentación | Swagger en `/api` |
| Tiempo real | WebSockets para notificaciones |
| Archivos | Firebase Storage *(opcional)* |

> **No se usa ningún ORM.** Los nombres de tabla en PascalCase entre
> comillas (`"Persona"`, `"User"`) son residuo de un esquema generado con
> Prisma, pero todas las consultas son SQL escrito a mano.

---

## Repositorios

| | |
|---|---|
| Backend (este) | <https://github.com/MejiaEduardo/backend-Odonto_Bases> |
| Frontend | <https://github.com/MejiaEduardo/Bases_Frontend_odontologia> |

Hay que levantar los dos para que el sistema funcione.

---

## Cómo levantarlo

**Guía completa y paso a paso: [`INSTALACION.pdf`](INSTALACION.pdf)** —
incluye instalación, carga de la base, conexión con pgAdmin y solución de
los errores más frecuentes.

Resumen para quien ya tenga Docker y Node:

```powershell
# 1. Base de datos
docker compose up -d

# 2. Esquema y datos (el orden importa, ver INSTALACION.pdf)
docker cp tablas.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/tablas.sql
# ... el resto de los .sql

# 3. Backend (misma carpeta)
npm install
copy .env.example .env
npm run start:dev          # http://localhost:3000  (Swagger en /api)
```

---

## Roles y permisos

Cuatro roles, cada uno con su propia pantalla y sus propios permisos:

| Rol | Qué puede hacer |
|---|---|
| **ADMIN** | empleados, servicios, especialidades, expedientes, reportes |
| **DOCTOR** | su agenda, cerrar citas atendidas, registrar consultas |
| **RECEPCIONISTA** | aprobar solicitudes, registrar pacientes, facturar |
| **CLIENTE** | solicitar y confirmar citas, ver su historial |

El detalle endpoint por endpoint está en
[`PRUEBAS_PERMISOS.md`](PRUEBAS_PERMISOS.md).

---

## Ciclo de vida de una cita

```
SOLICITADA ──aprobar(recepción)──> PENDIENTE ──confirmar(cliente)──> CONFIRMADA
                                       └────── completar (doctor) ──────┘
                                                       ↓
                                                  COMPLETADA → facturable
```

Una cita solo se puede facturar cuando el doctor la marca como atendida,
ya sea con el botón o automáticamente al registrar la consulta en el
expediente.

---

## Estructura del repositorio

```
backend-Odonto_Bases/
├── docker-compose.yml       PostgreSQL 16 (puerto 5433)
├── tablas.sql               esquema: tablas, ENUM, llaves foráneas
├── datos.sql                datos de prueba
├── arreglar-*.sql           correcciones al esquema original
├── migracion-*.sql          cambios posteriores, en orden
├── INSTALACION.pdf          guía de instalación
├── package.json
└── src/
    ├── Auth/                login, JWT, guards, Google OAuth
    ├── Citas/               agenda y estados de las citas
    ├── Expediente/          expedientes y consultas
    ├── Factura/             facturación con CAI e ISV
    ├── Empleado/            personal de la clínica
    ├── Servicios/           catálogo de servicios
    ├── Especialidad/        especialidades odontológicas
    └── Notificaciones/      WebSockets
```

---

## Documentación

| Archivo | Contenido |
|---|---|
| [`INSTALACION.pdf`](INSTALACION.pdf) | montar el proyecto desde cero |
| [`ESTADO_ACTUAL.md`](ESTADO_ACTUAL.md) | en qué quedó el trabajo y qué falta |
| [`PRUEBAS_PERMISOS.md`](PRUEBAS_PERMISOS.md) | permisos por rol y cómo verificarlos |
| [`GUIA_LOGIN_GOOGLE.md`](GUIA_LOGIN_GOOGLE.md) | activar el login con Google |
| [`SUBIR_A_GITHUB.md`](SUBIR_A_GITHUB.md) | publicar cambios sin filtrar credenciales |

---

## Frontend

La interfaz vive en un repositorio aparte:
<https://github.com/MejiaEduardo/Bases_Frontend_odontologia>

Hay que levantar los dos para que el sistema funcione.

---

## Notas para el equipo

- **El `.env` no está en el repositorio.** Copiá `.env.example` y
  completalo. Los valores por defecto ya sirven para desarrollo.
- **El puerto de la base es 5433**, no 5432. El 5432 suele estar ocupado
  por el PostgreSQL instalado en Windows, que es una base distinta y
  vacía.
- **Firebase es opcional.** Sin sus credenciales el backend arranca igual;
  lo único que no funciona es adjuntar archivos a los expedientes.
- Antes de subir cambios, comprobá que compila:
  `npx tsc --noEmit -p tsconfig.json` debe dar 0 errores.
