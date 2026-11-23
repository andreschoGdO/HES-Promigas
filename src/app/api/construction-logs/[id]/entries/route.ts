import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireUser, isUuid } from '@/lib/api-auth';
import { checkLogAccess } from '@/lib/api-access';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/construction-logs/[id]/entries
 * Body: { entry_date?, etapa?, clima?, descripcion, observaciones?, lat?, lng?, id? }
 * Agrega una entrada nueva. Bloquea si la bitácora ya está cerrada.
 * Requiere sesión y, para contratistas, que la bitácora sea suya.
 *
 * `id` opcional (UUID generado por la app móvil): creación idempotente —
 * si ya existe una entrada con ese id en esta bitácora se devuelve esa
 * (`existing: true`), aunque la bitácora se haya cerrado entre tanto.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { user } = auth;
    const { id } = await context.params;
    const blocked = await checkLogAccess(user, id);
    if (blocked) return blocked;

    const body = await request.json();
    const descripcion = String(body.descripcion ?? '').trim();
    if (!descripcion) return NextResponse.json({ error: 'descripcion es requerida' }, { status: 400 });

    if (body.id !== undefined) {
      if (!isUuid(body.id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
      const { data: existing } = await supabaseAdmin
        .from('construction_log_entries')
        .select('*')
        .eq('id', body.id)
        .maybeSingle();
      if (existing) {
        if (existing.log_id !== id) return NextResponse.json({ error: 'id ya usado en otra bitácora' }, { status: 409 });
        return NextResponse.json({ entry: { ...existing, photos: [] }, existing: true });
      }
    }

    const { data: log, error: logErr } = await supabaseAdmin
      .from('construction_logs')
      .select('id, status')
      .eq('id', id)
      .single();
    if (logErr || !log) return NextResponse.json({ error: 'Bitácora no encontrada' }, { status: 404 });
    if (log.status === 'cerrada') {
      return NextResponse.json({ error: 'Esta bitácora está cerrada — reábrela para agregar entradas.' }, { status: 409 });
    }

    const { data: entry, error } = await supabaseAdmin
      .from('construction_log_entries')
      .insert({
        ...(isUuid(body.id) ? { id: body.id } : {}),
        log_id: id,
        entry_date: body.entry_date ?? new Date().toISOString().slice(0, 10),
        etapa: body.etapa ?? null,
        clima: body.clima ?? null,
        descripcion,
        observaciones: body.observaciones ?? null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        created_by: user?.email ?? null,
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
