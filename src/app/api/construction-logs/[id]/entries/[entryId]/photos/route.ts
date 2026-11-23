import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireUser, isUuid } from '@/lib/api-auth';
import { checkLogAccess } from '@/lib/api-access';

interface RouteContext {
  params: Promise<{ id: string; entryId: string }>;
}

// Todas las operaciones requieren sesión, que la bitácora sea accesible para
// el usuario (checkLogAccess) y que la entrada pertenezca a esa bitácora.

/**
 * POST /api/construction-logs/[id]/entries/[entryId]/photos
 * Sube una foto a Supabase Storage y la registra en
 * construction_log_entry_photos. Mismo bucket "visit-photos" que las actas
 * (path distinto: bitacoras/{entry_id}/...).
 *
 * Form-data multipart: file, category?, description?, uploaded_by?, id?
 *
 * `id` opcional (UUID generado por la app móvil): subida idempotente — si
 * ya existe una foto con ese id se devuelve esa (`existing: true`) y el
 * archivo va a una ruta fija por id, así un reintento no duplica.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { user } = auth;
    const { id, entryId } = await context.params;
    const blocked = await checkLogAccess(user, id);
    if (blocked) return blocked;

    const { data: entry, error: eErr } = await supabaseAdmin
      .from('construction_log_entries')
      .select('id')
      .eq('id', entryId)
      .eq('log_id', id)
      .maybeSingle();
    if (eErr || !entry) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 });

    const formData = await request.formData();

    const rawId = formData.get('id');
    if (rawId !== null && !isUuid(rawId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    const clientId: string | null = isUuid(rawId) ? rawId : null;
    if (clientId) {
      const { data: existing } = await supabaseAdmin
        .from('construction_log_entry_photos')
        .select('*')
        .eq('id', clientId)
        .maybeSingle();
      if (existing) {
        if (existing.entry_id !== entryId) return NextResponse.json({ error: 'id ya usado en otra entrada' }, { status: 409 });
        const { data: signed } = await supabaseAdmin.storage.from('visit-photos').createSignedUrl(existing.storage_path, 3600);
        return NextResponse.json({ photo: { ...existing, url: signed?.signedUrl ?? null }, existing: true });
      }
    }

    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido en campo "file"' }, { status: 400 });

    const category = (formData.get('category') as string) || null;
    const description = (formData.get('description') as string) || null;
    const uploadedBy = user?.email ?? ((formData.get('uploaded_by') as string) || null);

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const storagePath = clientId
      ? `bitacoras/${entryId}/${clientId}.${safeExt}`
      : `bitacoras/${entryId}/${ts}-${rnd}.${safeExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: upErr } = await supabaseAdmin.storage
      .from('visit-photos')
      .upload(storagePath, arrayBuffer, { contentType: file.type || `image/${safeExt}`, upsert: !!clientId });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: photo, error: dbErr } = await supabaseAdmin
      .from('construction_log_entry_photos')
      .insert({
        ...(clientId ? { id: clientId } : {}),
        entry_id: entryId,
        category,
        storage_path: storagePath,
        filename: file.name,
        description,
        size_bytes: file.size,
        uploaded_by: uploadedBy,
      })
      .select('*')
      .single();
    if (dbErr) throw dbErr;

    const { data: signed } = await supabaseAdmin.storage.from('visit-photos').createSignedUrl(storagePath, 3600);
    return NextResponse.json({ photo: { ...photo, url: signed?.signedUrl ?? null } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/construction-logs/[id]/entries/[entryId]/photos?photo_id=...
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { id, entryId } = await context.params;
    const blocked = await checkLogAccess(auth.user, id);
    if (blocked) return blocked;

    const url = new URL(request.url);
    const photoId = url.searchParams.get('photo_id');
    if (!photoId) return NextResponse.json({ error: 'photo_id requerido' }, { status: 400 });

    const { data: entry } = await supabaseAdmin
      .from('construction_log_entries')
      .select('id')
      .eq('id', entryId)
      .eq('log_id', id)
      .maybeSingle();
    if (!entry) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 });

    const { data: photo } = await supabaseAdmin
      .from('construction_log_entry_photos')
      .select('storage_path')
      .eq('id', photoId)
      .eq('entry_id', entryId)
      .single();
    if (!photo) return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 });

    await supabaseAdmin.storage.from('visit-photos').remove([photo.storage_path]);
    await supabaseAdmin.from('construction_log_entry_photos').delete().eq('id', photoId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
