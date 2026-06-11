import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/nar/ranking?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Agrega por casa en el rango dado:
 *   - alertas_high     (count de eventos high)
 *   - alertas_medium   (count de eventos medium)
 *   - notificaciones   (count de eventos low)
 *   - reactiva_cop     (penalización CREG estimada en COP, integrada en el rango)
 *
 * Curtailment NO se calcula acá — se hace client-side desde Metrum+irradiancia.
 *
 * Estructura de respuesta:
 *   { items: [{ casa, house_id, alertas_high, alertas_medium, notificaciones, reactiva_cop, dias_reactiva }] }
 */
const TARIFA_COP_DEFAULT = 130; // COP/kvarh, mismo default que ReactivaCREG.tsx
const RATIO_THRESHOLD = 0.5;

interface RankRow {
  casa: string;
  house_id: string | null;
  alertas_high: number;
  alertas_medium: number;
  notificaciones: number;
  reactiva_cop: number;
  dias_reactiva: number;
}

interface ClosureRow {
  device_id: string;
  record_date: string;
  energy_active_imported_wh: number | null;
  energy_reactive_imported_varh: number | null;
  devices: { casa: string | null; type: string } | { casa: string | null; type: string }[] | null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const tarifa = Number(url.searchParams.get('tarifa') ?? TARIFA_COP_DEFAULT);

    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: 'from y to son requeridos (YYYY-MM-DD)' }, { status: 400 });
    }

    // 1. Eventos del rango — agrupar por casa+severidad
    const { data: events, error: evErr } = await supabaseAdmin
      .from('alert_events')
      .select('casa, house_id, severity, record_date')
      .gte('record_date', from)
      .lte('record_date', to)
      .limit(20000);
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

    const byCasa = new Map<string, RankRow>();
    for (const ev of events ?? []) {
      if (!ev.casa) continue;
      let row = byCasa.get(ev.casa);
      if (!row) {
        row = { casa: ev.casa, house_id: ev.house_id, alertas_high: 0, alertas_medium: 0, notificaciones: 0, reactiva_cop: 0, dias_reactiva: 0 };
        byCasa.set(ev.casa, row);
      }
      if (ev.severity === 'high') row.alertas_high++;
      else if (ev.severity === 'medium') row.alertas_medium++;
      else if (ev.severity === 'low') row.notificaciones++;
    }

    // 2. Reactiva CREG — leer daily_energy_closures del medidor de red en el rango.
    //    Necesitamos el día anterior a `from` como baseline para el primer delta.
    const baselineFrom = new Date(new Date(from + 'T00:00:00Z').getTime() - 86400000)
      .toISOString().slice(0, 10);
    const { data: closures, error: clErr } = await supabaseAdmin
      .from('daily_energy_closures')
      .select('device_id, record_date, energy_active_imported_wh, energy_reactive_imported_varh, devices!inner(casa, type)')
      .eq('devices.type', 'red')
      .gte('record_date', baselineFrom)
      .lte('record_date', to)
      .order('record_date', { ascending: true })
      .limit(20000);
    if (clErr) {
      // No bloquea — devolvemos lo que tenemos sin reactiva.
      console.error('Reactiva closures error:', clErr.message);
    }

    // Agrupar por device y calcular deltas diarios; luego integrar por casa en el rango.
    const byDevice = new Map<string, ClosureRow[]>();
    for (const c of (closures ?? []) as ClosureRow[]) {
      if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
      byDevice.get(c.device_id)!.push(c);
    }
    for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

    const reactByCasa = new Map<string, { ea_wh: number; eri_varh: number; dias: number }>();
    for (const rows of byDevice.values()) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const prev = rows[i - 1];
        const dev = Array.isArray(r.devices) ? r.devices[0] : r.devices;
        const casa = dev?.casa;
        if (!casa) continue;
        if (r.record_date < from) continue; // baseline day no cuenta
        const dEA = (r.energy_active_imported_wh ?? null) !== null && prev.energy_active_imported_wh !== null
          ? Math.max(0, r.energy_active_imported_wh! - prev.energy_active_imported_wh!) : 0;
        const dERI = (r.energy_reactive_imported_varh ?? null) !== null && prev.energy_reactive_imported_varh !== null
          ? Math.max(0, r.energy_reactive_imported_varh! - prev.energy_reactive_imported_varh!) : 0;
        let agg = reactByCasa.get(casa);
        if (!agg) { agg = { ea_wh: 0, eri_varh: 0, dias: 0 }; reactByCasa.set(casa, agg); }
        agg.ea_wh += dEA;
        agg.eri_varh += dERI;
        agg.dias++;
      }
    }

    // Para cada casa, calcular excedente y COP.
    //   Resolución CREG 015-2018: si ERI/EA > 0.5, se factura el excedente sobre 0.5×EA
    //   como reactiva (en kvarh), a la tarifa del comercializador.
    for (const [casa, agg] of reactByCasa.entries()) {
      if (agg.ea_wh <= 0) continue;
      const ratio = agg.eri_varh / agg.ea_wh;
      let cop = 0;
      if (ratio > RATIO_THRESHOLD) {
        const excedenteVarh = agg.eri_varh - RATIO_THRESHOLD * agg.ea_wh;
        const excedenteKvarh = excedenteVarh / 1000;
        cop = excedenteKvarh * tarifa;
      }
      // Asegurar que la casa esté en el mapa principal aunque no tenga eventos
      let row = byCasa.get(casa);
      if (!row) {
        row = { casa, house_id: null, alertas_high: 0, alertas_medium: 0, notificaciones: 0, reactiva_cop: 0, dias_reactiva: 0 };
        byCasa.set(casa, row);
      }
      row.reactiva_cop = Math.round(cop);
      row.dias_reactiva = agg.dias;
    }

    const items = Array.from(byCasa.values())
      .sort((a, b) => (b.alertas_high + b.alertas_medium) - (a.alertas_high + a.alertas_medium));

    return NextResponse.json({
      items,
      summary: {
        casas: items.length,
        total_events: events?.length ?? 0,
        from, to, tarifa,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
