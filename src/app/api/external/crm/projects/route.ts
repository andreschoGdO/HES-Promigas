import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Endpoint externo para crear cards (proyectos) en el CRM desde otras apps.
 *
 * Autenticación: header `X-API-Key: <key>` o `Authorization: Bearer <key>`.
 * La key se configura como env var CRM_API_KEY en Vercel (Production + Preview).
 * Si la env var no está set, el endpoint rechaza TODAS las requests (seguro por defecto).
 *
 * Endpoint:
 *   POST /api/external/crm/projects
 *
 * Body mínimo:
 *   { "title": "Casa Juan Pérez - Cali" }
 *
 * Body completo (todos los campos son opcionales salvo title):
 *   {
 *     "title": "Casa Juan Pérez - Cali",
 *     "external_id": "campaign-2026-001",      // idempotencia: si ya existe, devuelve el existente
 *     "client_name": "Juan Pérez",
 *     "client_email": "juan@ejemplo.co",
 *     "client_phone": "+57 300 1234567",
 *     "client_address": "Calle 123 #45-67",
 *     "client_city": "Cali",
 *     "client_doc_type": "CC",
 *     "client_doc_number": "123456789",
 *     "estrato": 4,
 *     "tipo_vivienda": "Casa unifamiliar",
 *     "invoice_kwh_mensual": 450,
 *     "invoice_valor_cop": 380000,
 *     "lat": 3.42,
 *     "lng": -76.54,
 *     "assigned_to": "vendedor@bia.app",       // email del comercial responsable
 *     "notes": "Vino de la campaña Meta Ads X",
 *     "source": "meta_ads"                     // se guarda en custom_data para tracking
 *   }
 *
 * Respuesta (201 si se creó, 200 si ya existía por external_id):
 *   {
 *     "ok": true,
 *     "created": true,
 *     "project": {
 *       "id": "uuid",
 *       "code": "PROJ-2026-0042",
 *       "title": "Casa Juan Pérez - Cali",
 *       "current_module": "sales",
 *       "sales_stage": "prospecto",
 *       "created_at": "..."
 *     }
 *   }
 *
 * Errores:
 *   401 — API key inválida o env var no configurada
 *   400 — title faltante o tipos inválidos
 *   500 — error de BD
 */

function authorize(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.CRM_API_KEY;
  if (!expected) {
    return { ok: false, status: 401, error: 'API externa deshabilitada: CRM_API_KEY no configurada en el servidor' };
  }
  const headerKey = request.headers.get('x-api-key');
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const provided = headerKey ?? bearer ?? '';
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: 'API key inválida o no proporcionada (usar X-API-Key o Authorization: Bearer ...)' };
  }
  return { ok: true };
}

export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido en el body' }, { status: 400 });
  }
  if (!body.title || typeof body.title !== 'string') {
    return NextResponse.json({ ok: false, error: 'title es requerido (string)' }, { status: 400 });
  }

  const externalId = body.external_id ? String(body.external_id).trim() : null;
  const source = body.source ? String(body.source).trim() : null;

  // Idempotencia: si llega external_id y ya existe un proyecto con ese mismo external_id en custom_data, devolverlo
  if (externalId) {
    const { data: existing } = await supabaseAdmin
      .from('crm_projects')
      .select('id, code, title, current_module, sales_stage, created_at')
      .filter('custom_data->>external_id', 'eq', externalId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, created: false, project: existing });
    }
  }

  // Construir payload — solo campos conocidos del schema
  const numField = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const strField = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };

  const customData: Record<string, unknown> = {};
  if (externalId) customData.external_id = externalId;
  if (source) customData.source = source;

  const payload = {
    title: String(body.title).trim(),
    client_name: strField(body.client_name),
    client_email: strField(body.client_email),
    client_phone: strField(body.client_phone),
    client_address: strField(body.client_address),
    client_city: strField(body.client_city),
    client_doc_type: strField(body.client_doc_type),
    client_doc_number: strField(body.client_doc_number),
    estrato: numField(body.estrato),
    tipo_vivienda: strField(body.tipo_vivienda),
    lat: numField(body.lat),
    lng: numField(body.lng),
    invoice_kwh_mensual: numField(body.invoice_kwh_mensual),
    invoice_valor_cop: numField(body.invoice_valor_cop),
    assigned_to: strField(body.assigned_to),
    notes: strField(body.notes),
    created_by: strField(body.created_by) ?? 'external-api',
    custom_data: Object.keys(customData).length > 0 ? customData : {},
  };

  const { data: project, error } = await supabaseAdmin
    .from('crm_projects')
    .insert(payload)
    .select('id, code, title, current_module, sales_stage, created_at')
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Audit event
  await supabaseAdmin.from('crm_project_events').insert({
    project_id: project.id,
    event_type: 'created',
    to_module: 'sales',
    to_stage: 'prospecto',
    actor_email: 'external-api',
    notes: source ? `Creado vía API externa (source: ${source})` : 'Creado vía API externa',
    data: { external_id: externalId, source },
  });

  return NextResponse.json({ ok: true, created: true, project }, { status: 201 });
}

/** GET — info del endpoint para debugging */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  return NextResponse.json({
    ok: true,
    info: 'Endpoint para crear proyectos en el CRM desde apps externas.',
    method: 'POST',
    required: ['title'],
    optional_fields: [
      'external_id', 'source',
      'client_name', 'client_email', 'client_phone', 'client_address', 'client_city',
      'client_doc_type', 'client_doc_number', 'estrato', 'tipo_vivienda', 'lat', 'lng',
      'invoice_kwh_mensual', 'invoice_valor_cop', 'assigned_to', 'notes', 'created_by',
    ],
    idempotency: 'Si envías external_id y ya existe un proyecto con ese mismo external_id, se retorna el existente (created: false).',
    auth: 'Header X-API-Key: <key> o Authorization: Bearer <key>. Key configurada en env var CRM_API_KEY.',
  });
}
