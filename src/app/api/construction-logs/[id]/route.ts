import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/construction-logs/[id]
 * Devuelve la bitácora + sus entradas (con fotos) ordenadas por fecha de
 * entrada descendente (la más reciente primero, como un feed).
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const { data: log, error: logErr } = await supabaseAdmin
    .from('construction_logs')
    .select('*')
    .eq('id', id)
    .single();
  if (logErr || !log) return NextResponse.json({ error: 'Bitácora no encontrada' }, { status: 404 });

  const { data: entries, error: entriesErr } = await supabaseAdmin
    .from('construction_log_entries')
    .select('*')
    .eq('log_id', id)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 });

  const entryIds = (entries ?? []).map((e) => e.id);
  let photosByEntry: Record<string, unknown[]> = {};
  if (entryIds.length > 0) {
    const { data: photos, error: photosErr } = await supabaseAdmin
      .from('construction_log_entry_photos')
      .select('*')
      .in('entry_id', entryIds);
    if (photosErr) return NextResponse.json({ error: photosErr.message }, { status: 500 });
    photosByEntry = {};
    for (const p of photos ?? []) {
      const key = (p as { entry_id: string }).entry_id;
      if (!photosByEntry[key]) photosByEntry[key] = [];
      // Signed URL de preview — igual que field_visit_photos.
      photosByEntry[key].push(p);
    }
    // Firmar URLs en batch
    const paths = (photos ?? []).map((p) => (p as { storage_path: string }).storage_path);
    if (paths.length > 0) {
      const { data: signedList } = await supabaseAdmin.storage.from('visit-photos').createSignedUrls(paths, 3600);
      const urlByPath = new Map((signedList ?? []).map((s) => [s.path, s.signedUrl]));
      for (const key of Object.keys(photosByEntry)) {
        photosByEntry[key] = photosByEntry[key].map((p) => ({
          ...(p as object),
          url: urlByPath.get((p as { storage_path: string }).storage_path) ?? null,
        }));
      }
    }
  }

  const entriesWithPhotos = (entries ?? []).map((e) => ({ ...e, photos: photosByEntry[e.id] ?? [] }));

  return NextResponse.json({ log, entries: entriesWithPhotos });
}

/**
 * PATCH /api/construction-logs/[id]
 * Body: { status?: 'abierta' | 'cerrada', contratista? }
 * Cerrar/reabrir la bitácora, o actualizar el contratista.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    let actor: string | null = null;
    try {
      const supa = await createSupabaseServer();
      const { data } = await supa.auth.getUser();
      actor = data.user?.email?.toLowerCase() ?? null;
    } catch { /* sin sesión disponible */ }

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.contratista !== undefined) payload.contratista = body.contratista;
    if (body.status === 'cerrada') {
      payload.status = 'cerrada';
      payload.closed_by = actor;
      payload.closed_at = new Date().toISOString();
    } else if (body.status === 'abierta') {
      payload.status = 'abierta';
      payload.closed_by = null;
      payload.closed_at = null;
    }

    const { data, error } = await supabaseAdmin
      .from('construction_logs')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ log: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/construction-logs/[id]
 * Borra la bitácora completa (entradas y fotos en cascade a nivel de BD;
 * los archivos en Storage se limpian aparte, la BD no los toca).
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { data: entries } = await supabaseAdmin.from('construction_log_entries').select('id').eq('log_id', id);
    const entryIds = (entries ?? []).map((e) => e.id);
    if (entryIds.length > 0) {
      const { data: photos } = await supabaseAdmin
        .from('construction_log_entry_photos')
        .select('storage_path')
        .in('entry_id', entryIds);
      if (photos && photos.length > 0) {
        await supabaseAdmin.storage.from('visit-photos').remove(photos.map((p) => p.storage_path));
      }
    }
    const { error } = await supabaseAdmin.from('construction_logs').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
