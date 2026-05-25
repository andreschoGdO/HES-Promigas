import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST/GET /api/houses/build
 *
 * Agrupa devices por gateway padre (devices.cliente_id, que apunta al nombre del Pulsar IN*).
 * Crea una fila en client_houses por grupo y asigna house_id + subtype a cada device.
 *
 * Subtype se infiere directamente de devices.type:
 *   - solar   → meter_solar
 *   - red     → meter_red
 *   - pulsar  → gateway
 *   - inverter→ inverter
 *
 * Resultado esperado: 28 casas, cada una con 1 gateway + 2 meters (solar/red) + 1 inverter.
 */
export async function GET() { return run(); }
export async function POST() { return run(); }

interface DeviceRecord {
  id: string;
  metrum_id: string;
  name: string;
  type: string | null;
  cliente_id: string | null;
  casa: string | null;
  client: string | null;
  location: string | null;
  city: string | null;
}

const classifySubtype = (d: DeviceRecord): string | null => {
  const t = (d.type ?? '').toLowerCase();
  const n = d.name ?? '';
  if (t === 'solar' || t === 'meter_solar') return 'meter_solar';
  if (t === 'red' || t === 'meter_red') return 'meter_red';
  if (t === 'pulsar' || t === 'gateway' || /^IN\d+/i.test(n)) return 'gateway';
  if (t === 'inverter' || /^HP/i.test(n) || /^(24|25)\d{8}$/.test(n)) return 'inverter';
  if (t === 'meter') return 'meter_red'; // default si solo dice 'meter'
  return null;
};

async function run() {
  try {
    const { data: devs, error: devErr } = await supabaseAdmin
      .from('devices')
      .select('id, metrum_id, name, type, cliente_id, casa, client, location, city');
    if (devErr) throw devErr;
    const devices = (devs ?? []) as DeviceRecord[];
    if (devices.length === 0) {
      return NextResponse.json({ error: 'No hay devices. Ejecuta /api/devices/sync primero.' }, { status: 400 });
    }

    // Agrupar por cliente_id (= nombre del Pulsar padre)
    // Devices sin cliente_id se ignoran (no debería pasar con el sync actual).
    const groups = new Map<string, DeviceRecord[]>();
    for (const d of devices) {
      const key = d.cliente_id;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }

    // Upsert client_houses (1 por grupo)
    const housePayload = Array.from(groups.entries()).map(([key, members]) => {
      const gw = members.find((m) => /^IN\d+/i.test(m.name)) ?? members[0];
      return {
        cliente_id: key,
        casa: gw.casa ?? gw.client ?? `Casa ${key}`,
        location: gw.location,
        city: gw.city,
      };
    });

    const { data: housesUpserted, error: houseErr } = await supabaseAdmin
      .from('client_houses')
      .upsert(housePayload, { onConflict: 'cliente_id' })
      .select('id, cliente_id');
    if (houseErr) throw houseErr;

    const houseByKey = new Map(
      (housesUpserted ?? []).map((h: { id: string; cliente_id: string }) => [h.cliente_id, h.id]),
    );

    // Asignar house_id + subtype a cada device
    let updated = 0;
    for (const [key, members] of groups) {
      const houseId = houseByKey.get(key);
      if (!houseId) continue;
      for (const d of members) {
        const subtype = classifySubtype(d);
        const { error } = await supabaseAdmin
          .from('devices')
          .update({ house_id: houseId, subtype })
          .eq('id', d.id);
        if (!error) updated++;
      }
    }

    return NextResponse.json({
      success: true,
      houses: housesUpserted?.length ?? 0,
      devices_updated: updated,
    });
  } catch (err) {
    console.error('houses/build error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
