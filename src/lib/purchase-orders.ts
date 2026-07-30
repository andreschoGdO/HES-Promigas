/**
 * Reglas compartidas del módulo de Órdenes de Compra, usadas por varias
 * rutas de /api/purchase-orders y /api/budget — un solo lugar para no
 * repetir la definición de "ejecutado" en cada endpoint.
 */

/**
 * Un kWp asignado a una casa cuenta como "ejecutado" solo cuando el
 * proyecto CRM de esa casa ya arrancó instalación física (no basta con
 * estar asignado a la OC — eso es "comprometido", no gastado).
 */
export const EXECUTED_OPERATIONS_STAGES = [
  'instalacion',
  'legalizacion',
  'operativo',
  'logistica_inversa',
  'legalizado',
  'completado',
] as const;

export function isExecutedStage(stage: string | null | undefined): boolean {
  return !!stage && (EXECUTED_OPERATIONS_STAGES as readonly string[]).includes(stage);
}

export const PURCHASE_ORDER_CATEGORIES = [
  'Inversor',
  'Batería',
  'BMS',
  'Equipos adicionales',
  'Medidores',
  'Modem',
  'Paneles',
  'Puntos de anclaje',
  'Análisis estructural',
  'Mano de obra',
  'Factibilidad',
  'Otro',
] as const;

/**
 * Categorías cuyo costo escala con el kWp instalado — una OC real puede
 * mezclar estas con categorías de "otro tema" (ej. Medidores) en las
 * mismas líneas (ver migración 59). El $/kWp de una OC se deriva SOLO de
 * estas categorías, nunca de `valor_total` completo — si no, un ítem plano
 * como "Sistema Medida Direct" infla el precio por kWp de la construcción.
 */
export const CONSTRUCTION_CATEGORIES: readonly string[] = [
  'Inversor',
  'Batería',
  'BMS',
  'Paneles',
  'Puntos de anclaje',
  'Análisis estructural',
  'Mano de obra',
];

export interface PoItemLike {
  categoria: string;
  valor_total: number;
}

export interface OcPricing {
  construccionSubtotal: number;
  flatSubtotal: number;
  /** $/kWp derivado solo de las líneas de construcción. 0 si no aplica (sin kwp_total o sin líneas de construcción). */
  precioKwpConstruccion: number;
}

export function computeOcPricing(items: PoItemLike[], kwpTotal: number | null): OcPricing {
  let construccionSubtotal = 0;
  let flatSubtotal = 0;
  for (const item of items) {
    if (CONSTRUCTION_CATEGORIES.includes(item.categoria)) construccionSubtotal += Number(item.valor_total);
    else flatSubtotal += Number(item.valor_total);
  }
  const precioKwpConstruccion = kwpTotal && kwpTotal > 0 ? construccionSubtotal / kwpTotal : 0;
  return { construccionSubtotal, flatSubtotal, precioKwpConstruccion };
}

export interface SolutionPriceLike {
  solucion: number | null;
  precio_kwp: number;
}

/**
 * Algunas OC (ej. Shuman Solar 4800015213) traen una línea de mano de obra
 * POR solución (1, 2, 3...), cada una con su propio $/kWp — no un precio
 * promedio de toda la OC. Si la casa tiene `solucion` asignada y esa OC
 * tiene un precio cargado para esa solución específica en
 * `purchase_order_solution_prices`, ese precio manda sobre el promedio
 * derivado de `computeOcPricing`.
 */
export function resolvePrecioKwp(
  solucion: number | null | undefined,
  solutionPrices: SolutionPriceLike[],
  precioKwpConstruccion: number,
): number {
  if (solucion != null) {
    const match = solutionPrices.find((sp) => sp.solucion === solucion);
    if (match) return Number(match.precio_kwp);
  }
  return precioKwpConstruccion;
}

/**
 * Costo total que le corresponde a una casa asignada a una OC: su parte de
 * construcción (kwp_asignado × $/kWp — el de su solución si esa OC tiene
 * precio por solución, si no el promedio de las líneas de construcción)
 * más su monto fijo (capturado a mano, para líneas de "otro tema" como
 * medidores — no hay regla automática de reparto para esas).
 */
export function computeAssignmentCost(
  kwpAsignado: number | null | undefined,
  montoFijo: number | null | undefined,
  precioKwp: number,
): number {
  return Number(kwpAsignado ?? 0) * precioKwp + Number(montoFijo ?? 0);
}
