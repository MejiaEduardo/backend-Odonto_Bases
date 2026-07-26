# Subir el proyecto a GitHub

Guía para publicar los dos proyectos sin romper nada y sin filtrar
credenciales.

**Lo importante primero:** el frontend y el backend son **dos repositorios
separados**, y su situación es distinta.

| | Frontend | Backend |
|---|---|---|
| ¿Ya tiene repositorio? | **Sí** | **Sí** |
| Dónde | `github.com/MejiaEduardo/Bases_Frontend_odontologia` | `github.com/MejiaEduardo/backend-Odonto_Bases` |
| Rama actual | `develop` | — |
| Estado | **subido** (commit `a06a6e3`) | pendiente el primer push |

> **No los juntes en un repositorio solo.** El frontend ya tiene tres
> commits y dos ramas con historial compartido con tu equipo; fusionarlo
> con el backend obligaría a reescribir ese historial y a que todos
> volvieran a clonar. No vale la pena.

---

## Antes de empezar: lo que YA está resuelto

Revisé los dos proyectos antes de escribir esto:

- **Ningún `.env` está en el historial de git.** Verificado con
  `git log --all -- .env` en el frontend: nunca se subió. Las
  credenciales están a salvo.
- **`node_modules` no está versionado** en ninguno de los dos.
- **Ningún token ni clave hardcodeada** en el código fuente.
- **Ningún archivo pesa más de 5 MB**, así que no hay riesgo de topar con
  el límite de 100 MB de GitHub.
- **Se creó `.gitignore` en la raíz del backend.** Hacía falta: el que ya
  existía está en la carpeta interna y **no cubría el `.env` de la raíz**.
  Sin ese archivo, la contraseña de la base y el `JWT_SECRET` se habrían
  publicado.

> **Ojo, esto lo causé yo:** para comprobar que el `.gitignore` funcionaba
> tuve que inicializar un repositorio de prueba en la raíz del backend. Al
> intentar borrarlo, el entorno donde corro no tuvo permisos y quedó una
> carpeta `.git` a medias, con un archivo `index.lock` bloqueado. Está
> **vacía** (0 commits, 0 remotos, 0 archivos), pero si intentás usarla
> vas a ver *"Unable to create index.lock: File exists"*.
>
> **Se resuelve borrándola desde Windows**, que es el primer comando del
> Paso 3.2. Son diez segundos.

---

## Paso 0 — Limpiar los datos de prueba (antes de publicar)

Dos correcciones al contenido, no al código. Conviene hacerlas primero
para que lo que se sube ya esté bien.

**1. Los expedientes de prueba eran de una clínica médica**, no dental:
"Dolor de pecho / Hipertensión arterial", "Crisis asmática /
Nebulización con salbutamol", "Diabetes tipo 2 / Metformina". Ya está
corregido en `datos.sql`, pero tu base ya cargada sigue con los viejos.

**2. Hay una consulta con texto inapropiado** que se escribió probando
("Desgarre de ano" / "Amputacion"). Está solo en tu base local, no en
`datos.sql`.

Las dos se arreglan con el mismo script:

```powershell
cd C:\Users\ferna\Downloads\backend-Odonto_Bases-main
docker cp migracion-expedientes-odontologicos.sql odonto-db:/tmp/
docker exec odonto-db psql -U postgres -d odontologia -f /tmp/migracion-expedientes-odontologicos.sql
```

La última consulta del script debe devolver `registros_sospechosos = 0`.

> Solo toca los expedientes 1..8 y los detalles 1..10, que son los del
> seed. Nada de lo que hayas capturado a mano se pierde.

---

## Paso 1 — Configurar git (solo la primera vez)

Si nunca usaste git en esta máquina:

```powershell
git config --global user.name "Fernando Ortiz"
git config --global user.email "dl6314262@gmail.com"
```

El correo debería ser el mismo de tu cuenta de GitHub, para que los
commits se te atribuyan en el perfil.

**Autenticación.** GitHub ya no acepta la contraseña de la cuenta al
hacer `push`. Dos opciones:

- **GitHub CLI** (lo más simple): instalar de <https://cli.github.com>, y
  después `gh auth login` → *GitHub.com* → *HTTPS* → *Login with a web
  browser*. Queda configurado para siempre.
- **Token personal**: en GitHub, *Settings → Developer settings →
  Personal access tokens → Tokens (classic) → Generate new token*, marcar
  el permiso **repo**. Cuando `git push` pida la contraseña, pegar el
  token (no la contraseña de la cuenta).

---

## Paso 2 — Frontend: subir los cambios pendientes

El repositorio ya existe. Solo hay que comitear y empujar.

```powershell
cd C:\Users\ferna\Downloads\Bases_Frontend_odontologia_lurvin\Bases_Frontend_odontologia_lurvin
```

**1. Ver en qué rama estás y qué cambió:**

```powershell
git branch --show-current      # deberia decir: develop
git status
```

Vas a ver unos 147 archivos entre modificados y nuevos. Es normal: es
todo el trabajo de estas sesiones.

**2. Comprobar que NO se cuela nada sensible** — este es el paso que no
hay que saltarse:

```powershell
git status --porcelain | Select-String -Pattern "\.env|secret|credential|node_modules"
```

**Si no devuelve nada, está limpio.** Si aparece algún `.env`, parate y
avisá antes de continuar.

**3. Agregar todo y comitear:**

```powershell
git add .
git commit -m "Conecta el frontend al backend real y completa los cuatro roles

- Flujo de citas: SOLICITADA, aprobacion de recepcion y confirmacion del cliente
- El doctor cierra las citas como atendidas o marca inasistencia
- Aviso al paciente cuando le cancelan, con el motivo
- Motivos de cancelacion segun quien cancela
- Catalogo odontologico en todos los roles
- Login: regreso al inicio, recuperacion de contrasena y callback de Google
- Corrige el doctorId fijo al registrar consultas
- 0 errores de TypeScript y build correcto"
```

**4. Subir:**

```powershell
git push origin develop
```

> **¿Por qué a `develop` y no a `main`?** Porque es la rama en la que
> venías trabajando y la que comparte tu equipo. Pasar a `main` es una
> decisión del grupo: se hace con un *Pull Request* en GitHub, así los
> demás pueden revisar antes de fusionar.

**Si el push es rechazado** con *"Updates were rejected because the
remote contains work that you do not have locally"*, es que un compañero
subió cambios. Traelos primero:

```powershell
git pull origin develop --no-rebase
```

Si hay conflictos, git marca los archivos afectados; hay que editarlos,
resolver las marcas `<<<<<<<`, y después `git add` + `git commit`. Luego
repetir el push.

---

## Paso 2.5 — URGENTE: arreglar `src/Pages` antes de que alguien clone

**El frontend se subió con un problema que rompe el proyecto en Linux y
en macOS.** En tu máquina no se nota.

Git tiene **40 archivos guardados en `src/Pages/`** (con P mayúscula),
pero los **45 imports del código piden `src/pages/`** (minúscula). Cuando
renombramos la carpeta, Windows no distingue mayúsculas de minúsculas, así
que git nunca registró el cambio.

Consecuencia: un compañero con Mac de disco sensible a mayúsculas, o
cualquier despliegue en Linux, va a ver esto al compilar:

```
Cannot find module '../pages/LoginPage' or its corresponding type declarations
```

...multiplicado por 45.

### Cómo arreglarlo

Git no puede hacer un renombrado que solo cambia mayúsculas en un disco
que las ignora. Hay que pasar por un nombre intermedio:

```powershell
cd C:\Users\ferna\Downloads\Bases_Frontend_odontologia_lurvin\Bases_Frontend_odontologia_lurvin

git mv src/Pages src/__pages_tmp
git mv src/__pages_tmp src/pages
```

Comprobar que el índice quedó bien:

```powershell
git ls-files | Select-String -Pattern "^src/Pages/" | Measure-Object -Line   # debe dar 0
git ls-files | Select-String -Pattern "^src/pages/" | Measure-Object -Line   # debe dar 40
```

Comprobar que sigue compilando y subirlo:

```powershell
npx tsc --noEmit -p tsconfig.app.json      # 0 errores
git add .
git commit -m "Corrige la grafia de src/Pages a src/pages

Git guardaba la carpeta como 'Pages' mientras los imports usan 'pages'.
En Windows no se nota porque el sistema de archivos ignora mayusculas,
pero en Linux y macOS el proyecto no compila."
git push origin develop
```

> Ese `git add .` va a incluir además unos 81 archivos que aparecen como
> modificados. **No son cambios reales**: difieren solo en el fin de línea
> (CRLF contra LF), residuo de haberlos editado con scripts.
> Comprobado con `git diff --ignore-all-space`, que no muestra ninguna
> diferencia. Se pueden subir sin problema; lo único molesto es que en
> GitHub el diff se ve como si el archivo entero hubiera cambiado.

---

## Paso 3 — Backend: fusionar con el repositorio del equipo

**El repositorio del backend YA EXISTÍA** con 10 commits del equipo
(`Probado el backend y listo para acoplar el front`, `fireBase listo`,
`integracion de auth y citas`...). Está en:

```
https://github.com/MejiaEduardo/backend-Odonto_Bases
```

### El problema: las estructuras no coinciden

| | Remoto (el del equipo) | Tu copia local |
|---|---|---|
| Dónde está `src/` | en la raíz | dentro de `backend-Odonto_Bases-main/` |
| Dónde está `package.json` | en la raíz | dentro de `backend-Odonto_Bases-main/` |

Tu copia está anidada un nivel porque salió de un ZIP descargado de
GitHub, y esos ZIP envuelven todo en una carpeta con sufijo `-main`.

**Si hacés `git pull --allow-unrelated-histories` y empujás, el
repositorio queda con DOS copias completas del backend:**

```
src/                          ← la del equipo, SIN tus correcciones
package.json
backend-Odonto_Bases-main/    ← tu copia, CON las correcciones
    src/
    package.json
```

Quien clone no sabría cuál usar, y `npm install` en la raíz compilaría el
código viejo. Además serían 68 archivos en conflicto, uno por uno.

### La buena noticia

Tu `src/` es un **superconjunto exacto** del remoto: los mismos 68
archivos, más 10 nuevos (todo `Especialidad/`, todo `Factura/` y
`Auth/config/google.enabled.ts`). No borraste nada de ellos. Así que tu
versión reemplaza la suya sin perder trabajo de nadie.

### Cómo hacerlo bien: clonar y copiar encima

Así el historial del equipo se conserva y tus cambios aparecen como un
commit normal encima, no como una fusión de historias ajenas.

**1. Clonar el repositorio de verdad, en una carpeta nueva:**

```powershell
cd C:\Users\ferna\Downloads
git clone https://github.com/MejiaEduardo/backend-Odonto_Bases.git
```

**2. Copiar tu código encima del suyo:**

```powershell
$viejo = "C:\Users\ferna\Downloads\backend-Odonto_Bases-main"
$nuevo = "C:\Users\ferna\Downloads\backend-Odonto_Bases"

# El codigo (reemplaza src/ completo)
Copy-Item "$viejo\backend-Odonto_Bases-main\src\*" "$nuevo\src\" -Recurse -Force

# package.json y package-lock.json: traen passport-google-oauth20
Copy-Item "$viejo\backend-Odonto_Bases-main\package.json"      "$nuevo\" -Force
Copy-Item "$viejo\backend-Odonto_Bases-main\package-lock.json" "$nuevo\" -Force

# La plantilla de variables de entorno, corregida
Copy-Item "$viejo\backend-Odonto_Bases-main\.env.example" "$nuevo\" -Force

# La base de datos y las guias (todos nuevos)
Copy-Item "$viejo\*.sql"            "$nuevo\" -Force
Copy-Item "$viejo\*.md"             "$nuevo\" -Force
Copy-Item "$viejo\INSTALACION.pdf"  "$nuevo\" -Force
Copy-Item "$viejo\docker-compose.yml" "$nuevo\" -Force
```

> **No copies el `.gitignore` de la carpeta vieja.** Ese lo escribí para
> la estructura anidada. El del repositorio ya cubre `.env` y
> `node_modules`; si querés las reglas extra (dumps de base de datos,
> claves de Firebase), agregalas a mano al final del que ya está.

**3. Crear tu `.env` y comprobar que compila:**

```powershell
cd $nuevo
copy .env.example .env
npm install
npx tsc --noEmit -p tsconfig.json      # tiene que dar 0 errores
```

**4. Revisar qué va a subir, y que no se cuele el `.env`:**

```powershell
git status --short
git status --porcelain | Select-String -Pattern "\.env$"
```

Ese último no debe devolver nada.

**5. Comitear y subir:**

```powershell
git add .
git commit -m "Conecta el backend con el frontend y cierra el flujo de citas

- Estado SOLICITADA y endpoints aprobar, completar y enterado
- Permisos por rol en citas, facturas, especialidad y Servicios
- Modulos de Especialidad y Factura
- Login con Google: registra GoogleStrategy y su configuracion
- Esquema, datos de prueba y migraciones en SQL
- Guias de instalacion, permisos y publicacion"
git push origin main
```

**6. Cuando termine, borrá la carpeta vieja** para no volver a editar la
copia equivocada:

```powershell
Remove-Item -Recurse -Force "C:\Users\ferna\Downloads\backend-Odonto_Bases-main"
```

> A partir de ahora la carpeta de trabajo del backend es
> `C:\Users\ferna\Downloads\backend-Odonto_Bases`, y **ya no hay
> carpeta anidada**: el `package.json` y los `.sql` están juntos en la
> raíz. Las guías ya se actualizaron para reflejarlo.

---

## Paso 4 — Verificar en GitHub

Abrir el repositorio en el navegador y comprobar, uno por uno:

- [ ] Se ven las carpetas y los archivos `.sql`.
- [ ] **NO** aparece ningún archivo `.env` (sí debe estar `.env.example`).
- [ ] **NO** aparece la carpeta `node_modules`.
- [ ] Los `.md` se leen bien, con los acentos correctos.
- [ ] `tablas.sql`, `datos.sql` y las migraciones están presentes.

**Prueba definitiva** — clonar en otra carpeta y montarlo desde cero
siguiendo `INSTALACION.pdf`:

```powershell
cd C:\Users\ferna\Desktop
git clone https://github.com/MejiaEduardo/backend-Odonto_Bases.git prueba-clon
cd prueba-clon
```

Si podés levantarlo ahí sin pedirle nada a nadie más que el `.env`, tus
compañeros también van a poder. Cuando termines, borrá la carpeta.

---

## Si subiste un `.env` por error

Pasa, y hay que actuar rápido.

**Borrarlo del repositorio no es suficiente**: queda en el historial y
cualquiera puede recuperarlo. El orden correcto es:

1. **Cambiar las credenciales primero.** Considerá la contraseña y el
   `JWT_SECRET` como comprometidos. En este proyecto es fácil: editar
   `POSTGRES_PASSWORD` en `docker-compose.yml`, `DB_PASSWORD` en el
   `.env`, y regenerar `JWT_SECRET`.
2. **Quitarlo del seguimiento** y subir el `.gitignore`:

   ```powershell
   git rm --cached .env
   git commit -m "Quita el .env del seguimiento"
   git push
   ```

3. **Limpiar el historial**, si el repositorio es público o hay
   credenciales reales. Con [git-filter-repo](https://github.com/newren/git-filter-repo):

   ```powershell
   git filter-repo --path .env --invert-paths --force
   git push --force
   ```

   Reescribir el historial obliga a todo el equipo a volver a clonar.
   Avisales antes.

En nuestro caso las credenciales son locales de desarrollo
(`odonto123`), así que el daño sería bajo — pero la costumbre correcta es
cambiarlas igual.

---

## Errores frecuentes

| Mensaje | Causa | Solución |
|---|---|---|
| `remote origin already exists` | ya había un remoto configurado | `git remote set-url origin <URL>` |
| `Updates were rejected... fetch first` | hay commits en GitHub que no tenés | `git pull origin <rama> --no-rebase` |
| `failed to push some refs` + `main -> main` | marcaste "Add a README" al crear el repo | `git pull origin main --allow-unrelated-histories` |
| `Authentication failed` | usaste la contraseña de la cuenta | usar un token personal o `gh auth login` |
| `Support for password authentication was removed` | lo mismo | igual que arriba |
| `src refspec main does not match any` | no hay ningún commit todavía | `git commit` antes del push |
| `LF will be replaced by CRLF` | avisos de fin de línea en Windows | son avisos, no errores: se pueden ignorar |
| El push tarda muchísimo | se está subiendo `node_modules` | cancelar, revisar el `.gitignore` y `git rm -r --cached node_modules` |

---

## Qué se sube y qué no

**Sí se versiona:**

- Todo el código fuente (`src/`), `package.json` y `package-lock.json`
- El esquema y los datos: `tablas.sql`, `datos.sql`, las migraciones
- `docker-compose.yml` — así cualquiera levanta la misma base
- `.env.example` como plantilla
- Los `.md` y el `INSTALACION.pdf`

**No se versiona:**

- `.env` — credenciales
- `node_modules/` — se reconstruye con `npm install`
- `dist/` y `build/` — se regeneran al compilar
- Claves de Firebase, `.pem`, `.key`
- Respaldos de la base (`*.dump`, `backup*.sql`): pueden llevar datos de
  pacientes. El esquema y el seed sí van; los respaldos no.

> **`package-lock.json` sí se sube.** Es lo que garantiza que todo el
> equipo instale exactamente las mismas versiones. Borrarlo es la causa
> típica del "en mi máquina funciona".

---

## Sobre la base de datos

No se sube la base en sí, sino **las instrucciones para reconstruirla**:
`tablas.sql` (estructura), `datos.sql` (datos de prueba) y las
migraciones. Es lo correcto — una base de datos binaria no se versiona.

Cualquiera clona el repositorio, corre `docker compose up -d`, ejecuta
los `.sql` en el orden del `INSTALACION.pdf`, y obtiene una base idéntica
a la tuya.

Si en algún momento necesitan compartir el estado exacto de una base con
datos capturados a mano, se hace con un dump — pero **fuera de git**, y
revisando antes que no lleve información personal real:

```powershell
docker exec odonto-db pg_dump -U postgres -d odontologia > respaldo.sql
```

El `.gitignore` ya ignora `respaldo*.sql` y `backup*.sql` justamente para
que no se suban por descuido.
