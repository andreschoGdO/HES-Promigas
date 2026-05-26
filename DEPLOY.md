# Deploy — HES Promigas SUNNY APP

## 1. GitHub

El commit local ya está listo (`main` branch). Para subir:

```bash
# Crea el repo primero en https://github.com/new (vacío, sin README) con nombre HES-Promigas
# Luego desde /webapp:
git push -u origin main
```

Si pide credenciales, usa un Personal Access Token con permiso `repo`:
- https://github.com/settings/tokens/new

## 2. Vercel

1. Importa el repo en https://vercel.com/new
2. **Framework**: Next.js (auto-detectado)
3. **Root Directory**: `/` (raíz)
4. **Environment Variables** (copia desde `.env.local`):
   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   METRUM_API_URL
   METRUM_USERNAME
   METRUM_PASSWORD
   CRON_SECRET  ← Genera con: openssl rand -hex 32
   ```
5. Deploy. El cron horario (`/api/cron/sync`) se activa automáticamente desde `vercel.json`.

## 3. Migración SQL pendiente

Antes de que el cron funcione completamente, ejecuta en el **Supabase SQL Editor**:

```
supabase_phase2_casa_metrics.sql
```

Esto crea `daily_casa_metrics` (métricas pre-computadas) y `cron_runs` (auditoría).
Sin esto, el dashboard usa fallback en vivo (más lento, sin imax pre-computado).

## 4. Auth: Email + Password (simplificado)

> **Cambio reciente**: la app ahora usa **email + password** en vez de magic link OTP.
> Más simple, sin dependencia de SMTP, sin rate limits de Supabase free tier.

### Cómo crear usuarios

1. Supabase Dashboard → **Authentication** → **Users** → **Add user** → **Create new user**
2. Llenar:
   - **Email**: `nombre@gdo.com.co` (o `@promigas.com`)
   - **Password**: contraseña temporal (mín 6 caracteres)
   - **Auto Confirm User**: ✅ marcado (importante — si no, el usuario no puede entrar)
3. **Create user**
4. Pasarle al usuario su email + password por canal seguro
5. (Opcional) Usuario cambia su password después en Supabase o vía un menú futuro de "Mi perfil"

### Configuración en Supabase

1. **Authentication → Providers → Email** → debe estar habilitado (default)
2. **Authentication → Sign in / Up** → desactiva **"Enable email signups"** si NO quieres que cualquiera con email pueda registrarse (recomendado: OFF, tú creas las cuentas a mano)
3. **Authentication → URL Configuration**:
   - Site URL: `https://sunnyhes.vercel.app`
   - Redirect URLs: `https://sunnyhes.vercel.app/**`

### Restricción de dominio

Ya implementada en 3 capas:
- `src/middleware.ts` — rechaza sesiones de emails fuera de `@gdo.com.co` / `@promigas.com`
- `src/app/login/page.tsx` — valida antes de enviar el login
- `src/app/auth/callback/route.ts` — valida también en callbacks (por si vuelven con magic link)

Para agregar dominios adicionales, edita la constante `ALLOWED_DOMAINS` en los 3 archivos.

---

## 4-bis. (Legacy) Email Auth con código OTP — solo si vuelves al magic link

### a) Habilitar Email Auth en Supabase

1. Dashboard Supabase → **Authentication** → **Providers** → **Email**
2. Toggle ON: `Enable email signup`, `Confirm email`
3. Toggle OFF: `Enable email change confirmations` (opcional)
4. **Site URL**: `https://tu-vercel-app.vercel.app`
5. **Redirect URLs**: agrega `https://tu-vercel-app.vercel.app/auth/callback`

### b) Aplicar el template "SUNNY APP" al correo

1. Dashboard Supabase → **Authentication** → **Email Templates**
2. Selecciona el template **"Magic Link"**
3. **Subject**: `SUNNY APP — Código de acceso`
4. **From name**: `SUNNY APP`
5. **Message body**: pega TODO el contenido de `supabase_email_template_magic_link.html`
6. Click **Save changes**

El template incluye:
- Logo solar + nombre "SUNNY APP"
- Código de 6 dígitos prominente (`{{ .Token }}`)
- Botón alternativo "Entrar a SUNNY APP" con magic link (`{{ .ConfirmationURL }}`)
- Branding HES Promigas

### c) Restricción de dominio @gdo.com.co

Ya implementada en `src/middleware.ts` y `src/app/login/page.tsx` — rechaza cualquier email que no termine en `@gdo.com.co` tanto al enviar el código como al verificar.

### d) Flujo del usuario

1. Usuario va a `/login`
2. Escribe su correo `xxx@gdo.com.co` → "Enviar código"
3. Recibe email "SUNNY APP — Código de acceso" en su Outlook
4. Lee el código de 6 dígitos en el correo
5. Lo escribe en el campo de la app → "Verificar y entrar"
6. Sesión iniciada, redirige a `/dashboard`

### e) Dev local (sin Magic Link configurado todavía)

Hasta que actives el provider Email en Supabase, pon en `.env.local`:
```
DISABLE_AUTH=1
```
El middleware ignora la autenticación y te deja entrar directo. **No uses esto en producción.**

## 5. Cron Manual

Para correr el sync una vez:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://tu-vercel-app.vercel.app/api/cron/sync
```

O desde el dashboard pulsa **Sincronizar Metrum** (llama al mismo endpoint vía `x-trigger: manual`).
