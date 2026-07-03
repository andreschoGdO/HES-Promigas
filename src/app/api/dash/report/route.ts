import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { DashReport } from '@/lib/dash-report-data';

/**
 * GET /api/dash/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Arma el reporte semanal de construcción a partir de datos reales:
 *   - crm_projects (etapa, zona, contractor_name, installation_date, diseno_*, agpe_*, garantia_*)
 *   - facturacion_records (capex)
 *   - inventario_items (stock por marca × family, disponible)
 *   - app_settings (dash_meta_anual_casas, dash_standby_dias, dash_solucion_umbrales)
 *
 * "Stand-by" se deriva: proyectos cuyo updated_at en la etapa actual supera
 * el umbral configurado en `dash_standby_dias`.
 */

const MILLIONS = 1_000_000;

function weekBounds(fromParam: string | null, toParam: string | null) {
  const today = new Date();
  const to = toParam ? new Date(toParam) : today;
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { from, to };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

interface CrmProjectRow {
  id: string;
  operations_stage: string | null;
  current_module: string | null;
  installation_date: string | null;
  contractor_name: string | null;
  zona: string | null;
  diseno_kwp: number | null;
  diseno_paneles: number | null;
  diseno_baterias_cantidad: number | null;
  diseno_bateria_capacidad_kwh: number | null;
  diseno_bateria_marca: string | null;
  diseno_inversor_marca: string | null;
  diseno_bateria_categoria_id: string | null;
  operativo_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  agpe_operador_red: string | null;
  agpe_estado: string | null;
  agpe_fecha_estimada: string | null;
  garantia_marca: string | null;
  garantia_equipo: string | null;
  garantia_falla: string | null;
  garantia_estado: string | null;
  garantia_retorno_bodega: string | null;
  client_name: string | null;
  code: string | null;
  title: string | null;
}

interface FacturaRow { project_id: string; capex: number | null; }

interface CategoryRow {
  id: string;
  family: string | null;
  default_brand: string | null;
  default_capacity_value: number | null;
}

interface InventoryItemRow {
  category_id: string;
  status: string | null;
  warehouse_id: string | null;
}

interface StandbyDias { [stage: string]: number; }
interface Umbrales {
  sol1_max_paneles: number;
  sol2_max_paneles: number;
  sol3_max_paneles: number;
  sol4_max_paneles: number;
}

function classifySolucion(paneles: number | null, u: Umbrales): 'sol1' | 'sol2' | 'sol3' | 'sol4' | null {
  if (paneles == null) return null;
  if (paneles <= u.sol1_max_paneles) return 'sol1';
  if (paneles <= u.sol2_max_paneles) return 'sol2';
  if (paneles <= u.sol3_max_paneles) return 'sol3';
  if (paneles <= u.sol4_max_paneles) return 'sol4';
  return 'sol4';
}

function inRange(dateStr: string | null, from: Date, to: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= from && d <= to;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = weekBounds(url.searchParams.get('from'), url.searchParams.get('to'));

  // ─── SETTINGS ───
  const { data: settings } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', ['dash_meta_anual_casas', 'dash_standby_dias', 'dash_solucion_umbrales', 'dash_project_start']);
  const sMap = new Map((settings ?? []).map((s: { key: string; value: Record<string, unknown> }) => [s.key, s.value]));
  const metaAnualRaw = sMap.get('dash_meta_anual_casas') as unknown as { value?: number } | undefined;
  let metaAnual = Number(metaAnualRaw?.value ?? 150);
  // Auto-migración: la mig 39 sembró 230 como default histórico. La 41 lo
  // actualiza a 150 pero requiere correr SQL a mano. Si detectamos el 230
  // legacy, lo migramos on-read a 150 — así se sincroniza solo la primera
  // vez que alguien abre el Dash, sin depender de correr la migración.
  if (metaAnual === 230) {
    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: 'dash_meta_anual_casas', value: { value: 150 } }, { onConflict: 'key' });
    metaAnual = 150;
  }
  const projectStartRaw = sMap.get('dash_project_start') as unknown as { value?: string } | undefined;
  const projectStartStr = projectStartRaw?.value ?? '2025-10-01';
  const projectStart = new Date(projectStartStr);
  // Umbrales de stand-by por etapa. Auto-migran si detectamos los valores
  // legacy sembrados por mig 39 (14/10/7/21/30) → los nuevos más estrictos
  // (5/5/4/10/30). Mismo patrón self-healing que meta anual.
  const STANDBY_DEFAULT_NEW: StandbyDias = {
    dimensionado: 5, alistamiento: 5, instalacion: 4, legalizacion: 10, logistica_inversa: 30,
  };
  const STANDBY_LEGACY: StandbyDias = {
    dimensionado: 14, alistamiento: 10, instalacion: 7, legalizacion: 21, logistica_inversa: 30,
  };
  const standbyFromDb = sMap.get('dash_standby_dias') as unknown as StandbyDias | undefined;
  let standbyDias: StandbyDias = standbyFromDb ?? STANDBY_DEFAULT_NEW;
  const LEGACY_KEYS: readonly string[] = ['dimensionado','alistamiento','instalacion','legalizacion','logistica_inversa'];
  const isLegacy = LEGACY_KEYS.every((k) => standbyDias[k] === STANDBY_LEGACY[k]);
  if (isLegacy) {
    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: 'dash_standby_dias', value: STANDBY_DEFAULT_NEW }, { onConflict: 'key' });
    standbyDias = STANDBY_DEFAULT_NEW;
  }
  const umbrales = (sMap.get('dash_solucion_umbrales') as unknown as Umbrales | undefined) ?? {
    sol1_max_paneles: 5, sol2_max_paneles: 10, sol3_max_paneles: 16, sol4_max_paneles: 19,
  };

  // ─── PROYECTOS ───
  const { data: projRaw, error: projErr } = await supabaseAdmin
    .from('crm_projects')
    .select(`
      id, operations_stage, current_module, installation_date, contractor_name, zona,
      diseno_kwp, diseno_paneles,
      diseno_baterias_cantidad, diseno_bateria_capacidad_kwh,
      diseno_bateria_marca, diseno_inversor_marca, diseno_bateria_categoria_id,
      operativo_at, updated_at, created_at,
      agpe_operador_red, agpe_estado, agpe_fecha_estimada,
      garantia_marca, garantia_equipo, garantia_falla, garantia_estado, garantia_retorno_bodega,
      client_name, code, title
    `);
  if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 });
  const projects = (projRaw ?? []) as CrmProjectRow[];

  // ─── CAPEX (facturación) ───
  const { data: factRaw } = await supabaseAdmin
    .from('facturacion_records')
    .select('project_id, capex');
  const capexByProj = new Map<string, number>();
  ((factRaw ?? []) as FacturaRow[]).forEach((f) => {
    if (f.capex != null) capexByProj.set(f.project_id, Number(f.capex));
  });

  // ─── CATEGORÍAS + INVENTARIO ───
  const { data: catsRaw } = await supabaseAdmin
    .from('inventory_categories')
    .select('id, family, default_brand, default_capacity_value');
  const cats = (catsRaw ?? []) as CategoryRow[];
  const catById = new Map(cats.map((c) => [c.id, c]));

  // Filtrar por status='in_stock' desde la BD y usar range() para bypassear
  // el cap default de 1000 filas de PostgREST. Sin esto, con 1200+ items
  // en la tabla, la sección de Logística mostraría números incompletos.
  const { data: itemsRaw } = await supabaseAdmin
    .from('inventory_items')
    .select('category_id, status, warehouse_id')
    .eq('status', 'in_stock')
    .range(0, 9999);
  const items = (itemsRaw ?? []) as InventoryItemRow[];

  // kWh total de batería por proyecto:
  //   Primero mira los campos directos del proyecto (diseno_baterias_cantidad ×
  //   diseno_bateria_capacidad_kwh) — ese es el dato canónico.
  //   Fallback: la categoría en catálogo (default_capacity_value × cantidad).
  const getKwh = (p: CrmProjectRow): number => {
    if (p.diseno_baterias_cantidad != null && p.diseno_bateria_capacidad_kwh != null) {
      return Number(p.diseno_baterias_cantidad) * Number(p.diseno_bateria_capacidad_kwh);
    }
    if (p.diseno_bateria_categoria_id) {
      const c = catById.get(p.diseno_bateria_categoria_id);
      if (c?.default_capacity_value != null) {
        return Number(c.default_capacity_value) * Number(p.diseno_baterias_cantidad ?? 1);
      }
    }
    return 0;
  };
  const getKwp = (p: CrmProjectRow) => Number(p.diseno_kwp ?? 0);
  const getCapexM = (p: CrmProjectRow) => (capexByProj.get(p.id) ?? 0) / MILLIONS;

  const INSTALADAS = new Set(['operativo', 'logistica_inversa', 'legalizacion']);
  const CERRADAS_OK = new Set(['sin_renovacion']);

  const casasInstaladas = projects.filter((p) => INSTALADAS.has(p.operations_stage ?? '') || CERRADAS_OK.has(p.operations_stage ?? ''));

  // ─── SLIDE 2: AVANCE GLOBAL ───
  const casasAcum = casasInstaladas.length;
  const kwpAcum = casasInstaladas.reduce((s, p) => s + getKwp(p), 0);
  const kwhAcum = casasInstaladas.reduce((s, p) => s + getKwh(p), 0);
  const capexAcumM = casasInstaladas.reduce((s, p) => s + getCapexM(p), 0);

  // Serie por mes: arranca en projectStart (dash_project_start = 2025-10-01 por
  // default) y llega hasta el mes actual (`to`). Etiqueta con "MMM YY" si la
  // ventana cruza más de un año para evitar ambigüedad.
  const monthLabels = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const startMonth = new Date(projectStart.getFullYear(), projectStart.getMonth(), 1);
  const endMonth = new Date(to.getFullYear(), to.getMonth(), 1);
  const totalMonths = Math.max(1,
    (endMonth.getFullYear() - startMonth.getFullYear()) * 12 +
    (endMonth.getMonth() - startMonth.getMonth()) + 1
  );
  const spansMultipleYears = startMonth.getFullYear() !== endMonth.getFullYear();
  const porMes: DashReport['global']['porMes'] = [];
  for (let i = 0; i < totalMonths; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    const nextD = new Date(startMonth.getFullYear(), startMonth.getMonth() + i + 1, 1);
    const monthProjects = casasInstaladas.filter((p) => {
      const ref = p.operativo_at ?? p.installation_date ?? p.updated_at;
      if (!ref) return false;
      const r = new Date(ref);
      return r >= d && r < nextD;
    });
    const bucket = { sol1: 0, sol2: 0, sol3: 0, sol4: 0 };
    monthProjects.forEach((p) => {
      const cls = classifySolucion(p.diseno_paneles, umbrales);
      if (cls) bucket[cls]++;
    });
    const yy = String(d.getFullYear()).slice(-2);
    const mes = spansMultipleYears ? `${monthLabels[d.getMonth()]} ${yy}` : monthLabels[d.getMonth()];
    porMes.push({
      mes,
      casas: monthProjects.length,
      kwp: monthProjects.reduce((s, p) => s + getKwp(p), 0),
      kwh: monthProjects.reduce((s, p) => s + getKwh(p), 0),
      capexM: monthProjects.reduce((s, p) => s + getCapexM(p), 0),
      ...bucket,
    });
  }
  const mesesActivos = porMes.filter((m) => m.casas > 0).length;

  // ─── SLIDE 3: AVANCE SEMANAL ───
  // "Instaladas" = casas que llegaron a operativo con operativo_at en el rango
  // "Programadas" = casas cuyo installation_date cae en el rango,
  // INCLUYENDO las que ya se instalaron (así el ratio "X de Y" tiene sentido:
  // instaladas ≤ programadas si la planificación estaba correcta).
  const instaladasSemana = casasInstaladas.filter((p) => inRange(p.operativo_at ?? p.installation_date, from, to));
  const programadasSemana = projects.filter((p) => inRange(p.installation_date, from, to));

  // Stand-by: proyectos con updated_at más viejo que el umbral para su etapa
  const standByProjects = projects.filter((p) => {
    const stage = p.operations_stage ?? '';
    const threshold = standbyDias[stage];
    if (!threshold) return false;
    return daysSince(p.updated_at) > threshold;
  });

  // Agrupar stand-by por etapa para mostrar motivos
  const standByByStage = new Map<string, number>();
  standByProjects.forEach((p) => {
    const s = p.operations_stage ?? 'desconocida';
    standByByStage.set(s, (standByByStage.get(s) ?? 0) + 1);
  });
  const motivos: DashReport['semana']['motivos'] = Array.from(standByByStage.entries()).map(([stage, casas]) => ({
    motivo: `Estancado en ${stage}`,
    casas,
    accion: `Revisar proyectos con > ${standbyDias[stage] ?? '?'} días sin avance`,
  }));

  // Pipeline activo: TODAS las casas que están en alistamiento o instalación,
  // sin filtro de fecha. Refleja "cuántas obras tenés en curso ahora mismo".
  // Antes filtrábamos solo por alistamiento con installation_date en la próxima
  // semana, dejando afuera las que ya arrancaron o las que no tienen fecha.
  const porIniciarProjects = projects.filter((p) =>
    p.operations_stage === 'alistamiento' || p.operations_stage === 'instalacion',
  );
  const porIniciar = porIniciarProjects.length;

  // Etiqueta legible para tooltip: preferir client_name, sino título del proyecto
  const casaLabel = (p: CrmProjectRow): string =>
    p.client_name ?? p.title ?? p.code ?? p.id.slice(0, 8);

  // ─── SLIDE 4: DETALLE POR MARCA, ZONA, CONSTRUCTOR ───
  const marcaGroup = new Map<string, { casas: number; kwp: number; kwh: number }>();
  instaladasSemana.forEach((p) => {
    const cat = p.diseno_bateria_categoria_id ? catById.get(p.diseno_bateria_categoria_id) : undefined;
    // Fallback en cascada: categoría del catálogo → texto libre de batería del
    // proyecto → texto libre de inversor → "Sin marca". Las casas de mig 40
    // (33 operativas) usan texto libre, sin categoría vinculada.
    const marca = cat?.default_brand ?? p.diseno_bateria_marca ?? p.diseno_inversor_marca ?? 'Sin marca';
    const cur = marcaGroup.get(marca) ?? { casas: 0, kwp: 0, kwh: 0 };
    cur.casas++;
    cur.kwp += getKwp(p);
    cur.kwh += getKwh(p);
    marcaGroup.set(marca, cur);
  });
  const marcas = Array.from(marcaGroup.entries())
    .map(([marca, v]) => ({ marca, casas: v.casas, kwp: v.kwp, kwh: v.kwh }))
    .sort((a, b) => b.casas - a.casas);

  const zonaGroup = new Map<string, { casas: number; capex: number }>();
  instaladasSemana.forEach((p) => {
    const z = p.zona ?? 'Sin zona';
    const cur = zonaGroup.get(z) ?? { casas: 0, capex: 0 };
    cur.casas++;
    cur.capex += (capexByProj.get(p.id) ?? 0);
    zonaGroup.set(z, cur);
  });
  const zonas = Array.from(zonaGroup.entries()).map(([zona, v]) => ({
    zona, casas: v.casas, capex: `$${Math.round(v.capex / MILLIONS)}M`,
  }));

  const contGroup = new Map<string, { asignadas: number; instaladas: number }>();
  projects.forEach((p) => {
    if (!p.contractor_name) return;
    if (!(p.operations_stage === 'instalacion' || p.operations_stage === 'alistamiento' || INSTALADAS.has(p.operations_stage ?? ''))) return;
    if (!inRange(p.installation_date, from, to)) return;
    const cur = contGroup.get(p.contractor_name) ?? { asignadas: 0, instaladas: 0 };
    cur.asignadas++;
    if (INSTALADAS.has(p.operations_stage ?? '')) cur.instaladas++;
    contGroup.set(p.contractor_name, cur);
  });
  const constructores = Array.from(contGroup.entries()).map(([constructor, v]) => ({
    constructor, asignadas: v.asignadas, instaladas: v.instaladas,
  }));

  // ─── SLIDE 3 (nueva): DETALLE GLOBAL POR MARCA, ZONA, CONSTRUCTOR ───
  // Misma lógica que la semanal pero sobre TODAS las casas ya instaladas.
  const marcaGroupG = new Map<string, { casas: number; kwp: number; kwh: number }>();
  casasInstaladas.forEach((p) => {
    const cat = p.diseno_bateria_categoria_id ? catById.get(p.diseno_bateria_categoria_id) : undefined;
    // Fallback al texto libre del proyecto si no hay categoría vinculada
    const marca = cat?.default_brand ?? p.diseno_bateria_marca ?? p.diseno_inversor_marca ?? 'Sin marca';
    const cur = marcaGroupG.get(marca) ?? { casas: 0, kwp: 0, kwh: 0 };
    cur.casas++;
    cur.kwp += getKwp(p);
    cur.kwh += getKwh(p);
    marcaGroupG.set(marca, cur);
  });
  const marcasG = Array.from(marcaGroupG.entries())
    .map(([marca, v]) => ({ marca, casas: v.casas, kwp: v.kwp, kwh: v.kwh }))
    .sort((a, b) => b.casas - a.casas);

  const zonaGroupG = new Map<string, { casas: number; capex: number }>();
  casasInstaladas.forEach((p) => {
    const z = p.zona ?? 'Sin zona';
    const cur = zonaGroupG.get(z) ?? { casas: 0, capex: 0 };
    cur.casas++;
    cur.capex += (capexByProj.get(p.id) ?? 0);
    zonaGroupG.set(z, cur);
  });
  const zonasG = Array.from(zonaGroupG.entries()).map(([zona, v]) => ({
    zona, casas: v.casas, capex: `$${Math.round(v.capex / MILLIONS)}M`,
  }));

  const contGroupG = new Map<string, { asignadas: number; instaladas: number }>();
  projects.forEach((p) => {
    if (!p.contractor_name) return;
    const cur = contGroupG.get(p.contractor_name) ?? { asignadas: 0, instaladas: 0 };
    cur.asignadas++;
    if (INSTALADAS.has(p.operations_stage ?? '') || CERRADAS_OK.has(p.operations_stage ?? '')) cur.instaladas++;
    contGroupG.set(p.contractor_name, cur);
  });
  const constructoresG = Array.from(contGroupG.entries())
    .map(([constructor, v]) => ({ constructor, asignadas: v.asignadas, instaladas: v.instaladas }))
    .sort((a, b) => b.instaladas - a.instaladas);

  // ─── SLIDE 5: PLANEACIÓN (próxima semana + rezagos) ───
  // "Casas asignadas" = obras en alistamiento o instalación con
  // installation_date <= fin de la próxima semana. Incluye:
  //   • Rezagos: casas cuya fecha ya pasó pero siguen sin operativizar
  //   • Actuales: casas con fecha hoy (aún en gestión)
  //   • Futuras: casas planeadas para los próximos 7 días
  // Antes solo contaba las futuras — dejaba afuera lo que sigue en gestión.
  const nextTo = new Date(to.getTime() + 7 * 24 * 60 * 60 * 1000);
  const proximaSemana = projects.filter((p) => {
    if (p.operations_stage !== 'alistamiento' && p.operations_stage !== 'instalacion') return false;
    if (!p.installation_date) return false;
    return new Date(p.installation_date) <= nextTo;
  });
  const kwpPlan = proximaSemana.reduce((s, p) => s + getKwp(p), 0);
  const kwhPlan = proximaSemana.reduce((s, p) => s + getKwh(p), 0);
  const capexPlanM = proximaSemana.reduce((s, p) => s + getCapexM(p), 0);

  const constructoresProxSet = new Set(proximaSemana.map((p) => p.contractor_name).filter(Boolean) as string[]);
  const zonasProxSet = new Set(proximaSemana.map((p) => p.zona).filter(Boolean) as string[]);

  const distGroup = new Map<string, DashReport['planeacion']['distribucion'][number]>();
  proximaSemana.forEach((p) => {
    const key = `${p.zona ?? '?'}|${p.contractor_name ?? '?'}`;
    const cur = distGroup.get(key) ?? {
      zona: p.zona ?? 'Sin zona',
      constructor: p.contractor_name ?? 'Sin asignar',
      casas: 0,
      marca: '',
      fecha: p.installation_date ?? '[DD/MM]',
    };
    cur.casas++;
    const cat = p.diseno_bateria_categoria_id ? catById.get(p.diseno_bateria_categoria_id) : undefined;
    if (!cur.marca && cat?.default_brand) cur.marca = cat.default_brand;
    distGroup.set(key, cur);
  });

  // ─── SLIDE 6: LEGALIZACIONES ───
  const legalizProjects = projects.filter((p) => p.operations_stage === 'legalizacion' || p.agpe_estado);
  const aprobadas = legalizProjects.filter((p) => p.agpe_estado === 'Aprobado').length;
  const enRevision = legalizProjects.filter((p) => p.agpe_estado === 'En revisión' || p.agpe_estado === 'Radicado').length;
  const legalDetalle = legalizProjects.slice(0, 20).map((p) => ({
    casa: p.client_name ?? p.code ?? p.title ?? p.id.slice(0, 8),
    zona: p.zona ?? '—',
    operador: p.agpe_operador_red ?? '—',
    estado: p.agpe_estado ?? '—',
    fecha: p.agpe_fecha_estimada ?? '—',
  }));

  // ─── SLIDE 7: POSTVENTA ───
  const postProjects = projects.filter((p) => p.operations_stage === 'logistica_inversa' || p.garantia_estado);
  const abiertos = postProjects.filter((p) =>
    p.garantia_estado && !['Resuelto en sitio', 'Cerrado'].includes(p.garantia_estado)).length;
  const enTransito = postProjects.filter((p) =>
    p.garantia_estado === 'Reemplazo aprobado' || (p.garantia_retorno_bodega && new Date(p.garantia_retorno_bodega) >= new Date())).length;
  const resueltosSitio = postProjects.filter((p) => p.garantia_estado === 'Resuelto en sitio').length;
  const postDetalle = postProjects.slice(0, 20).map((p) => ({
    marca: p.garantia_marca ?? '—',
    equipo: p.garantia_equipo ?? '—',
    falla: p.garantia_falla ?? '—',
    estado: p.garantia_estado ?? '—',
    retorno: p.garantia_retorno_bodega ?? 'No aplica',
  }));

  // ─── SLIDE 8: LOGÍSTICA (inventario disponible por marca × family) ───
  // Status 'in_stock' es el correcto (mig 07). El bug anterior filtraba por
  // 'available' que nunca existió en la BD, por eso la sección salía vacía.
  const stockGroup = new Map<string, DashReport['logistica']['stock'][number]>();
  items.filter((i) => i.status === 'in_stock').forEach((i) => {
    const cat = catById.get(i.category_id);
    if (!cat?.default_brand) return;
    const marca = cat.default_brand;
    const fam = cat.family ?? 'other';
    const cur = stockGroup.get(marca) ?? { marca, paneles: 0, inversores: 0, baterias: 0, estructuras: 0, cobertura: 0 };
    if (fam === 'panel') cur.paneles++;
    else if (fam === 'inverter') cur.inversores++;
    else if (fam === 'battery') cur.baterias++;
    else if (fam === 'structure' || fam === 'estructura') cur.estructuras++;
    stockGroup.set(marca, cur);
  });
  // Cobertura estimada = paneles / consumo semanal promedio
  const consumoSemanal = Math.max(instaladasSemana.length, 1);
  const stock = Array.from(stockGroup.values()).map((s) => ({
    ...s,
    cobertura: Math.round((s.paneles + s.inversores + s.baterias) / (consumoSemanal * 5)),
  }));

  const alertas: DashReport['logistica']['alertas'] = stock.map((s) => {
    const total = s.paneles + s.inversores + s.baterias + s.estructuras;
    let nivel: 'Bajo' | 'Medio' | 'Adecuado' = 'Adecuado';
    if (total < 10) nivel = 'Bajo';
    else if (total < 30) nivel = 'Medio';
    return { componente: `Equipos ${s.marca}`, nivel };
  });

  const report: DashReport = {
    periodo: {
      desde: iso(from).slice(5).replace('-', '/'),
      hasta: iso(to).slice(5).replace('-', '/'),
      anio: String(to.getFullYear()),
    },
    global: {
      casasAcum, kwpAcum, kwhAcum, capexAcumM,
      avancePct: metaAnual > 0 ? Math.round((casasAcum / metaAnual) * 100) : 0,
      metaCasas: metaAnual,
      mesesActivos,
      porMes,
    },
    semana: {
      casasInstaladas: instaladasSemana.length,
      programadas: programadasSemana.length,
      standBy: standByProjects.length,
      porIniciar,
      kwpSemana: instaladasSemana.reduce((s, p) => s + getKwp(p), 0),
      kwhSemana: instaladasSemana.reduce((s, p) => s + getKwh(p), 0),
      capexSemanaM: instaladasSemana.reduce((s, p) => s + getCapexM(p), 0),
      motivos,
      detalle: {
        instaladas:  instaladasSemana.map(casaLabel),
        programadas: programadasSemana.map(casaLabel),
        standBy:     standByProjects.map(casaLabel),
        porIniciar:  porIniciarProjects.map(casaLabel),
      },
    },
    detalle: { marcas, zonas, constructores },
    detalleGlobal: { marcas: marcasG, zonas: zonasG, constructores: constructoresG },
    planeacion: {
      casasAsignadas: proximaSemana.length,
      kwpPlan, kwhPlan, capexPlanM,
      constructoresActivos: constructoresProxSet.size,
      constructoresLista: Array.from(constructoresProxSet).join(' · ') || '—',
      zonasActivas: zonasProxSet.size,
      zonasLista: Array.from(zonasProxSet).join(' · ') || '—',
      distribucion: Array.from(distGroup.values()),
    },
    legalizaciones: {
      tramite: legalizProjects.length,
      aprobadas,
      enRevision,
      detalle: legalDetalle,
    },
    postventa: {
      abiertos, enTransito, resueltosSitio,
      detalle: postDetalle,
    },
    logistica: { stock, alertas },
  };

  return NextResponse.json(report);
}
