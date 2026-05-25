import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase-server';

/**
 * GET /auth/callback?code=...&next=/dashboard
 * Intercambia el código OTP (del magic link) por una sesión cookie.
 * Si todo OK redirige a `next` (default /dashboard).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  if (!code) {
    const u = new URL(url.toString());
    u.pathname = '/login';
    u.searchParams.set('error', 'no-code');
    return NextResponse.redirect(u);
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const u = new URL(url.toString());
    u.pathname = '/login';
    u.searchParams.set('error', 'exchange-failed');
    return NextResponse.redirect(u);
  }

  // Validar dominio antes de redirigir (@gdo.com.co o @promigas.com)
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase() ?? '';
  if (!email.endsWith('@gdo.com.co') && !email.endsWith('@promigas.com')) {
    await supabase.auth.signOut();
    const u = new URL(url.toString());
    u.pathname = '/login';
    u.searchParams.set('error', 'domain');
    return NextResponse.redirect(u);
  }

  const u = new URL(url.toString());
  u.pathname = next.startsWith('/') ? next : '/dashboard';
  u.search = '';
  return NextResponse.redirect(u);
}
