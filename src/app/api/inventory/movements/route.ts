import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const itemId = url.searchParams.get('item_id');
  const consumableId = url.searchParams.get('consumable_id');
  const type = url.searchParams.get('type');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 1000);

  let q = supabaseAdmin
    .from('inventory_movements')
    .select('*, inventory_items(serial_number, brand, model), inventory_consumables(name, sku, unit), field_visits(visit_type, casa)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (itemId) q = q.eq('item_id', itemId);
  if (consumableId) q = q.eq('consumable_id', consumableId);
  if (type) q = q.eq('type', type);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ movements: data });
}
