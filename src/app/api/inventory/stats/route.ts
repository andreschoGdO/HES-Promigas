import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/inventory/stats
 *
 * Devuelve conteos agregados de inventory_items por status + resumen de
 * consumables. Usa `count: 'exact', head: true` (queries de sólo conteo, no
 * traen filas), evitando el cap de 1000 filas por request de PostgREST que
 * afectaba a `/api/inventory/items?limit=2000`.
 *
 * Respuesta:
 *   {
 *     totalItems: number,
 *     inStock: number,
 *     reserved: number,
 *     installed: number,
 *     inRepair: number,        // in_repair + rma
 *     decommissioned: number,
 *     totalConsumables: number,
 *     lowStockCount: number,
 *     warrantyExpiring: number  // items con warranty vence en ≤ 60 días
 *   }
 */

async function countBy(field: string, value: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('inventory_items')
    .select('id', { count: 'exact', head: true })
    .eq(field, value);
  return count ?? 0;
}

export async function GET() {
  try {
    // Total items sin filtro
    const { count: totalItems } = await supabaseAdmin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true });

    // Conteos por status (queries paralelos)
    const [inStock, reserved, installed, inRepair, rma, decommissioned] = await Promise.all([
      countBy('status', 'in_stock'),
      countBy('status', 'reserved'),
      countBy('status', 'installed'),
      countBy('status', 'in_repair'),
      countBy('status', 'rma'),
      countBy('status', 'decommissioned'),
    ]);

    // Warranty vence en ≤ 60 días
    const today = new Date().toISOString().slice(0, 10);
    const in60d = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const { count: warrantyExpiring } = await supabaseAdmin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .gte('warranty_expires_at', today)
      .lte('warranty_expires_at', in60d);

    // Consumables
    const { data: consumables } = await supabaseAdmin
      .from('inventory_consumables')
      .select('stock_quantity, min_threshold');
    const totalConsumables = consumables?.length ?? 0;
    const lowStockCount = (consumables ?? []).filter(
      (c) => Number(c.stock_quantity ?? 0) <= Number(c.min_threshold ?? 0),
    ).length;

    return NextResponse.json({
      totalItems: totalItems ?? 0,
      inStock,
      reserved,
      installed,
      inRepair: inRepair + rma,
      decommissioned,
      totalConsumables,
      lowStockCount,
      warrantyExpiring: warrantyExpiring ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
