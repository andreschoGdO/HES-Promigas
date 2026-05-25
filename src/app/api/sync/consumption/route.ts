import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getTimeseries } from '@/lib/metrum-api';

/**
 * GET /api/sync/consumption?from=YYYY-MM-DD&to=YYYY-MM-DD&houseId=<uuid>
 *
 * Para cada casa (o solo la indicada), recorre cada día del rango y construye
 * una fila en daily_consumption con todos los campos del diccionario.
 *
 * Convención del diccionario:
 *   - dia_consumo = D
 *   - fecha_telemetria = D + 1 (00:00 COT del día siguiente, que cierra el día D)
 *   - Cada delta = lectura(fecha_telemetria) − lectura(fecha_telemetria − 1)
 *
 * Por simplicidad usamos las keys estándar de ThingsBoard/Metrum:
 *   - Meter: energyAI, energyAE, energyRI, energyRE (sin prefijo C, son lecturas acumuladas)
 *   - Inverter: energyAI/AE/IT/ET y CenergyAE (cierre)
 *   - Battery: SOC, SOH
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const fromStr = url.searchParams.get('from') ?? yesterday.toISOString().slice(0, 10);
  const toStr = url.searchParams.get('to') ?? today.toISOString().slice(0, 10);
  const houseFilter = url.searchParams.get('houseId');

  try {
    // 1. Cargar casas + sus devices
    let houseQuery = supabaseAdmin
      .from('client_houses')
      .select('id, cliente_id, casa');
    if (houseFilter) houseQuery = houseQuery.eq('id', houseFilter);
    const { data: houses, error: hErr } = await houseQuery;
    if (hErr) throw hErr;
    if (!houses || houses.length === 0) {
      return NextResponse.json({ error: 'No hay casas. Ejecuta /api/houses/build primero.' }, { status: 400 });
    }

    const { data: allDevices, error: dErr } = await supabaseAdmin
      .from('devices')
      .select('id, metrum_id, house_id, subtype');
    if (dErr) throw dErr;
    const byHouse = new Map<string, typeof allDevices>();
    for (const d of allDevices ?? []) {
      if (!d.house_id) continue;
      if (!byHouse.has(d.house_id)) byHouse.set(d.house_id, []);
      byHouse.get(d.house_id)!.push(d);
    }

    const token = await loginToMetrum();

    // Rango de días
    const fromDate = new Date(fromStr + 'T05:00:00Z');
    const toDate = new Date(toStr + 'T05:00:00Z');
    const days: string[] = [];
    for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    // Helper para traer la última lectura ≤ ts
    // IMPORTANTE: ThingsBoard usa endTs EXCLUSIVO, así que sumamos 1 hora para incluir el snapshot exacto.
    // Los closures C* salen a las 05:00 UTC (00:00 COT) de cada día.
    const readAt = async (metrumId: string, keys: string[], targetTs: number): Promise<Record<string, number | null>> => {
      const startTs = targetTs - 24 * 60 * 60 * 1000; // hasta 1 día antes
      const endTs = targetTs + 60 * 60 * 1000;         // +1h para inclusividad
      const raw = await getTimeseries(token, metrumId, keys, startTs, endTs, { agg: 'NONE', limit: 50 });
      const out: Record<string, number | null> = {};
      for (const k of keys) {
        const series = (raw as Record<string, Array<{ ts: number; value: string | number }>>)[k] ?? [];
        // Solo puntos ≤ targetTs (no permitimos data "futura")
        const eligible = series.filter((p) => p.ts <= targetTs);
        const latest = eligible.length > 0 ? eligible.reduce((a, c) => (c.ts > a.ts ? c : a)) : null;
        out[k] = latest ? Number(latest.value) : null;
      }
      return out;
    };

    // Medidores: usar lecturas cumulativas (C-prefijo). Las versiones sin C son instantáneas.
    const meterKeys = ['CenergyAI', 'CenergyAE', 'CenergyRI', 'CenergyRE'];
    // Inversores: CenergyAE = energía exportada cumulativa (= generación solar acumulada)
    // energyID/ET = lecturas instantáneas
    const inverterKeys = ['CenergyAE', 'energyID', 'energyIT', 'energyET'];
    const batteryKeys = ['SOC', 'SOH'];

    const delta = (a: number | null, b: number | null): number | null =>
      a === null || b === null ? null : a - b;

    let totalRows = 0;
    const errors: Array<{ casa: string; date: string; error: string }> = [];

    for (const house of houses) {
      const members = byHouse.get(house.id) ?? [];
      const meterSolar = members.find((m) => m.subtype === 'meter_solar');
      const meterRed = members.find((m) => m.subtype === 'meter_red');
      const inverter = members.find((m) => m.subtype === 'inverter');
      const battery = members.find((m) => m.subtype === 'battery');

      for (const day of days) {
        try {
          // fecha_telemetria = día siguiente a 00:00 COT (05:00 UTC)
          const tsCurr = new Date(day + 'T05:00:00Z').getTime() + 24 * 60 * 60 * 1000;
          const tsPrev = tsCurr - 24 * 60 * 60 * 1000;
          const fechaTele = new Date(tsCurr).toISOString().slice(0, 10);

          // Solar
          let solarCurr: Record<string, number | null> = {};
          let solarPrev: Record<string, number | null> = {};
          if (meterSolar) {
            solarCurr = await readAt(meterSolar.metrum_id, meterKeys, tsCurr);
            solarPrev = await readAt(meterSolar.metrum_id, meterKeys, tsPrev);
          }

          // Red
          let redCurr: Record<string, number | null> = {};
          let redPrev: Record<string, number | null> = {};
          if (meterRed) {
            redCurr = await readAt(meterRed.metrum_id, meterKeys, tsCurr);
            redPrev = await readAt(meterRed.metrum_id, meterKeys, tsPrev);
          }

          // Inverter
          let invCurr: Record<string, number | null> = {};
          let invPrev: Record<string, number | null> = {};
          if (inverter) {
            invCurr = await readAt(inverter.metrum_id, inverterKeys, tsCurr);
            invPrev = await readAt(inverter.metrum_id, inverterKeys, tsPrev);
          }

          // Battery (SOH)
          let batt: Record<string, number | null> = {};
          if (battery) {
            batt = await readAt(battery.metrum_id, batteryKeys, tsCurr);
          }

          const eai_solar = delta(solarCurr.CenergyAI, solarPrev.CenergyAI);
          const eae_solar = delta(solarCurr.CenergyAE, solarPrev.CenergyAE);
          const eri_solar = delta(solarCurr.CenergyRI, solarPrev.CenergyRI);
          const ere_solar = delta(solarCurr.CenergyRE, solarPrev.CenergyRE);

          const eai_red = delta(redCurr.CenergyAI, redPrev.CenergyAI);
          const eae_red = delta(redCurr.CenergyAE, redPrev.CenergyAE);
          const eri_red = delta(redCurr.CenergyRI, redPrev.CenergyRI);
          const ere_red = delta(redCurr.CenergyRE, redPrev.CenergyRE);

          // Generación inversor = Δ CenergyAE (cumulativo de exportación)
          const gen_inv = delta(invCurr.CenergyAE, invPrev.CenergyAE);
          const cons_inv = delta(invCurr.energyIT, invPrev.energyIT);
          const imp_inv = delta(invCurr.energyID, invPrev.energyID);
          const exp_inv = delta(invCurr.energyET, invPrev.energyET);

          // Derivadas
          const consumo_solar = eai_solar !== null && eai_red !== null ? eai_solar - eai_red : null;
          const gen_solar_total = consumo_solar !== null && eae_red !== null ? consumo_solar + eae_red : null;
          const ptc_autosuf = consumo_solar !== null && eai_solar !== null && eai_solar !== 0
            ? consumo_solar / eai_solar : null;

          const row = {
            house_id: house.id,
            dia_consumo: day,
            fecha_telemetria: fechaTele,
            // solar
            lectura_eai_meter_solar: solarCurr.CenergyAI ?? null,
            eai_meter_solar: eai_solar,
            lectura_eae_meter_solar: solarCurr.CenergyAE ?? null,
            eae_meter_solar: eae_solar,
            lectura_eri_meter_solar: solarCurr.CenergyRI ?? null,
            eri_meter_solar: eri_solar,
            lectura_ere_meter_solar: solarCurr.CenergyRE ?? null,
            ere_meter_solar: ere_solar,
            meter_solar_estado: meterSolar ? (Object.values(solarCurr).some((v) => v !== null) ? 'succesful' : 'no_data') : null,
            // red
            lectura_eai_meter_red: redCurr.CenergyAI ?? null,
            eai_meter_red: eai_red,
            lectura_eae_meter_red: redCurr.CenergyAE ?? null,
            eae_meter_red: eae_red,
            lectura_eri_meter_red: redCurr.CenergyRI ?? null,
            eri_meter_red: eri_red,
            lectura_ere_meter_red: redCurr.CenergyRE ?? null,
            ere_meter_red: ere_red,
            meter_red_estado: meterRed ? (Object.values(redCurr).some((v) => v !== null) ? 'succesful' : 'no_data') : null,
            usa_phs: null,
            // inverter
            generacion_solar_inverter: gen_inv,
            consumo_cliente_inverter: cons_inv,
            energia_importada_inverter: imp_inv,
            energia_exportada_inverter: exp_inv,
            inverter_estado: inverter ? (Object.values(invCurr).some((v) => v !== null) ? 'succesful' : 'no_data') : null,
            // battery
            energia_entregada_bateria: null, // requiere serie SOC granular para integrar — TODO
            estado_salud_bateria: batt.SOH ?? null,
            tiempo_entrega_bateria: null,
            // derivadas
            consumo_solar,
            gen_solar_total,
            ptc_autosuficiencia: ptc_autosuf,
            updated_at: new Date().toISOString(),
          };

          // No insertar filas totalmente vacías
          const hasAnyData = [
            row.eai_meter_solar, row.eai_meter_red, row.generacion_solar_inverter,
            row.lectura_eai_meter_solar, row.lectura_eai_meter_red,
          ].some((v) => v !== null);
          if (!hasAnyData) continue;

          const { error } = await supabaseAdmin
            .from('daily_consumption')
            .upsert(row, { onConflict: 'house_id,dia_consumo' });
          if (error) throw error;
          totalRows++;
        } catch (e) {
          errors.push({ casa: house.casa, date: day, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return NextResponse.json({
      success: true,
      rows_upserted: totalRows,
      houses_processed: houses.length,
      days_per_house: days.length,
      errors,
    });
  } catch (err) {
    console.error('sync consumption error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
