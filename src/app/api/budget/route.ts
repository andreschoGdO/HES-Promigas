import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface BudgetItemInput {
  grupo_numero: number;
  grupo_nombre: string;
  item_numero: string;
  referencia?: string | null;
  descripcion: string;
  precio_usd?: number | null;
  trm?: number | null;
  cantidad: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function computed(item: BudgetItemInput) {
  const precioCop = item.precio_usd != null && item.trm != null ? round2(item.precio_usd * item.trm) : null;
  const precioTotal = precioCop != null ? round2(precioCop * (item.cantidad ?? 0)) : null;
  return { precio_cop: precioCop, precio_total: precioTotal };
}

/** GET /api/budget?anio=2026 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const anio = Number(url.searchParams.get('anio') ?? new Date().getFullYear());
  const { data, error } = await supabaseAdmin
    .from('budget_items')
    .select('*')
    .eq('anio', anio)
    .order('grupo_numero')
    .order('item_numero');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], anio });
}

/**
 * PUT /api/budget?anio=2026
 * Reemplaza todas las líneas del año (mismo patrón "reemplazar todo" que
 * el resto del módulo). precio_cop/precio_total se recalculan acá, nunca
 * confiamos en lo que mande el cliente para esos dos.
 */
export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const anio = Number(url.searchParams.get('anio') ?? new Date().getFullYear());
    const body = await request.json();
    const items = body.items as BudgetItemInput[];
    if (!Array.isArray(items)) return NextResponse.json({ error: '"items" debe ser un array' }, { status: 400 });

    for (const [i, item] of items.entries()) {
      if (!item.grupo_nombre || !item.item_numero || !item.descripcion) {
        return NextResponse.json({ error: `Línea ${i + 1}: grupo_nombre, item_numero y descripcion son requeridos` }, { status: 400 });
      }
    }

    const { error: delErr } = await supabaseAdmin.from('budget_items').delete().eq('anio', anio);
    if (delErr) throw delErr;
    if (items.length === 0) return NextResponse.json({ items: [] });

    const rows = items.map((item) => {
      const { precio_cop, precio_total } = computed(item);
      return {
        anio,
        grupo_numero: item.grupo_numero,
        grupo_nombre: item.grupo_nombre,
        item_numero: item.item_numero,
        referencia: item.referencia || null,
        descripcion: item.descripcion,
        precio_usd: item.precio_usd ?? null,
        trm: item.trm ?? null,
        cantidad: item.cantidad ?? 0,
        precio_cop,
        precio_total,
      };
    });

    const { data, error: insErr } = await supabaseAdmin.from('budget_items').insert(rows).select('*').order('grupo_numero').order('item_numero');
    if (insErr) throw insErr;

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
