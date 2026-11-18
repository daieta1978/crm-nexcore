# CRM Nexcore

CRM básico, sin servidor propio y gratis de alojar:

- **Login por usuario** (email + contraseña) con Supabase Auth.
- **Cada usuario ve solo sus datos** (reglas RLS en la base). Los usuarios con rol `admin` ven todo.
- Contactos, Empresas, Negocios (tablero por etapas con arrastrar y soltar), Actividades/tareas.
- Búsqueda en cada pantalla y panel de Inicio con totales.

Sin configurar Supabase la app arranca en **modo demo** (datos solo en el navegador), útil para probarla.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `styles.css`, `app.js`, `logo.png` | La app (HTML/JS puro, sin build) |
| `config.js` | Acá van la URL y la clave pública de Supabase |
| `supabase/schema.sql` | Tablas + seguridad por usuario. Se pega una sola vez en Supabase |

## Puesta en marcha (todo gratis)

### 1. Base de datos y login: Supabase
1. Crear cuenta en https://supabase.com y un proyecto nuevo (plan Free).
2. Ir a **SQL Editor → New query**, pegar todo `supabase/schema.sql` y tocar **Run**.
3. Ir a **Project Settings → API** y copiar **Project URL** y la **anon public key**.
4. Pegarlas en `config.js`.

### 2. Publicar el sitio: GitHub Pages
1. Crear un repositorio en GitHub (por ejemplo `crm-nexcore`) y subir estos archivos.
2. En el repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. En 1-2 minutos queda en `https://<usuario>.github.io/crm-nexcore/`.

(Alternativa igual de gratis: Netlify o Vercel, importando el mismo repo.)

### 3. Ajustes finales en Supabase
- **Authentication → URL Configuration → Site URL**: poner la URL del sitio (para que el email de confirmación vuelva al CRM).
- Para hacerte administrador (ver datos de todos), en SQL Editor:
  `update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';`
- Si no querés que cualquiera se registre: **Authentication → Sign In / Providers → desactivar "Allow new users to sign up"** y crear los usuarios desde **Authentication → Users → Add user**.

## Seguridad
La clave `anon` es pública por diseño. Lo que protege los datos son las políticas RLS del `schema.sql`:
nadie puede leer, editar ni borrar registros de otro usuario salvo un `admin`.
