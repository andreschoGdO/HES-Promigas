import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/devices
 * Returns the list of devices stored in Supabase.
 * This endpoint is used by the frontend to populate device selectors.
 */
export async function GET(request: Request) {
  try {
    const { data, error } = await supabaseAdmin
      .from('devices')
      .select('id, name, type')
      .order('name', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ devices: data });
  } catch (err) {
    console.error('Error fetching devices:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
