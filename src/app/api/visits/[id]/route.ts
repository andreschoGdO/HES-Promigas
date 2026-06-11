import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';
import { linkVisitToInventory } from '@/lib/inventory-visit-link';
import { getRoleFromEmail } from '@/lib/user-role';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Si el usuario es contratista (rol 'user'), solo puede ver/editar/borrar
 * sus propias visitas (created_by = su email). Devuelve null si está OK,
 * o un NextResponse con 403/404 si debe bloquearse.
 */
async function enforceOwnership(visitId: string): Promise<NextResponse | null> {
  try {
    const supa = await createSupabaseServer();
    const { data } = await supa.auth.getUser();
    const email = data.user?.email?.toLowerCase() ?? null;
    if (!email) return null; // sin sesión, deja que la regla normal de upstream maneje
    if (getRoleFromEmail(email) === 'admin') return null; // admins pasan
    // user: validar que la visita le pertenezca
    const { data: visit } = await supabaseAdmin
      .from('field_visits')
      .select('created_by')
      .eq('id', visitId)
      .maybeSingle();
    if (!visit) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
    const owner = (visit.created_by ?? '').toLowerCase();
    if (owner !== email) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/visits/[id]
 * Trae una visita + sus fotos asociadas con signed URLs.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const blocked = await enforceOwnership(id);
  if (blocked) return blocked;

  const { data: visit, error } = await supabaseAdmin
    .from('field_visits')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: photos } = await supabaseAdmin
    .from('field_visit_photos')
    .select('*')
    .eq('visit_id', id)
    .order('uploaded_at', { ascending: true });

  // Generar signed URLs para cada foto (válidas 1 h)
  const photosWithUrl = await Promise.all((photos ?? []).map(async (p) => {
    const { data: signed } = await supabaseAdmin.storage
      .from('visit-photos')
      .createSignedUrl(p.storage_path, 3600);
    return { ...p, url: signed?.signedUrl ?? null };
  }));

  return NextResponse.json({ visit, photos: photosWithUrl });
}

/**
 * PATCH /api/visits/[id]
 * Actualiza una visita (form_data, status, notas, etc.)
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const blocked = await enforceOwnership(id);
    if (blocked) return blocked;

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    const allowed = ['casa', 'house_id', 'technician_name', 'technician_email', 'contratista', 'visit_date', 'visit_time', 'status', 'form_data', 'notes', 'lat', 'lng'];
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }
    // Detectar transición a completed para disparar el enlace de inventario una sola vez
    const { data: prev } = await supabaseAdmin.from('field_visits').select('status').eq('id', id).single();
    const transitioningToCompleted = body.status === 'completed' && prev?.status !== 'completed';
    if (body.status === 'completed') updates.completed_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin.from('field_visits').update(updates).eq('id', id).select('*').single();
    if (error) throw error;

    let inventoryLink: { linked: string[]; skipped: string[] } | null = null;
    if (transitioningToCompleted) {
      try {
        inventoryLink = await linkVisitToInventory({
          visitId: data.id,
          visitType: data.visit_type,
          formData: data.form_data,
          houseId: data.house_id,
          technicianEmail: data.technician_email,
        });
      } catch (e) {
        console.error('linkVisitToInventory failed:', e);
      }
    }

    return NextResponse.json({ visit: data, inventoryLink });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/visits/[id]
 * Borra una visita y sus fotos (cascade).
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const blocked = await enforceOwnership(id);
    if (blocked) return blocked;

    // Primero borrar fotos del storage
    const { data: photos } = await supabaseAdmin.from('field_visit_photos').select('storage_path').eq('visit_id', id);
    if (photos && photos.length > 0) {
      const paths = photos.map((p) => p.storage_path);
      await supabaseAdmin.storage.from('visit-photos').remove(paths);
    }
    const { error } = await supabaseAdmin.from('field_visits').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
