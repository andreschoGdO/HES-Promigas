import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/topleads/construccion
 * "BD Clientes Firmados Construcción" — replica en vivo del Excel de
 * referencia (hojas VALLE/COSTA): casas con contrato firmado en zona
 * 'Valle' o 'Costa', con las mismas columnas que el Excel:
 *   #, Fecha de firma, Días, Título, CIUDAD, Conjunto Residencial, Casa,
 *   Nombre Completo, Fecha estimada inicio, DÍAS, Estudio estructural,
 *   Instalación.
 *
 * Sale de nuestro propio crm_projects (no de TopLeads) — `zona` ya guarda
 * 'Valle'/'Costa' literal desde la migración 43. Se consulta en vivo, sin
 * snapshot: siempre está tan actualizado como el CRM mismo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const zonaFilter = url.searchParams.get('zona'); // 'Valle' | 'Costa' | null (ambas)

  let query = supabaseAdmin
    .from('crm_projects')
    .select('id, conjunto, casa_numero, client_name, client_doc_number, client_city, zona, contrato_signed_at, cronograma_fecha_inicio, diseno_aprobado_at, operations_stage')
    .in('zona', zonaFilter ? [zonaFilter] : ['Valle', 'Costa'])
    .not('contrato_signed_at', 'is', null)
    .order('contrato_signed_at', { ascending: true });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

  const rows = (data ?? []).map((p, i) => {
    const firma = p.contrato_signed_at ? new Date(p.contrato_signed_at) : null;
    const inicio = p.cronograma_fecha_inicio ? new Date(p.cronograma_fecha_inicio) : null;
    const instalacion = p.operations_stage === 'operativo' || p.operations_stage === 'legalizado' || p.operations_stage === 'completado'
      ? 'Si'
      : p.operations_stage === 'instalacion' ? 'En proceso' : null;

    return {
      numero: i + 1,
      fecha_firma: p.contrato_signed_at,
      dias_desde_firma: firma ? daysBetween(today, firma) : null,
      titulo: `${p.conjunto ?? ''}-${p.casa_numero ?? ''} (${p.client_name ?? ''}-${p.client_doc_number ?? ''})`,
      ciudad: p.client_city,
      conjunto_residencial: p.conjunto,
      casa: p.casa_numero,
      nombre_completo: p.client_name,
      fecha_estimada_inicio: p.cronograma_fecha_inicio,
      dias_para_inicio: inicio ? daysBetween(inicio, today) : null,
      estudio_estructural: p.diseno_aprobado_at ? 'APROBADO' : 'PENDIENTE',
      instalacion,
      zona: p.zona,
    };
  });

  return NextResponse.json({ deals: rows, capturedAt: new Date().toISOString() });
}
