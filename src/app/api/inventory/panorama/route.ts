import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/panorama
 *
 * Devuelve las agregaciones del tab "Panorama" con conteos y costos completos,
 * sin sufrir el cap default de 1000 filas de PostgREST que afectaba al fetch
 * de `/api/inventory/items?limit=2000` (con 1269+ items, se perdían cientos).
 *
 * Estrategia: paginar en el server hasta traer todos los items, y agregar
 * en JS. Es una sola llamada del cliente al lugar de N para cada gráfico.
 *
 * Respuesta:
 *   {
 *     familyStats: [{ family, total, byStatus, totalCostCop, avgCostCop }],
 *     brandStats:  [{ brand, total, byStatus, byFamily, installed, totalCostCop }],
 *     topHouses:   [{ house_id, casa, count, brands }],  // top 15
 *     recentItems: [{ id, serial_number, brand, model, acquired_at, acquired_cost_cop, supplier, family, categoryName }],
 *     consumablesValue: number,
 *     grandTotal: number,
 *     totalItems: number
 *   }
 */

interface RawItem {
  id: string;
  serial_number: string;
  brand: string | null;
  model: string | null;
  status: string;
  acquired_at: string | null;
  acquired_cost_cop: number | null;
  supplier: string | null;
  current_house_id: string | null;
  inventory_categories: { name: string; family: string } | null;
  client_houses: { casa: string } | null;
}

/** Trae TODOS los inventory_items paginando con .range() en tandas de 1000. */
async function fetchAllItems(): Promise<RawItem[]> {
  const PAGE = 1000;
  const all: RawItem[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('inventory_items')
      .select(`
        id, serial_number, brand, model, status,
        acquired_at, acquired_cost_cop, supplier, current_house_id,
        inventory_categories(name, family),
        client_houses(casa)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as RawItem[];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
    if (offset > 50000) break; // safety
  }
  return all;
}

export async function GET() {
  try {
    const [items, consR] = await Promise.all([
      fetchAllItems(),
      supabaseAdmin.from('inventory_consumables').select('stock_quantity, cost_per_unit_cop'),
    ]);

    // ─── Por familia ───
    const byFamily = new Map<string, { family: string; total: number; byStatus: Record<string, number>; totalCostCop: number; avgCostCop: number | null }>();
    for (const it of items) {
      const family = it.inventory_categories?.family ?? 'sin_familia';
      const cur = byFamily.get(family) ?? { family, total: 0, byStatus: {}, totalCostCop: 0, avgCostCop: null };
      cur.total++;
      cur.byStatus[it.status] = (cur.byStatus[it.status] ?? 0) + 1;
      if (it.acquired_cost_cop != null) cur.totalCostCop += Number(it.acquired_cost_cop);
      byFamily.set(family, cur);
    }
    for (const fs of byFamily.values()) {
      const withCost = items.filter((it) => (it.inventory_categories?.family ?? 'sin_familia') === fs.family && it.acquired_cost_cop != null);
      fs.avgCostCop = withCost.length > 0 ? fs.totalCostCop / withCost.length : null;
    }
    const familyStats = Array.from(byFamily.values()).sort((a, b) => b.total - a.total);

    // ─── Por marca ───
    const byBrand = new Map<string, { brand: string; total: number; byStatus: Record<string, number>; byFamily: Record<string, number>; installed: number; totalCostCop: number }>();
    for (const it of items) {
      const brand = it.brand?.trim() || '(Sin marca)';
      const cur = byBrand.get(brand) ?? { brand, total: 0, byStatus: {}, byFamily: {}, installed: 0, totalCostCop: 0 };
      cur.total++;
      cur.byStatus[it.status] = (cur.byStatus[it.status] ?? 0) + 1;
      const family = it.inventory_categories?.family ?? 'sin_familia';
      cur.byFamily[family] = (cur.byFamily[family] ?? 0) + 1;
      if (it.status === 'installed') cur.installed++;
      if (it.acquired_cost_cop != null) cur.totalCostCop += Number(it.acquired_cost_cop);
      byBrand.set(brand, cur);
    }
    const brandStats = Array.from(byBrand.values()).sort((a, b) => b.total - a.total);

    // ─── Top casas por # de equipos installed ───
    const byHouse = new Map<string, { house_id: string; casa: string; count: number; brands: string[] }>();
    for (const it of items) {
      if (it.status !== 'installed' || !it.current_house_id) continue;
      const cur = byHouse.get(it.current_house_id) ?? {
        house_id: it.current_house_id,
        casa: it.client_houses?.casa ?? '—',
        count: 0,
        brands: [] as string[],
      };
      cur.count++;
      if (it.brand && !cur.brands.includes(it.brand)) cur.brands.push(it.brand);
      byHouse.set(it.current_house_id, cur);
    }
    const topHouses = Array.from(byHouse.values()).sort((a, b) => b.count - a.count).slice(0, 15);

    // ─── Items recientemente adquiridos ───
    const recentItems = items
      .filter((it) => it.acquired_at)
      .sort((a, b) => (b.acquired_at ?? '').localeCompare(a.acquired_at ?? ''))
      .slice(0, 10)
      .map((it) => ({
        id: it.id,
        serial_number: it.serial_number,
        brand: it.brand,
        model: it.model,
        acquired_at: it.acquired_at,
        acquired_cost_cop: it.acquired_cost_cop,
        supplier: it.supplier,
        inventory_categories: it.inventory_categories,
      }));

    // ─── Costos ───
    const consumables = (consR.data ?? []) as Array<{ stock_quantity: number; cost_per_unit_cop: number | null }>;
    const consumablesValue = consumables.reduce(
      (acc, c) => acc + Number(c.stock_quantity) * Number(c.cost_per_unit_cop ?? 0),
      0,
    );
    const itemsCost = items.reduce((acc, it) => acc + Number(it.acquired_cost_cop ?? 0), 0);
    const grandTotal = itemsCost + consumablesValue;

    return NextResponse.json({
      familyStats,
      brandStats,
      topHouses,
      recentItems,
      consumablesValue,
      grandTotal,
      totalItems: items.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
