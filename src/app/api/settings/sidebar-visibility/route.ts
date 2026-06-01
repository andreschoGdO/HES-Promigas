import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const KEY = 'sidebar_visibility';

/**
 * GET /api/settings/sidebar-visibility
 * Devuelve la configuración global de visibilidad del menú lateral.
 * Si nunca se ha guardado, devuelve {} (todo visible por defecto).
 */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ visibility: data?.value ?? {} });
}

/**
 * PUT /api/settings/sidebar-visibility
 * Body: { visibility: SidebarVisibility, actor_email?: string }
 * Aplica a todos los usuarios de la cuenta (es global).
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (!body.visibility || typeof body.visibility !== 'object') {
      return NextResponse.json({ error: 'visibility (object) requerido' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .upsert({ key: KEY, value: body.visibility, updated_by: body.actor_email ?? null }, { onConflict: 'key' })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ visibility: data.value, updated_at: data.updated_at });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
