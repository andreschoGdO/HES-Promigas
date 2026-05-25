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

## 4. Email Auth con Outlook (Microsoft OAuth)

### En Supabase

1. Dashboard → Authentication → Providers → **Azure (Microsoft)**
2. Enable + agrega:
   - Azure Client ID (de tu Azure App Registration)
   - Azure Client Secret
   - Tenant ID (o `common` para multi-tenant)
3. Add Redirect URL: `https://tu-vercel-app.vercel.app/auth/callback`

### En Azure (registrar la app)

1. https://portal.azure.com → Azure AD → App registrations → New
2. Single tenant (tu org @gdo.com.co) o Multi-tenant
3. Redirect URI: `https://upiehuyqhxaqoavtxbig.supabase.co/auth/v1/callback`
4. Copia Client ID y crea un Client Secret

### Restricción de dominio @gdo.com.co

Ya implementada en `src/middleware.ts` — rechaza cualquier email que no termine en `@gdo.com.co`.

## 5. Cron Manual

Para correr el sync una vez:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://tu-vercel-app.vercel.app/api/cron/sync
```

O desde el dashboard pulsa **Sincronizar Metrum** (llama al mismo endpoint vía `x-trigger: manual`).
