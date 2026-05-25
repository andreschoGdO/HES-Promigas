import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Middleware de autenticación:
 *   1. Refresca la sesión (cookies) en cada request
 *   2. Si la ruta requiere auth y no hay sesión → redirige a /login
 *   3. Si la sesión existe pero el email NO termina en @gdo.com.co → cierra sesión y manda a /login
 *
 * Excepciones (no requieren auth):
 *   - /login, /auth/callback
 *   - /api/cron/* (Vercel Cron usa CRON_SECRET, ver route.ts)
 *   - /_next/*, /favicon.ico, /icon.svg
 */

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
];

const ALLOWED_DOMAIN = '@gdo.com.co';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rutas estáticas y APIs no se interceptan
  // (las rutas API devuelven sus propios 401 si requieren auth, NUNCA HTML redirects)
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg' ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png')
  ) {
    return NextResponse.next();
  }

  // Escape para desarrollo local antes de configurar Magic Link en Supabase.
  // Pon DISABLE_AUTH=1 en .env.local para deshabilitar el guardia.
  // NO usar en producción.
  if (process.env.DISABLE_AUTH === '1') {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Rutas públicas: dejar pasar (pero si ya está autenticado y va a /login, redirigir al dashboard)
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (user && pathname === '/login') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Sin sesión → login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Validación de dominio @gdo.com.co
  const email = user.email ?? '';
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'domain');
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
