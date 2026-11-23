import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireUser } from '@/lib/api-auth';
import { checkLogAccess } from '@/lib/api-access';

interface RouteContext {
  params: Promise<{ id: string; entryId: string }>;
}

/**
 * PATCH /api/construction-logs/[id]/entries/[entryId]
 * Body: { entry_date?, etapa?, clima?, descripcion?, observaciones?, lat?, lng? }
 * Edita una entrada ya guardada — para corregir o ampliar lo que se
 * escribió, sin tener que borrar y crear una nueva. Bloquea si la
 * bitácora está cerrada (mismo criterio que crear entradas nuevas).
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { id, entryId } = await context.params;
    const blocked = await checkLogAccess(auth.user, id);
    if (blocked) return blocked;
    const body = await request.json();

    const { data: log, error: logErr } = await supabaseAdmin
      .from('construction_logs')
      .select('id, status')
      .eq('id', id)
      .single();
    if (logErr || !log) return NextResponse.json({ error: 'Bitácora no encontrada' }, { status: 404 });
    if (log.status === 'cerrada') {
      return NextResponse.json({ error: 'Esta bitácora está cerrada — reábrela para editar entradas.' }, { status: 409 });
    }

    const payload: Record<string, unknown> = {};
    if (body.entry_date !== undefined) payload.entry_date = body.entry_date;
    if (body.etapa !== undefined) payload.etapa = body.etapa;
    if (body.clima !== undefined) payload.clima = body.clima;
    if (body.observaciones !== undefined) payload.observaciones = body.observaciones;
    if (body.lat !== undefined) payload.lat = body.lat;
    if (body.lng !== undefined) payload.lng = body.lng;
    if (body.descripcion !== undefined) {
      const descripcion = String(body.descripcion).trim();
      if (!descripcion) return NextResponse.json({ error: 'descripcion no puede quedar vacía' }, { status: 400 });
      payload.descripcion = descripcion;
    }
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });
    }

    const { data: entry, error } = await supabaseAdmin
      .from('construction_log_entries')
      .update(payload)
      .eq('id', entryId)
      .eq('log_id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/construction-logs/[id]/entries/[entryId]
 * Borra una entrada (y sus fotos, por cascade). Útil para corregir un
 * registro digitado por error.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireUser(request);
    if ('response' in auth) return auth.response;
    const { id, entryId } = await context.params;
    const blocked = await checkLogAccess(auth.user, id);
    if (blocked) return blocked;

    // La entrada debe pertenecer a ESTA bitácora antes de tocar sus archivos:
    // sin esto, con el id de una bitácora propia se podían borrar del Storage
    // las fotos de una entrada ajena.
    const { data: owned } = await supabaseAdmin
      .from('construction_log_entries')
      .select('id')
      .eq('id', entryId)
      .eq('log_id', id)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 });

    const { data: photos } = await supabaseAdmin
      .from('construction_log_entry_photos')
      .select('storage_path')
      .eq('entry_id', entryId);
    if (photos && photos.length > 0) {
      await supabaseAdmin.storage.from('visit-photos').remove(photos.map((p) => p.storage_path));
    }
    const { error } = await supabaseAdmin
      .from('construction_log_entries')
      .delete()
      .eq('id', entryId)
      .eq('log_id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
