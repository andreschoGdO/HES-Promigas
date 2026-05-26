import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/visits/[id]/photos
 * Sube una foto a Supabase Storage y registra en field_visit_photos.
 *
 * Form-data multipart:
 *   - file: blob
 *   - description: string (opcional)
 *   - uploaded_by: string (opcional)
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: visitId } = await context.params;

    // Verificar que la visita existe
    const { data: visit, error: vErr } = await supabaseAdmin
      .from('field_visits')
      .select('id, casa, visit_type')
      .eq('id', visitId)
      .single();
    if (vErr || !visit) return NextResponse.json({ error: 'Visita no encontrada' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Archivo requerido en campo "file"' }, { status: 400 });

    const description = (formData.get('description') as string) || null;
    const uploadedBy = (formData.get('uploaded_by') as string) || null;

    // Path: visits/{visit_id}/{timestamp}-{random}.{ext}
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    const storagePath = `visits/${visitId}/${ts}-${rnd}.${safeExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: upErr } = await supabaseAdmin.storage
      .from('visit-photos')
      .upload(storagePath, arrayBuffer, { contentType: file.type || `image/${safeExt}` });
    if (upErr) {
      const msg = upErr.message.toLowerCase().includes('bucket')
        ? `Bucket "visit-photos" no existe en Supabase Storage. Crear en Dashboard → Storage → New bucket (private, image/*, 10MB max).`
        : upErr.message;
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const { data: photo, error: dbErr } = await supabaseAdmin
      .from('field_visit_photos')
      .insert({
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
 * DELETE /api/visits/[id]/photos?photo_id=...
 * Borra una foto específica.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id: visitId } = await context.params;
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
