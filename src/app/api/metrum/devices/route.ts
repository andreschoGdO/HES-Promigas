import { NextResponse } from 'next/server';
import { loginToMetrum, getDevices } from '@/lib/metrum-api';

/**
 * GET /api/metrum/devices
 * Returns the raw ThingsBoard response from entitiesQuery/find — for debug.
 */
export async function GET() {
  try {
    const token = await loginToMetrum();
    const raw = await getDevices(token);
    return NextResponse.json({ ok: true, raw });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
