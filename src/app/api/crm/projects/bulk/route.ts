import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/crm/projects/bulk
 * Recibe { rows: object[], created_by: string }
 *
 * Crea N proyectos en Operaciones (único módulo activo). Stage por defecto:
 * 'dimensionado'. Cada row puede sobreescribir con su propia columna `stage`.
 * Devuelve { inserted, total, errors }.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  // Tolerar formato es-CO (coma decimal) y separadores de miles. Ej: "1.234,56" → 1234.56
  let s = String(v).trim();
  if (s.includes(',') && !/^\d+,\d+,/.test(s)) {
    // Si hay punto Y coma, asumir formato europeo (punto miles, coma decimal): "1.234,56"
    if (s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.'); // solo coma → coma decimal
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Columnas que el CSV puede traer. Cualquier otra se ignora silenciosamente.
const STRING_COLS = [
  'client_name', 'client_email', 'client_phone', 'client_address', 'client_city',
  'client_doc_type', 'client_doc_number', 'tipo_vivienda',
  'conjunto', 'casa_numero', 'carga_carro_electrico',
  'propuesta_url', 'contrato_url', 'oferta_url',
  'diseno_inversor_marca', 'diseno_bateria_marca',
  'diseno_inversor_categoria_id', 'diseno_panel_categoria_id', 'diseno_bateria_categoria_id',
  'diseno_notes', 'diseno_aprobado_por',
  'contractor_name', 'contractor_email', 'installation_date',
  'assigned_to', 'notes',
  'tipo_red',
  // Dash Construcción (mig 39)
  'zona',
  'agpe_operador_red', 'agpe_estado', 'agpe_fecha_estimada', 'agpe_fecha_aprobacion',
  'garantia_marca', 'garantia_equipo', 'garantia_falla', 'garantia_estado', 'garantia_retorno_bodega',
  // Operativo
  'operativo_at',
] as const;
const NUM_COLS = [
  'estrato', 'lat', 'lng', 'autosuficiencia_objetivo_pct',
  'invoice_kwh_mensual', 'invoice_valor_cop',
  'propuesta_kwp', 'propuesta_valor_cop',
  'diseno_kwp', 'diseno_paneles', 'diseno_baterias_cantidad',
  'diseno_inversor_potencia_kw', 'diseno_bateria_capacidad_kwh',
  'diseno_yield_estimado_kwh_mes',
  'lectura_inicial_kwh',
] as const;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'rows debe ser array' }, { status: 400 });
    }
    const createdBy = str(body.created_by);
    if (str(body.module) && str(body.module) !== 'operations') {
      return NextResponse.json({ error: `module inválido: "${str(body.module)}". Solo se acepta 'operations'.` }, { status: 400 });
    }

    const inserted: Array<{ id: string; title: string }> = [];
    const errors: Array<{ row: number; title: string; error: string }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const r = body.rows[i] as Record<string, unknown>;
      const title = str(r.title);
      if (!title) {
        errors.push({ row: i + 1, title: '', error: 'title vacío' });
        continue;
      }

      const rowStage = str(r.stage) ?? 'dimensionado';

      const payload: Record<string, unknown> = {
        title,
        current_module: 'operations',
        sales_stage: 'completado',
        engineering_stage: 'completado',
        operations_stage: rowStage,
        created_by: createdBy,
      };
      for (const c of STRING_COLS) payload[c] = str(r[c]);
      for (const c of NUM_COLS) payload[c] = num(r[c]);
      // assigned_to default = created_by
      if (!payload.assigned_to) payload.assigned_to = createdBy;
      // Aprobación automática si viene aprobador
      if (str(r.diseno_aprobado_por)) {
        payload.diseno_aprobado_at = new Date().toISOString();
      }
      // Si el CSV manda stage=operativo pero no operativo_at, estamparlo con
      // installation_date (si existe) o now(). Sin esto, el Dash no cuenta la
      // casa en el mes correcto.
      if (rowStage === 'operativo' && !payload.operativo_at) {
        payload.operativo_at = str(r.installation_date)
          ? new Date(String(r.installation_date)).toISOString()
          : new Date().toISOString();
      }
      // Limpiar nulls para que la BD aplique sus defaults
      for (const k of Object.keys(payload)) {
        if (payload[k] === null || payload[k] === undefined) delete payload[k];
      }

      const { data, error } = await supabaseAdmin
        .from('crm_projects')
        .insert(payload)
        .select('id, title')
        .single();
      if (error) {
        errors.push({ row: i + 1, title, error: error.message });
        continue;
      }
      inserted.push(data);

      await supabaseAdmin.from('crm_project_events').insert({
        project_id: data.id,
        event_type: 'created',
        to_module: 'operations',
        to_stage: rowStage,
        actor_email: createdBy,
        notes: `Importado vía CSV (fila ${i + 1})`,
      });
    }

    return NextResponse.json({ inserted: inserted.length, total: body.rows.length, errors });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
