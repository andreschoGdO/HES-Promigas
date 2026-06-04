import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const KEY = 'granular_views';

/**
 * GET /api/settings/granular-views
 *   Devuelve el array de vistas guardadas (global, compartido entre usuarios).
 *
 * PUT /api/settings/granular-views
 *   Body: { views: GranularView[], actor_email?: string }
 *   Reemplaza el array completo. El frontend agrega/edita/elimina y reenvía
 *   el array entero para mantener la API simple.
 */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const views = Array.isArray(data?.value) ? data.value : [];
  return NextResponse.json({ views });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.views)) {
      return NextResponse.json({ error: 'views (array) requerido' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .upsert(
        { key: KEY, value: body.views, updated_by: body.actor_email ?? null },
        { onConflict: 'key' },
      )
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ views: data.value, updated_at: data.updated_at });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
