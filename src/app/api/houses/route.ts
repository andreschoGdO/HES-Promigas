import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/houses[?q=]
 *
 * Lista client_houses con búsqueda por texto en casa/location/city.
 * Usada por el picker del CRM para vincular un proyecto a una casa.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');

  let query = supabaseAdmin
    .from('client_houses')
    .select('id, casa, cliente_id, location, city, created_at')
    .order('casa', { ascending: true })
    .limit(500);

  if (q) {
    const safe = q.replace(/[,()*"\\]/g, ' ').trim();
    if (safe) {
      query = query.or(`casa.ilike.%${safe}%,location.ilike.%${safe}%,city.ilike.%${safe}%`);
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ houses: data });
}
