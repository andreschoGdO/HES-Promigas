import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireUser, isUuid } from '@/lib/api-auth';
import { checkVisitAccess } from '@/lib/api-access';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Todas las operaciones requieren sesión y, para contratistas, que la visita
// sea suya (ver checkVisitAccess).

/**
 * POST /api/visits/[id]/photos
 * Sube una foto a Supabase Storage y registra en field_visit_photos.
 *
 * Form-data multipart:
 *   - file: blob
 *   - description: string (opcional)
 *   - uploaded_by: string (opcional — solo se usa sin sesión, entorno dev)
 *   - id: UUID (opcional, lo envía la app móvil) — hace la subida
 *         idempotente: si ya existe una foto con ese id se devuelve esa
 *         (`existing: true`) y el archivo va a una ruta fija por id, así un
 *         reintento tras perder la conexión no duplica ni deja huérfanos.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { user } = auth;
    const { id: visitId } = await context.params;
    const blocked = await checkVisitAccess(user, visitId);
    if (blocked) return blocked;

    // Verificar que la visita existe
    const { data: visit, error: vErr } = await supabaseAdmin
      .from('field_visits')
      .select('id, casa, visit_type')
      .eq('id', visitId)
      .single();
    if (vErr || !visit) return NextResponse.json({ error: 'Visita no encontrada' }, { status: 404 });

    const formData = await request.formData();

    const rawId = formData.get('id');
    if (rawId !== null && !isUuid(rawId)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    const clientId: string | null = isUuid(rawId) ? rawId : null;
    if (clientId) {
      const { data: existing } = await supabaseAdmin.from('field_visit_photos').select('*').eq('id', clientId).maybeSingle();
      if (existing) {
        if (existing.visit_id !== visitId) return NextResponse.json({ error: 'id ya usado en otra acta' }, { status: 409 });
        const { data: signed } = await supabaseAdmin.storage.from('visit-photos').createSignedUrl(existing.storage_path, 3600);
        return NextResponse.json({ photo: { ...existing, url: signed?.signedUrl ?? null }, existing: true });
      }
    }

    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido en campo "file"' }, { status: 400 });

    const description = (formData.get('description') as string) || null;
    const uploadedBy = user?.email ?? ((formData.get('uploaded_by') as string) || null);

    // Path: visits/{visit_id}/{timestamp}-{random}.{ext}
    // (con id de cliente: visits/{visit_id}/{id}.{ext}, sobrescribible)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const storagePath = clientId
      ? `visits/${visitId}/${clientId}.${safeExt}`
      : `visits/${visitId}/${ts}-${rnd}.${safeExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: upErr } = await supabaseAdmin.storage
      .from('visit-photos')
      .upload(storagePath, arrayBuffer, { contentType: file.type || `image/${safeExt}`, upsert: !!clientId });
    if (upErr) {
      const msg = upErr.message.toLowerCase().includes('bucket')
        ? `Bucket "visit-photos" no existe en Supabase Storage. Crear en Dashboard → Storage → New bucket (private, image/*, 10MB max).`
        : upErr.message;
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const { data: photo, error: dbErr } = await supabaseAdmin
      .from('field_visit_photos')
      .insert({
        ...(clientId ? { id: clientId } : {}),
        visit_id: visitId,
        storage_path: storagePath,
        filename: file.name,
        description,
        size_bytes: file.size,
        uploaded_by: uploadedBy,
      })
      .select('*')
      .single();
    if (dbErr) throw dbErr;

    // Signed URL para preview inmediato
    const { data: signed } = await supabaseAdmin.storage
      .from('visit-photos')
      .createSignedUrl(storagePath, 3600);

    return NextResponse.json({ photo: { ...photo, url: signed?.signedUrl ?? null } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/visits/[id]/photos?photo_id=...
 * Body: { description }
 * Cambia el título/categoría de una foto. La web lo hace hoy escribiendo
 * directo en la tabla; esta ruta existe para la app móvil, que no tiene
 * acceso directo a la base.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { id: visitId } = await context.params;
    const blocked = await checkVisitAccess(auth.user, visitId);
    if (blocked) return blocked;

    const photoId = new URL(request.url).searchParams.get('photo_id');
    if (!photoId) return NextResponse.json({ error: 'photo_id requerido' }, { status: 400 });

    const body = await request.json();
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;

    const { data: photo, error } = await supabaseAdmin
      .from('field_visit_photos')
      .update({ description })
      .eq('id', photoId)
      .eq('visit_id', visitId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!photo) return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 });
    return NextResponse.json({ photo });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/visits/[id]/photos?photo_id=...
 * Borra una foto específica.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { id: visitId } = await context.params;
    const blocked = await checkVisitAccess(auth.user, visitId);
    if (blocked) return blocked;

    const url = new URL(request.url);
    const photoId = url.searchParams.get('photo_id');
    if (!photoId) return NextResponse.json({ error: 'photo_id requerido' }, { status: 400 });

    const { data: photo } = await supabaseAdmin
      .from('field_visit_photos')
      .select('storage_path')
      .eq('id', photoId)
      .eq('visit_id', visitId)
      .single();
    if (!photo) return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 });

    await supabaseAdmin.storage.from('visit-photos').remove([photo.storage_path]);
    await supabaseAdmin.from('field_visit_photos').delete().eq('id', photoId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
