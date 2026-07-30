import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** GET /api/topleads/funnel — última foto del funnel de ventas (pipeline "Prospectos Sunny"). */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('topleads_funnel_snapshot')
    .select('*')
    .order('stage_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const capturedAt = data && data.length > 0 ? data[0].captured_at : null;
  return NextResponse.json({ stages: data ?? [], capturedAt });
}
