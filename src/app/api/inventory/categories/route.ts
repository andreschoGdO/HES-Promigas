import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('inventory_categories')
    .select('*')
    .order('family', { ascending: true })
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ categories: data });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.code || !body.name || !body.family) {
      return NextResponse.json({ error: 'code, name y family son requeridos' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from('inventory_categories')
      .insert({
        code: body.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        name: body.name,
        family: body.family,
        description: body.description ?? null,
        default_brand: body.default_brand ?? null,
        default_model: body.default_model ?? null,
        default_capacity_value: body.default_capacity_value ?? null,
        default_capacity_unit: body.default_capacity_unit ?? null,
        default_warranty_months: body.default_warranty_months ?? null,
        default_cost_cop: body.default_cost_cop ?? null,
        is_serialized: body.is_serialized ?? true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ category: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const updates = { ...body };
    delete updates.id;
    delete updates.code; // no permitimos cambiar el código (es la clave de negocio)
    const { data, error } = await supabaseAdmin.from('inventory_categories').update(updates).eq('id', body.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ category: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  const { error } = await supabaseAdmin.from('inventory_categories').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
