import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface BulkRow {
  serial_number: string;
  category_code?: string;
  brand?: string;
  model?: string;
  capacity_value?: number | string;
  capacity_unit?: string;
  acquired_at?: string;
  acquired_cost_cop?: number | string;
  supplier?: string;
  invoice_number?: string;
  warranty_months?: number | string;
  notes?: string;
}

/**
 * POST /api/inventory/items/bulk
 * Recibe { rows: BulkRow[], created_by: string }
 * Crea N items + N movimientos de recepción.
 * Devuelve { inserted, errors }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.rows)) return NextResponse.json({ error: 'rows debe ser array' }, { status: 400 });
    const createdBy = body.created_by ?? null;

    // Cache de categorías por code
    const { data: cats } = await supabaseAdmin.from('inventory_categories').select('id, code');
    const catByCode = new Map((cats ?? []).map((c: { id: string; code: string }) => [c.code.toUpperCase(), c.id]));

    const inserted: Array<{ id: string; serial_number: string }> = [];
    const errors: Array<{ row: number; serial: string; error: string }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const r: BulkRow = body.rows[i];
      if (!r.serial_number || !String(r.serial_number).trim()) {
        errors.push({ row: i + 1, serial: '', error: 'serial vacío' });
        continue;
      }
      const sn = String(r.serial_number).trim();
      const categoryId = r.category_code ? catByCode.get(r.category_code.toUpperCase()) : null;

      let warrantyExpires: string | null = null;
      if (r.acquired_at && r.warranty_months) {
        const d = new Date(r.acquired_at);
        d.setMonth(d.getMonth() + Number(r.warranty_months));
        warrantyExpires = d.toISOString().slice(0, 10);
      }

      const payload = {
        category_id: categoryId,
        serial_number: sn,
        brand: r.brand ?? null,
        model: r.model ?? null,
        capacity_value: r.capacity_value !== undefined && r.capacity_value !== '' ? Number(r.capacity_value) : null,
        capacity_unit: r.capacity_unit ?? null,
        status: 'in_stock' as const,
        current_location: 'warehouse' as const,
        acquired_at: r.acquired_at ?? null,
        acquired_cost_cop: r.acquired_cost_cop !== undefined && r.acquired_cost_cop !== '' ? Number(r.acquired_cost_cop) : null,
        supplier: r.supplier ?? null,
        invoice_number: r.invoice_number ?? null,
        warranty_months: r.warranty_months !== undefined && r.warranty_months !== '' ? Number(r.warranty_months) : null,
        warranty_expires_at: warrantyExpires,
        notes: r.notes ?? null,
        created_by: createdBy,
      };

      const { data, error } = await supabaseAdmin.from('inventory_items').insert(payload).select('id, serial_number').single();
      if (error) {
        errors.push({ row: i + 1, serial: sn, error: error.message });
        continue;
      }
      inserted.push(data);

      await supabaseAdmin.from('inventory_movements').insert({
        item_id: data.id,
        type: 'receive',
        to_status: 'in_stock',
        to_location: 'warehouse',
        responsible_email: createdBy,
        notes: `Recepción CSV (fila ${i + 1})`,
      });
    }

    return NextResponse.json({ inserted: inserted.length, total: body.rows.length, errors });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
