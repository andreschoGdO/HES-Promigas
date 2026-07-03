import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET  /api/settings/dash — devuelve la config del Dash de Construcción.
 * PUT  /api/settings/dash — actualiza meta anual, umbrales stand-by, solución.
 *
 * Body PUT: {
 *   meta_anual_casas?: number,
 *   standby_dias?: { dimensionado: number, alistamiento: number, ... },
 *   solucion_umbrales?: { sol1_max_paneles: 5, sol2_max_paneles: 10, ... }
 * }
 */

const KEYS = ['dash_meta_anual_casas', 'dash_standby_dias', 'dash_solucion_umbrales'] as const;

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', KEYS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const map = new Map((data ?? []).map((s: { key: string; value: Record<string, unknown> }) => [s.key, s.value]));
  return NextResponse.json({
    meta_anual_casas: (map.get('dash_meta_anual_casas') as { value?: number })?.value ?? 230,
    standby_dias: map.get('dash_standby_dias') ?? {
      dimensionado: 5, alistamiento: 5, instalacion: 4, legalizacion: 10, logistica_inversa: 30,
    },
    solucion_umbrales: map.get('dash_solucion_umbrales') ?? {
      sol1_max_paneles: 5, sol2_max_paneles: 10, sol3_max_paneles: 16, sol4_max_paneles: 19,
    },
  });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const updates: Array<{ key: string; value: Record<string, unknown> }> = [];
    if (typeof body.meta_anual_casas === 'number') {
      updates.push({ key: 'dash_meta_anual_casas', value: { value: body.meta_anual_casas } });
    }
    if (body.standby_dias && typeof body.standby_dias === 'object') {
      updates.push({ key: 'dash_standby_dias', value: body.standby_dias });
    }
    if (body.solucion_umbrales && typeof body.solucion_umbrales === 'object') {
      updates.push({ key: 'dash_solucion_umbrales', value: body.solucion_umbrales });
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
    }
    for (const u of updates) {
      const { error } = await supabaseAdmin
        .from('app_settings')
        .upsert({ key: u.key, value: u.value }, { onConflict: 'key' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
