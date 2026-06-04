import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/debug/reclassify-unknown
 *   Convierte todos los devices con type='unknown' a type='pulsar'.
 *   Operación de cleanup one-off — confirmamos manualmente que esos devices
 *   son modems mal clasificados.
 *
 * GET (mismo path) → devuelve cuántos serían afectados sin tocar nada (dry-run).
 */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .select('id, name, type, marca')
    .eq('type', 'unknown');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    dry_run: true,
    would_update: (data ?? []).length,
    sample_names: (data ?? []).slice(0, 10).map((d) => d.name),
  });
}

export async function POST() {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .update({ type: 'pulsar' })
    .eq('type', 'unknown')
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    updated: (data ?? []).length,
    new_type: 'pulsar',
  });
}
