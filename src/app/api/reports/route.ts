import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/reports?type=...&from=...&to=...&severity=...
 *
 * Endpoint unificado para los reportes del HES. Devuelve siempre:
 *   { headers: string[], rows: any[][], summary?: object, generated_at: string }
 *
 * El cliente convierte a CSV en el navegador (más rápido y respeta locale).
 *
 * Tipos soportados:
 *   - operacion: energía diaria por casa (kWh gen, demanda, importación, excedentes, yield, PR)
 *   - reactiva : agregado mensual de reactiva/activa y penalización CREG
 *   - alertas  : eventos de alertas en el período
 *   - inventario: snapshot del inventario (items + consumibles)
 *   - pipeline : snapshot del funnel CRM (proyectos por etapa)
 *   - ejecutivo: resumen ejecutivo con KPIs de todo el sistema (mes en curso)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';

  try {
    switch (type) {
      case 'operacion':   return NextResponse.json(await reporteOperacion(from, to));
      case 'reactiva':    return NextResponse.json(await reporteReactiva(from, to));
      case 'alertas':     return NextResponse.json(await reporteAlertas(from, to, url.searchParams.get('severity')));
      case 'inventario':  return NextResponse.json(await reporteInventario());
      case 'pipeline':    return NextResponse.json(await reportePipeline());
      case 'ejecutivo':   return NextResponse.json(await reporteEjecutivo(from, to));
      default:
        return NextResponse.json({ error: `type desconocido: "${type}"` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

const isoNow = () => new Date().toISOString();

async function reporteOperacion(from: string, to: string) {
  let q = supabaseAdmin
    .from('daily_casa_metrics')
    .select('record_date, casa, generacion_wh, demanda_wh, importacion_wh, excedentes_wh, gen_dem_pct, exc_gen_pct, imp_dem_pct, yield_real, desempeno_pct, potencia_kw, imax_a')
    .order('record_date', { ascending: false })
    .order('casa', { ascending: true })
    .limit(5000);
  if (from) q = q.gte('record_date', from);
  if (to) q = q.lte('record_date', to);
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []).map((r) => [
    r.record_date, r.casa,
    toKwh(r.generacion_wh), toKwh(r.demanda_wh), toKwh(r.importacion_wh), toKwh(r.excedentes_wh),
    toPct(r.gen_dem_pct), toPct(r.exc_gen_pct), toPct(r.imp_dem_pct),
    nz(r.yield_real, 2), toPct(r.desempeno_pct),
    nz(r.potencia_kw, 2), nz(r.imax_a, 2),
  ]);

  return {
    type: 'operacion',
    title: 'Operación diaria por casa',
    period: { from, to },
    headers: ['Fecha', 'Casa', 'Generación kWh', 'Demanda kWh', 'Importación kWh', 'Excedentes kWh', 'Gen/Dem %', 'Exc/Gen %', 'Imp/Dem %', 'Yield kWh/kWp', 'Desempeño %', 'Potencia kWp', 'Imax A'],
    rows,
    summary: {
      total_dias: rows.length,
      casas: new Set(rows.map((r) => r[1])).size,
      total_generacion_kwh: rows.reduce((s, r) => s + (Number(r[2]) || 0), 0).toFixed(1),
      total_demanda_kwh: rows.reduce((s, r) => s + (Number(r[3]) || 0), 0).toFixed(1),
    },
    generated_at: isoNow(),
  };
}

async function reporteReactiva(from: string, to: string) {
  const baselineStart = from ? new Date(new Date(from + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10) : '';
  let q = supabaseAdmin
    .from('daily_energy_closures')
    .select('device_id, record_date, energy_active_imported_wh, energy_reactive_imported_varh, energy_reactive_exported_varh, devices!inner(name, type, casa)')
    .eq('devices.type', 'red')
    .order('record_date', { ascending: true })
    .limit(10000);
  if (baselineStart) q = q.gte('record_date', baselineStart);
  if (to) q = q.lte('record_date', to);
  const { data, error } = await q;
  if (error) throw error;

  // Agrupar por device → ordenar → calcular delta diario → agregar por casa+mes
  interface Closure {
    device_id: string; record_date: string;
    energy_active_imported_wh: number | null;
    energy_reactive_imported_varh: number | null;
    energy_reactive_exported_varh: number | null;
    devices?: { name: string; type: string; casa: string } | Array<{ name: string; type: string; casa: string }> | null;
  }
  const getCasa = (d: Closure['devices']): string | null => {
    if (!d) return null;
    if (Array.isArray(d)) return d[0]?.casa ?? null;
    return d.casa;
  };
  const byDevice = new Map<string, Closure[]>();
  for (const c of (data ?? []) as Closure[]) {
    if (!getCasa(c.devices)) continue;
    if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
    byDevice.get(c.device_id)!.push(c);
  }
  for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

  interface CasaMonth { casa: string; mes: string; ea_wh: number; eri_varh: number; ere_varh: number; }
  const acc = new Map<string, CasaMonth>();
  for (const rows of byDevice.values()) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], prev = rows[i - 1];
      const casa = getCasa(r.devices);
      if (!casa) continue;
      if (from && r.record_date < from) continue;
      const mes = r.record_date.slice(0, 7);
      const key = `${casa}|${mes}`;
      let m = acc.get(key);
      if (!m) { m = { casa, mes, ea_wh: 0, eri_varh: 0, ere_varh: 0 }; acc.set(key, m); }
      const dEA = (r.energy_active_imported_wh ?? null) !== null && prev.energy_active_imported_wh !== null
        ? Math.max(0, (r.energy_active_imported_wh! - prev.energy_active_imported_wh!)) : 0;
      const dERI = (r.energy_reactive_imported_varh ?? null) !== null && prev.energy_reactive_imported_varh !== null
        ? Math.max(0, (r.energy_reactive_imported_varh! - prev.energy_reactive_imported_varh!)) : 0;
      const dERE = (r.energy_reactive_exported_varh ?? null) !== null && prev.energy_reactive_exported_varh !== null
        ? Math.max(0, (r.energy_reactive_exported_varh! - prev.energy_reactive_exported_varh!)) : 0;
      m.ea_wh += dEA; m.eri_varh += dERI; m.ere_varh += dERE;
    }
  }

  const TARIFA = 130; // COP/kvarh
  const UMBRAL = 0.5;
  const rows = Array.from(acc.values())
    .map((m) => {
      const ratio = m.ea_wh > 0 ? m.eri_varh / m.ea_wh : null;
      const cos_phi = m.ea_wh > 0 ? m.ea_wh / Math.sqrt(m.ea_wh ** 2 + m.eri_varh ** 2) : null;
      const limite = UMBRAL * m.ea_wh;
      const excedente_varh = Math.max(0, m.eri_varh - limite);
      const penalizada = m.eri_varh > limite;
      const cop = (excedente_varh / 1000) * TARIFA;
      return [
        m.mes, m.casa,
        (m.ea_wh / 1000).toFixed(2),
        (m.eri_varh / 1000).toFixed(2),
        (m.ere_varh / 1000).toFixed(2),
        ratio !== null ? (ratio * 100).toFixed(2) : '',
        cos_phi !== null ? cos_phi.toFixed(3) : '',
        (excedente_varh / 1000).toFixed(2),
        penalizada ? 'SI' : 'NO',
        Math.round(cop),
      ];
    })
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])));

  return {
    type: 'reactiva',
    title: 'Reactiva CREG 015-2018 — análisis mensual',
    period: { from, to },
    headers: ['Mes', 'Casa', 'EA Imp. kWh', 'ER Inductiva kvarh', 'ER Capacitiva kvarh', 'Ratio ERI/EA %', 'cos φ ≈', 'Excedente kvarh', 'Penalizada', 'Estimación COP'],
    rows,
    summary: {
      total_meses_casa: rows.length,
      penalizadas: rows.filter((r) => r[8] === 'SI').length,
      cop_total: rows.reduce((s, r) => s + (Number(r[9]) || 0), 0),
    },
    generated_at: isoNow(),
  };
}

async function reporteAlertas(from: string, to: string, severity: string | null) {
  let q = supabaseAdmin
    .from('alert_events')
    .select('fired_at, record_date, casa, severity, variable, value, threshold, operator, message, acknowledged, alert_rules(name)')
    .order('fired_at', { ascending: false })
    .limit(5000);
  if (from) q = q.gte('record_date', from);
  if (to) q = q.lte('record_date', to);
  if (severity) q = q.eq('severity', severity);
  const { data, error } = await q;
  if (error) throw error;

  interface EvRow {
    fired_at: string; record_date: string; casa: string; severity: string;
    variable: string; value: number | string; threshold: number | string; operator: string;
    message: string | null; acknowledged: boolean;
    alert_rules?: { name: string } | Array<{ name: string }> | null;
  }
  const getName = (r: EvRow['alert_rules']) => Array.isArray(r) ? r[0]?.name ?? '' : r?.name ?? '';
  const rows = ((data ?? []) as EvRow[]).map((e) => [
    e.fired_at, e.record_date, e.casa, e.severity, getName(e.alert_rules),
    e.variable, e.value, e.operator, e.threshold,
    e.acknowledged ? 'SI' : 'NO',
    e.message ?? '',
  ]);

  const bySev: Record<string, number> = {};
  for (const r of rows) bySev[String(r[3])] = (bySev[String(r[3])] ?? 0) + 1;

  return {
    type: 'alertas',
    title: 'Eventos de alertas',
    period: { from, to, severity: severity ?? 'todas' },
    headers: ['Fired at', 'Fecha', 'Casa', 'Severidad', 'Regla', 'Variable', 'Valor', 'Operador', 'Umbral', 'Ack', 'Mensaje'],
    rows,
    summary: { total: rows.length, por_severidad: bySev },
    generated_at: isoNow(),
  };
}

async function reporteInventario() {
  const [{ data: items }, { data: cons }, { data: cats }, { data: locs }] = await Promise.all([
    supabaseAdmin.from('inventory_items').select('serial_number, brand, model, status, current_location, current_house_id, acquired_at, acquired_cost_cop, supplier, warranty_expires_at, inventory_categories(name, family), client_houses(casa)').limit(5000),
    supabaseAdmin.from('inventory_consumables').select('name, sku, unit, stock_quantity, min_threshold, supplier, cost_per_unit_cop, inventory_categories(name, family)').limit(5000),
    supabaseAdmin.from('inventory_categories').select('code, name, family'),
    supabaseAdmin.from('inventory_locations').select('id, code, name, type').eq('is_active', true),
  ]);

  interface Itm {
    serial_number: string; brand: string | null; model: string | null; status: string;
    current_location: string | null; current_house_id: string | null;
    acquired_at: string | null; acquired_cost_cop: number | null; supplier: string | null; warranty_expires_at: string | null;
    inventory_categories?: { name: string; family: string } | Array<{ name: string; family: string }> | null;
    client_houses?: { casa: string } | Array<{ casa: string }> | null;
  }
  const getCat = (r: Itm['inventory_categories']) => Array.isArray(r) ? r[0] : r;
  const getCasa = (r: Itm['client_houses']) => Array.isArray(r) ? r[0] : r;
  const itemsRows = ((items ?? []) as Itm[]).map((it) => {
    const cat = getCat(it.inventory_categories);
    const casa = getCasa(it.client_houses);
    return [
      it.serial_number, cat?.name ?? '', cat?.family ?? '',
      it.brand ?? '', it.model ?? '', it.status,
      casa?.casa ?? it.current_location ?? '', it.supplier ?? '',
      it.acquired_at ?? '', it.acquired_cost_cop ?? '',
      it.warranty_expires_at ?? '',
    ];
  });

  interface Cons {
    name: string; sku: string | null; unit: string;
    stock_quantity: number; min_threshold: number;
    supplier: string | null; cost_per_unit_cop: number | null;
    inventory_categories?: { name: string; family: string } | Array<{ name: string; family: string }> | null;
  }
  const consRows = ((cons ?? []) as Cons[]).map((c) => {
    const cat = getCat(c.inventory_categories);
    const low = c.stock_quantity <= c.min_threshold;
    return [
      c.name, c.sku ?? '', cat?.family ?? '',
      c.unit, c.stock_quantity, c.min_threshold,
      low ? 'BAJO' : 'OK',
      c.supplier ?? '', c.cost_per_unit_cop ?? '',
    ];
  });

  return {
    type: 'inventario',
    title: 'Snapshot de inventario',
    headers: ['Serial', 'Categoría', 'Familia', 'Marca', 'Modelo', 'Estado', 'Ubicación / Casa', 'Proveedor', 'Adquirido', 'Costo COP', 'Garantía hasta'],
    rows: itemsRows,
    extra: {
      title: 'Consumibles',
      headers: ['Nombre', 'SKU', 'Familia', 'Unidad', 'Stock', 'Umbral mín', 'Estado', 'Proveedor', 'Costo unitario COP'],
      rows: consRows,
    },
    summary: {
      total_items: itemsRows.length,
      total_consumibles: consRows.length,
      categorias: (cats ?? []).length,
      ubicaciones: (locs ?? []).length,
      stock_bajo: consRows.filter((r) => r[6] === 'BAJO').length,
    },
    generated_at: isoNow(),
  };
}

async function reportePipeline() {
  const { data, error } = await supabaseAdmin
    .from('crm_projects')
    .select('code, title, current_module, sales_stage, engineering_stage, operations_stage, client_name, client_city, invoice_kwh_mensual, propuesta_kwp, propuesta_valor_cop, diseno_kwp, contractor_name, installation_date, operativo_at, legalizado_at, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  const rows = (data ?? []).map((p) => {
    const stage = p.current_module === 'sales' ? p.sales_stage
      : p.current_module === 'engineering' ? p.engineering_stage
      : p.current_module === 'operations' ? p.operations_stage
      : 'completado';
    return [
      p.code, p.title, p.current_module, stage,
      p.client_name ?? '', p.client_city ?? '',
      p.invoice_kwh_mensual ?? '',
      p.propuesta_kwp ?? '', p.propuesta_valor_cop ?? '',
      p.diseno_kwp ?? '',
      p.contractor_name ?? '', p.installation_date ?? '',
      p.operativo_at ?? '', p.legalizado_at ?? '',
      new Date(p.created_at).toISOString().slice(0, 10),
      new Date(p.updated_at).toISOString().slice(0, 10),
    ];
  });

  const byModule: Record<string, number> = {};
  let valorPipeline = 0;
  let kwpAprobado = 0;
  for (const p of data ?? []) {
    byModule[p.current_module] = (byModule[p.current_module] ?? 0) + 1;
    if (p.current_module !== 'sales' && p.propuesta_valor_cop) valorPipeline += Number(p.propuesta_valor_cop);
    if ((p.current_module === 'operations' || p.current_module === 'closed') && p.diseno_kwp) kwpAprobado += Number(p.diseno_kwp);
  }

  return {
    type: 'pipeline',
    title: 'Pipeline CRM (Ventas + Ingeniería + Operaciones)',
    headers: ['Código', 'Título', 'Módulo', 'Etapa', 'Cliente', 'Ciudad', 'kWh/mes', 'Propuesta kWp', 'Propuesta COP', 'Diseño kWp', 'Contratista', 'Fecha inst.', 'Operativo at', 'Legalizado at', 'Creado', 'Actualizado'],
    rows,
    summary: {
      total: rows.length,
      por_modulo: byModule,
      valor_pipeline_cop: valorPipeline,
      kwp_aprobado: kwpAprobado,
    },
    generated_at: isoNow(),
  };
}

async function reporteEjecutivo(from: string, to: string) {
  // Resumen ejecutivo: combina KPIs de todas las áreas
  const [casaM, alertEv, items, cons, projects, devices, instant] = await Promise.all([
    supabaseAdmin.from('daily_casa_metrics').select('record_date, casa, generacion_wh, demanda_wh, importacion_wh, excedentes_wh').gte('record_date', from || '1970-01-01').lte('record_date', to || '2099-12-31').limit(5000),
    supabaseAdmin.from('alert_events').select('id, severity, acknowledged').gte('record_date', from || '1970-01-01').lte('record_date', to || '2099-12-31').limit(5000),
    supabaseAdmin.from('inventory_items').select('id, status').limit(5000),
    supabaseAdmin.from('inventory_consumables').select('id, stock_quantity, min_threshold').limit(2000),
    supabaseAdmin.from('crm_projects').select('id, current_module, propuesta_valor_cop, diseno_kwp').limit(2000),
    supabaseAdmin.from('devices').select('id, is_active').limit(5000),
    supabaseAdmin.from('instant_metrics').select('recorded_at').order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const totalGen = (casaM.data ?? []).reduce((s, r) => s + (Number(r.generacion_wh) || 0), 0) / 1000;
  const totalDem = (casaM.data ?? []).reduce((s, r) => s + (Number(r.demanda_wh) || 0), 0) / 1000;
  const totalImp = (casaM.data ?? []).reduce((s, r) => s + (Number(r.importacion_wh) || 0), 0) / 1000;
  const totalExc = (casaM.data ?? []).reduce((s, r) => s + (Number(r.excedentes_wh) || 0), 0) / 1000;
  const totalCasas = new Set((casaM.data ?? []).map((r) => r.casa)).size;

  const alertCount = (alertEv.data ?? []).length;
  const alertHigh = (alertEv.data ?? []).filter((e) => e.severity === 'high').length;
  const alertAck = (alertEv.data ?? []).filter((e) => e.acknowledged).length;

  const itemsByStatus: Record<string, number> = {};
  for (const it of items.data ?? []) itemsByStatus[it.status] = (itemsByStatus[it.status] ?? 0) + 1;
  const lowStock = (cons.data ?? []).filter((c) => Number(c.stock_quantity) <= Number(c.min_threshold)).length;

  const projByMod: Record<string, number> = {};
  let pipelineCop = 0;
  for (const p of projects.data ?? []) {
    projByMod[p.current_module] = (projByMod[p.current_module] ?? 0) + 1;
    if (p.current_module !== 'sales' && p.propuesta_valor_cop) pipelineCop += Number(p.propuesta_valor_cop);
  }

  const devTotal = (devices.data ?? []).length;
  const devOnline = (devices.data ?? []).filter((d) => d.is_active !== false).length;

  const rows: Array<Array<unknown>> = [
    ['SECCIÓN', 'KPI', 'Valor'],
    ['', '', ''],
    ['Operación', 'Casas con data', totalCasas],
    ['Operación', 'Generación total (kWh)', totalGen.toFixed(1)],
    ['Operación', 'Demanda total (kWh)', totalDem.toFixed(1)],
    ['Operación', 'Importación red (kWh)', totalImp.toFixed(1)],
    ['Operación', 'Excedentes a red (kWh)', totalExc.toFixed(1)],
    ['Operación', 'Autoconsumo % (Gen-Exc)/Dem', totalDem > 0 ? (((totalGen - totalExc) / totalDem) * 100).toFixed(1) + '%' : ''],
    ['', '', ''],
    ['Conectividad', 'Devices Metrum', devTotal],
    ['Conectividad', 'Online ahora', devOnline],
    ['Conectividad', 'Última escritura instant_metrics', instant.data?.recorded_at ?? '—'],
    ['', '', ''],
    ['Alertas', 'Total eventos', alertCount],
    ['Alertas', 'Severidad alta', alertHigh],
    ['Alertas', 'Reconocidas', alertAck],
    ['Alertas', 'Pendientes', alertCount - alertAck],
    ['', '', ''],
    ['Inventario', 'Items totales', items.data?.length ?? 0],
    ['Inventario', 'En stock', itemsByStatus.in_stock ?? 0],
    ['Inventario', 'Instalados', itemsByStatus.installed ?? 0],
    ['Inventario', 'En garantía', itemsByStatus.in_repair ?? 0],
    ['Inventario', 'Consumibles con stock bajo', lowStock],
    ['', '', ''],
    ['CRM', 'Total proyectos', projects.data?.length ?? 0],
    ['CRM', 'En Ventas', projByMod.sales ?? 0],
    ['CRM', 'En Ingeniería', projByMod.engineering ?? 0],
    ['CRM', 'En Operaciones', projByMod.operations ?? 0],
    ['CRM', 'Cerrados', projByMod.closed ?? 0],
    ['CRM', 'Valor pipeline (COP)', pipelineCop],
  ];

  return {
    type: 'ejecutivo',
    title: 'Resumen ejecutivo del sistema',
    period: { from, to },
    headers: ['Sección', 'KPI', 'Valor'],
    rows: rows.slice(1),
    summary: {
      generacion_kwh: totalGen.toFixed(1),
      demanda_kwh: totalDem.toFixed(1),
      casas: totalCasas,
      alertas_high: alertHigh,
      pipeline_cop: pipelineCop,
    },
    generated_at: isoNow(),
  };
}

// helpers
function toKwh(wh: number | null | undefined): string {
  if (wh === null || wh === undefined) return '';
  return (Number(wh) / 1000).toFixed(2);
}
function toPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '';
  const n = Number(pct);
  // si es fracción 0-1, multiplica; si ya es porcentaje, deja
  return (n <= 1 ? n * 100 : n).toFixed(1);
}
function nz(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return '';
  return Number(v).toFixed(dec);
}
