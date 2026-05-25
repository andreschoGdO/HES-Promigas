import { NextResponse } from 'next/server';
import { loginToMetrum, getTimeseriesKeys } from '@/lib/metrum-api';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const metrumId = url.searchParams.get('metrumId');
  if (!metrumId) {
    return NextResponse.json({ ok: false, error: 'Falta metrumId' }, { status: 400 });
  }
  try {
    const token = await loginToMetrum();
    const keys = await getTimeseriesKeys(token, metrumId);
    return NextResponse.json({ ok: true, keys });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
