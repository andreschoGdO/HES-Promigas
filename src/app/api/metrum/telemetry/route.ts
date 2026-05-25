import { NextResponse } from 'next/server';
import { loginToMetrum, getDailyClosure } from '@/lib/metrum-api';

/**
 * GET /api/metrum/telemetry?metrumId=X&startTs=ms&endTs=ms
 * Returns the raw ThingsBoard timeseries response — for debug.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const metrumId = url.searchParams.get('metrumId');
  const startTs = Number(url.searchParams.get('startTs'));
  const endTs = Number(url.searchParams.get('endTs'));

  if (!metrumId || !Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    return NextResponse.json(
      { ok: false, error: 'Faltan parámetros: metrumId, startTs, endTs' },
      { status: 400 },
    );
  }

  try {
    const token = await loginToMetrum();
    const raw = await getDailyClosure(token, metrumId, startTs, endTs);
    return NextResponse.json({ ok: true, request: { metrumId, startTs, endTs }, raw });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
