import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/construction-logs/[id]/entries
 * Body: { entry_date?, etapa?, clima?, descripcion, observaciones?, lat?, lng? }
 * Agrega una entrada nueva. Bloquea si la bitácora ya está cerrada.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const descripcion = String(body.descripcion ?? '').trim();
    if (!descripcion) return NextResponse.json({ error: 'descripcion es requerida' }, { status: 400 });

    const { data: log, error: logErr } = await supabaseAdmin
      .from('construction_logs')
      .select('id, status')
      .eq('id', id)
      .single();
    if (logErr || !log) return NextResponse.json({ error: 'Bitácora no encontrada' }, { status: 404 });
    if (log.status === 'cerrada') {
      return NextResponse.json({ error: 'Esta bitácora está cerrada — reábrela para agregar entradas.' }, { status: 409 });
    }

    let createdBy: string | null = null;
    try {
      const supa = await createSupabaseServer();
      const { data } = await supa.auth.getUser();
      createdBy = data.user?.email?.toLowerCase() ?? null;
    } catch { /* sin sesión disponible */ }

    const { data: entry, error } = await supabaseAdmin
      .from('construction_log_entries')
      .insert({
        log_id: id,
        entry_date: body.entry_date ?? new Date().toISOString().slice(0, 10),
        etapa: body.etapa ?? null,
        clima: body.clima ?? null,
        descripcion,
        observaciones: body.observaciones ?? null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;

    await supabaseAdmin.from('construction_logs').update({ updated_at: new Date().toISOString() }).eq('id', id);

    return NextResponse.json({ entry: { ...entry, photos: [] } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
