import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** GET /api/topleads/construccion — "BD Clientes Firmados Construcción" (última foto del pipeline "Constructoras"). */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('topleads_construccion_deals')
    .select('*')
    .order('ac_created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const capturedAt = data && data.length > 0 ? data[0].captured_at : null;
  return NextResponse.json({ deals: data ?? [], capturedAt });
}
