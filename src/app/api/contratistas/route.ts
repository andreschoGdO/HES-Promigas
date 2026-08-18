import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** GET /api/contratistas?all=true — por defecto solo activos. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeInactive = url.searchParams.get('all') === 'true';

  let q = supabaseAdmin.from('contratistas').select('*').order('nombre');
  if (!includeInactive) q = q.eq('activo', true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contratistas: data ?? [] });
}

/** POST /api/contratistas — crea un contratista nuevo en el catálogo. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const nombre = (body.nombre ?? '').trim();
    if (!nombre) return NextResponse.json({ error: 'nombre es requerido' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('contratistas')
      .insert({
        nombre,
        email: body.email || null,
        telefono: body.telefono || null,
        empresa: body.empresa || null,
        created_by: body.created_by || null,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: `Ya existe un contratista llamado "${nombre}"` }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ contratista: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** PATCH /api/contratistas — body { id, ...campos }. Usar activo:false para "borrar" sin perder histórico. */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const k of ['nombre', 'email', 'telefono', 'empresa', 'activo']) {
      if (k in body) patch[k] = body[k];
    }
    const { data, error } = await supabaseAdmin.from('contratistas').update(patch).eq('id', body.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ contratista: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/** DELETE /api/contratistas?id=... */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('contratistas').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
