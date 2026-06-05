import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/facturacion/events?project_id=...&limit=...
 * Devuelve el audit log de cambios de un proyecto en orden cronológico inverso.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);
  if (!projectId) return NextResponse.json({ error: 'project_id requerido' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('facturacion_events')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}
