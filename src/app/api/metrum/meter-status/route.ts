import { NextResponse } from 'next/server';
import { getMeterLatchState } from '@/lib/metrum-meter-control';

/**
 * GET /api/metrum/meter-status?metrum_id=...
 * Lectura en vivo (solo lectura, siempre segura) del estado del relé/latch
 * de un medidor directo desde Metrum: latch_state, latch_output, active.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const metrumId = url.searchParams.get('metrum_id');
  if (!metrumId) return NextResponse.json({ error: 'metrum_id requerido' }, { status: 400 });

  const state = await getMeterLatchState(metrumId);
  if (!state) return NextResponse.json({ error: 'No se pudo leer el estado desde Metrum' }, { status: 502 });
  return NextResponse.json(state);
}
