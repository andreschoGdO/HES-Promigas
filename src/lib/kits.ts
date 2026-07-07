/**
 * Lógica de armado de kits solares — compartida entre la UI de Inventario
 * y el endpoint del Dash de Construcción.
 *
 * Cada kit tipo 2/3/4 tiene una receta de componentes (`requiere`) y una
 * prioridad por ciudad (`PRIORITY_BY_CITY`). Ver `computeKits` para el
 * algoritmo de weighted round-robin.
 */

export const KIT_COMPONENT_CODES = {
  INV_LIVOLTEK_10K: 'LIVOLTEK_INV_10KW',
  INV_LIVOLTEK_15K: 'LIVOLTEK_INV_15KW',
  INV_DEYE_15K:     'DEYE_INV_15KW_HV',
  INV_DEYE_6K:      'DEYE_INV_6KW_LV',
  BAT_LIVOLTEK:     'LIVOLTEK_BAT_HV',
  BAT_DEYE:         'DEYE_BAT_HV_4KWH',
  BAT_PYLONTECH:    'PYLONTECH_BAT_LV',
  BMS_LIVOLTEK:     'LIVOLTEK_BMS',
  BMS_DEYE:         'DEYE_BMS',
  BMS_PYLONTECH:    'PYLONTECH_BMS',
  TOP_LIVOLTEK:     'LIVOLTEK_TOP_COVER',
} as const;

export interface KitReq { code: string; qty: number; }
export interface KitDef {
  id: string;
  tipo: 2 | 3 | 4;
  label: string;
  descripcion: string;
  requiere: KitReq[];
}

export const KIT_DEFS: KitDef[] = [
  { id: 'K2A', tipo: 2, label: 'Kit 2A · Deye 6kw + Pylontech (2 bat)',
    descripcion: '1× Inversor Deye 6kW LV · 2× Batería Pylontech LV · 1× BMS Pylontech',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_6K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_PYLONTECH, qty: 2 },
      { code: KIT_COMPONENT_CODES.BMS_PYLONTECH, qty: 1 },
    ] },
  { id: 'K2B', tipo: 2, label: 'Kit 2B · Livoltek 10kw + Livoltek (2 bat)',
    descripcion: '1× Inversor Livoltek 10kW · 2× Batería Livoltek HV · 1× BMS Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_10K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 2 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
    ] },
  { id: 'K2C', tipo: 2, label: 'Kit 2C · Deye 6kw + Pylontech (3 bat)',
    descripcion: '1× Inversor Deye 6kW LV · 3× Batería Pylontech LV · 1× BMS Pylontech',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_6K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_PYLONTECH, qty: 3 },
      { code: KIT_COMPONENT_CODES.BMS_PYLONTECH, qty: 1 },
    ] },
  { id: 'K3A', tipo: 3, label: 'Kit 3A · Livoltek 10kw + Livoltek (3 bat)',
    descripcion: '1× Inversor Livoltek 10kW · 3× Batería Livoltek HV · 1× BMS Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_10K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 3 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
    ] },
  { id: 'K3B', tipo: 3, label: 'Kit 3B · Deye 15kw + Deye HV (3 bat)',
    descripcion: '1× Inversor Deye 15kW HV · 3× Batería Deye HV · 1× BMS Deye',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_DEYE, qty: 3 },
      { code: KIT_COMPONENT_CODES.BMS_DEYE, qty: 1 },
    ] },
  { id: 'K4A', tipo: 4, label: 'Kit 4A · Livoltek 15kw + Livoltek (4 bat)',
    descripcion: '1× Inversor Livoltek 15kW · 4× Batería Livoltek HV · 1× BMS Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 4 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
    ] },
  { id: 'K4B', tipo: 4, label: 'Kit 4B · Deye 15kw + Deye HV (4 bat)',
    descripcion: '1× Inversor Deye 15kW HV · 4× Batería Deye HV · 1× BMS Deye',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_DEYE, qty: 4 },
      { code: KIT_COMPONENT_CODES.BMS_DEYE, qty: 1 },
    ] },
  { id: 'K4C', tipo: 4, label: 'Kit 4C · Livoltek 15kw + Livoltek (6 bat) + Top Cover',
    descripcion: '1× Inversor Livoltek 15kW · 6× Batería Livoltek HV · 1× BMS Livoltek · 1× Top Cover Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 6 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
      { code: KIT_COMPONENT_CODES.TOP_LIVOLTEK, qty: 1 },
    ] },
];

export const PRIORITY_BY_CITY: Record<string, { 2: number; 3: number; 4: number }> = {
  // Cali: mercado residencial estándar → fuerte T2, T3 secundario, T4 marginal
  'Cali':         { 2: 0.55, 3: 0.40, 4: 0.05 },
  // Costa: mercado con más consumo → T3 principal, T4 muy cerca, T2 residual
  'Barranquilla': { 2: 0.10, 3: 0.50, 4: 0.40 },
  'Cartagena':    { 2: 0.10, 3: 0.50, 4: 0.40 },
};
export const DEFAULT_PRIORITY = { 2: 0.34, 3: 0.33, 4: 0.33 };

export interface KitStock { [categoryCode: string]: number; }
export interface KitResult {
  warehouseName: string;
  city: string;
  priority: { 2: number; 3: number; 4: number };
  initialStock: KitStock;
  kitsBuilt: Record<string, number>;
  remaining: KitStock;
  totalKits: number;
  byTipo: { 2: number; 3: number; 4: number };
}

export function maxKitsFor(kit: KitDef, stock: KitStock): number {
  let m = Infinity;
  for (const req of kit.requiere) {
    const have = stock[req.code] ?? 0;
    m = Math.min(m, Math.floor(have / req.qty));
  }
  return m === Infinity ? 0 : m;
}

export function consumeKits(kit: KitDef, n: number, stock: KitStock) {
  for (const req of kit.requiere) {
    stock[req.code] = (stock[req.code] ?? 0) - req.qty * n;
  }
}

/**
 * Weighted round-robin: mantiene el ratio T2/T3/T4 en tiempo real, respetando
 * estrictamente la prioridad de la ciudad. Ver comentarios en el algoritmo
 * original de /inventario para detalle.
 */
export function computeKits(city: string, warehouseName: string, initialStock: KitStock): KitResult {
  const prio = PRIORITY_BY_CITY[city] ?? DEFAULT_PRIORITY;
  const stock: KitStock = { ...initialStock };
  const kitsBuilt: Record<string, number> = {};
  const countByTipo: Record<2 | 3 | 4, number> = { 2: 0, 3: 0, 4: 0 };

  const attempt = (tipo: 2 | 3 | 4): boolean => {
    const kitsDelTipo = KIT_DEFS
      .filter((k) => k.tipo === tipo)
      .slice()
      .sort((a, b) => (kitsBuilt[a.id] ?? 0) - (kitsBuilt[b.id] ?? 0));
    for (const kit of kitsDelTipo) {
      if (maxKitsFor(kit, stock) >= 1) {
        consumeKits(kit, 1, stock);
        kitsBuilt[kit.id] = (kitsBuilt[kit.id] ?? 0) + 1;
        countByTipo[tipo]++;
        return true;
      }
    }
    return false;
  };

  let total = 0;
  let progreso = true;
  while (progreso) {
    progreso = false;
    const denom = total + 1;
    const ordenPorDeficit: Array<2 | 3 | 4> = ([2, 3, 4] as const)
      .slice()
      .sort((a, b) => {
        const deficitA = prio[a] - (countByTipo[a] / denom);
        const deficitB = prio[b] - (countByTipo[b] / denom);
        return deficitB - deficitA;
      });
    for (const tipo of ordenPorDeficit) {
      if (prio[tipo] <= 0) continue;
      if (attempt(tipo)) {
        total++;
        progreso = true;
        break;
      }
    }
  }

  let totalKits = 0;
  for (const kit of KIT_DEFS) totalKits += kitsBuilt[kit.id] ?? 0;

  return { warehouseName, city, priority: prio, initialStock, kitsBuilt, remaining: stock, totalKits, byTipo: countByTipo };
}
