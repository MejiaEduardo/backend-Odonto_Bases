# Activar el inicio de sesión con Google

El código ya está completo en ambos lados. Lo único que falta son las
credenciales, que solo puede crearlas alguien con una cuenta de Google:
son gratis y toma unos 10 minutos.

**Mientras no las pongas, el proyecto funciona igual**: el botón de Google
simplemente no aparece en el login. Eso es a propósito (ver el final).

---

## 1. Crear las credenciales en Google Cloud Console

1. Entrá a <https://console.cloud.google.com/> con cualquier cuenta de Google.
2. Arriba a la izquierda, **Seleccionar proyecto → Proyecto nuevo**.
   Nombre: `Clinica Odontologica`. Crear.
3. Menú lateral → **API y servicios → Pantalla de consentimiento de OAuth**.
   - Tipo de usuario: **Externo**. Crear.
   - Nombre de la app: `Clínica Odontológica`.
   - Correo de asistencia y de contacto: el tuyo.
   - Guardar y continuar hasta el final (los permisos por defecto bastan:
     solo se piden `email` y `profile`).
   - En **Usuarios de prueba**, agregá los correos con los que vayan a
     probar. Mientras la app esté en modo prueba, solo esos pueden entrar.
4. Menú lateral → **Credenciales → Crear credenciales → ID de cliente de OAuth**.
   - Tipo de aplicación: **Aplicación web**.
   - Nombre: `Backend Odonto`.
   - En **URI de redireccionamiento autorizados**, agregá exactamente:

     ```
     http://localhost:3000/auth/google/callback
     ```

     Tiene que coincidir carácter por carácter con `GOOGLE_CALLBACK_URL`.
     Si no coincide, Google responde `redirect_uri_mismatch`.
   - Crear. Google muestra el **ID de cliente** y el **secreto**.

## 2. Pegarlas en el `.env` del backend

Agregá estas cuatro líneas:

```env
# --- Google OAuth ---
GOOGLE_CLIENT_ID=pega-aqui-el-id-de-cliente
GOOGLE_SECRET=pega-aqui-el-secreto
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# A dónde vuelve el usuario cuando Google termina
FRONTEND_URL=http://localhost:5173
```

## 3. Reiniciar el backend

```
npm run start:dev
```

Comprobá que quedó activo:

```powershell
curl.exe http://localhost:3000/auth/google/status
```

- `{"habilitado":true}` → el botón ya aparece en el login.
- `{"habilitado":false}` → falta alguna de las dos variables, o el backend
  no releyó el `.env`.

---

## Cómo funciona el flujo

```
[Login]  clic en "Iniciar sesión con Google"
   ↓  navega a
GET http://localhost:3000/auth/google        (backend)
   ↓  redirige a
Pantalla de Google: elegir cuenta
   ↓  vuelve a
GET /auth/google/callback                    (backend)
   ↓  validateGoogleUser: si el correo no existe, crea el usuario como CLIENTE
   ↓  redirige a
http://localhost:5173/auth/callback?token=…  (frontend)
   ↓  guarda el token y pide GET /auth/me
   ↓
Redirige según el rol → /home/paciente, /dashboard, etc.
```

---

## Lo que había que arreglar (para el informe)

Nada de esto estaba conectado. Eran cinco piezas sueltas:

1. **`passport-google-oauth20` no estaba instalado.** Solo estaban los
   `@types`, así que TypeScript compilaba sin quejarse y el error solo
   aparecía al ejecutar. Instalado con `npm install passport-google-oauth20`.

2. **`GoogleStrategy` no estaba en los `providers`** de `AuthModule`, así
   que `AuthGuard('google')` respondía
   *"Unknown authentication strategy 'google'"* con error 500.

3. **`googleOauthConfig` no se registraba en ningún módulo.** Usa
   `registerAs` de `@nestjs/config`, que exige `ConfigModule.forRoot({ load: [...] })`.
   Sin eso, `@Inject(googleOauthConfig.KEY)` no encuentra el proveedor.

4. **El frontend esperaba un `postMessage`** desde un popup, pero el
   backend termina con `res.redirect(...)`. Dos diseños incompatibles: el
   botón no hacía absolutamente nada. Ahora se navega en la misma pestaña.

5. **La ruta `/auth/callback` no existía en el frontend.** El token
   aterrizaba en el comodín `*` del router, que mostraba la landing, y se
   perdía en silencio.

De paso se corrigieron dos cosas relacionadas:

- **`AuthModule` no estaba en `app.module.ts`.** Llegaba a la aplicación
  de rebote porque `EmpleadoModule` lo importa. Si alguien tocaba ese
  módulo, se caía el login entero sin motivo aparente.
- **El `.env` solo se cargaba desde `database/db.ts`**, a media cadena de
  módulos. Cualquier código que leyera `process.env` antes veía `undefined`.
  Ahora `main.ts` hace `import 'dotenv/config'` en su primera línea.

## Por qué el botón se oculta en vez de mostrarse siempre

`passport-google-oauth20` lanza *"OAuth2Strategy requires a clientID
option"* durante el arranque si el `clientID` viene vacío, y eso **tumba
todo el backend**, no solo el login con Google.

Por eso la estrategia se registra únicamente cuando las credenciales
existen (`src/Auth/config/google.enabled.ts`), y el frontend consulta
`GET /auth/google/status` para decidir si dibuja el botón. Así el
proyecto arranca igual en la máquina de cualquier compañero que no tenga
las credenciales, sin botones que revienten al pulsarlos.
