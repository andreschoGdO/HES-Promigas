import { NextResponse } from 'next/server';
import { loginToMetrum, getTimeseries } from '@/lib/metrum-api';

type Agg = 'NONE' | 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const metrumId = url.searchParams.get('metrumId');
  const keys = url.searchParams.get('keys')?.split(',').map((k) => k.trim()).filter(Boolean) ?? [];
  const startTs = Number(url.searchParams.get('startTs'));
  const endTs = Number(url.searchParams.get('endTs'));
  const intervalParam = url.searchParams.get('interval');
  const interval = intervalParam ? Number(intervalParam) : undefined;
  const agg = (url.searchParams.get('agg') as Agg) || 'NONE';

  if (!metrumId || keys.length === 0 || !Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    return NextResponse.json(
      { ok: false, error: 'Parámetros requeridos: metrumId, keys, startTs, endTs' },
      { status: 400 },
    );
  }

  try {
    const token = await loginToMetrum();
    const raw = await getTimeseries(token, metrumId, keys, startTs, endTs, { interval, agg });
    return NextResponse.json({ ok: true, request: { metrumId, keys, startTs, endTs, interval, agg }, raw });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
