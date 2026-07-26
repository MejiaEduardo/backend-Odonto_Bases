# Pruebas de permisos

Los cuatro controladores que estaban abiertos (`citas`, `facturas`,
`especialidad`, `Servicios`) ahora exigen sesión. Esta guía sirve para
comprobar que quedó bien **antes de entregar**.

Requisitos: backend levantado (`npm run start:dev`) y la base en Docker.

---

## 1. Sin token: todo debe responder 401

En PowerShell, `curl` es un alias de `Invoke-WebRequest` y se comporta
distinto. Usá `curl.exe` (con la extensión) para que funcione igual que
en Linux.

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/citas
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/facturas
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/especialidad
```

Esperado: **401** en las tres. Antes devolvían **200** con todos los datos.

## 2. El catálogo público debe seguir abierto

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/Servicios
```

Esperado: **200**. Si esto da 401, la landing y `/services` se rompen para
cualquier visitante que no haya iniciado sesión.

## 3. Con token, pero del rol equivocado: 403

Primero sacá un token iniciando sesión como **cliente**:

```powershell
curl.exe -s -X POST http://localhost:3000/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"correo\":\"CORREO_DEL_CLIENTE\",\"contrasena\":\"LA_CLAVE\"}"
```

Copiá el valor de `token` y probá un endpoint que **no** le corresponde:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/facturas `
  -H "Authorization: Bearer PEGA_EL_TOKEN"
```

Esperado: **403 Forbidden**, con el mensaje
`No tienes permiso para realizar esta acción. Rol requerido: RECEPCIONISTA, ADMIN`.

Repetir la idea con los demás roles:

| Token de      | Endpoint                        | Esperado |
|---------------|---------------------------------|----------|
| CLIENTE       | `GET /citas`                    | 403      |
| CLIENTE       | `GET /facturas`                 | 403      |
| CLIENTE       | `POST /especialidad`            | 403      |
| DOCTOR        | `GET /facturas/reportes`        | 403      |
| DOCTOR        | `PATCH /citas/1/aprobar`        | 403      |
| RECEPCIONISTA | `PATCH /citas/1/completar`      | 403      |
| RECEPCIONISTA | `GET /facturas/reportes`        | 403      |
| ADMIN         | `GET /facturas/reportes`        | 200      |

## 4. Prueba de humo en la interfaz

Lo que hay que recorrer con cada rol para confirmar que **nada** se rompió.
Si algo devuelve 401 o 403 de más, revisá que esa llamada mande la cabecera
`Authorization`.

- **Sin iniciar sesión** — abrir la landing y `/services`: los servicios
  odontológicos tienen que verse igual que antes.
- **CLIENTE** — solicitar una cita, editarla, confirmarla, cancelarla, y
  ver el aviso de cancelación.
- **RECEPCIONISTA** — panel de solicitudes (aprobar / rechazar / confirmar),
  buscar paciente, registrar cliente, y **generar una factura**.
- **DOCTOR** — ver sus citas, marcar una como atendida, registrar
  inasistencia, y crear una consulta en el expediente.
- **ADMIN** — empleados, servicios, especialidades, expedientes,
  historial de facturas y reportes.
- **Cerrar sesión** con un doctor o recepcionista: ahora sí debe quedar
  registrado en la tabla `Logs` (antes fallaba en silencio).

---

## Lo que esto NO resuelve

El guard valida **qué rol** sos, no **de quién** es el dato. Un CLIENTE
autenticado todavía puede pedir las citas de otro paciente cambiando el id
en la URL:

```
GET /citas/paciente/7        <- funciona aunque el token sea del paciente 3
GET /expediente/paciente/7   <- lo mismo
```

Para cerrarlo hay que comparar el `id` del token (`req.user.id`) contra el
dueño del recurso dentro del servicio, y responder 403 si no coinciden.
Los endpoints afectados son:

- `GET /citas/paciente/:pacienteId`
- `GET /citas/:id`
- `PATCH /citas/:id` y `PATCH /citas/:id/cancelar`
- `GET /expediente/paciente/:id` y `GET /expediente/:id`

Es el siguiente paso natural si quieren dejar la seguridad completa.
