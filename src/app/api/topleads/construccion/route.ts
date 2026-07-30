import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/topleads/construccion
 * "BD Clientes Firmados Construcción" — replica en vivo del Excel de
 * referencia (hojas VALLE/COSTA), enriquecida con el estado real del CRM
 * de Construcción. No depende de tener zona o fecha de firma cargadas: una
 * obra ya instalada o en legalización debe seguir apareciendo aunque esos
 * datos históricos estén incompletos.
 *   #, Fecha de firma, Días, Título, CIUDAD, Conjunto Residencial, Casa,
 *   Nombre Completo, Fecha estimada inicio, DÍAS, Estudio estructural,
 *   Instalación.
 *
 * Sale de nuestro propio crm_projects (no de TopLeads). Se consulta en vivo,
 * sin snapshot: siempre está tan actualizado como el CRM mismo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const zonaFilter = url.searchParams.get('zona'); // 'Valle' | 'Costa' | null (todas)

  // Filtro único y estricto: contrato firmado — para que el conteo de esta
  // tabla sea CONGRUENTE con la etapa "Firmado" del funnel de arriba (no
  // se restringe además por operations_stage/current_module, para no
  // excluir por accidente un proyecto recién firmado que todavía no pasó
  // a Operaciones).
  let query = supabaseAdmin
    .from('crm_projects')
    .select('id, code, title, conjunto, casa_numero, client_name, client_doc_number, client_city, zona, contrato_signed_at, cronograma_fecha_inicio, installation_date, diseno_aprobado_at, operations_stage, current_module, operativo_at, legalizado_at, agpe_estado, agpe_fecha_aprobacion, created_at')
    .not('contrato_signed_at', 'is', null)
    .order('contrato_signed_at', { ascending: true });

  // "Todas" incluye también proyectos históricos sin zona diligenciada.
  if (zonaFilter === 'Valle' || zonaFilter === 'Costa') query = query.eq('zona', zonaFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

  const rows = (data ?? []).map((p, i) => {
    const firma = p.contrato_signed_at ? new Date(p.contrato_signed_at) : null;
    const inicio = p.cronograma_fecha_inicio ? new Date(p.cronograma_fecha_inicio) : null;
    const estadoObra = p.operations_stage === 'legalizacion'
      ? 'Instalado — legalizándose'
      : p.operations_stage === 'operativo'
        ? (p.legalizado_at || p.agpe_fecha_aprobacion || p.agpe_estado === 'Legalizada' ? 'Instalado — legalizado' : 'Instalado — operativo')
        : p.operations_stage === 'instalacion'
          ? 'Instalación en curso'
          : p.operations_stage === 'alistamiento'
            ? 'Por instalar — alistamiento'
            : 'Por instalar'; // firmado pero todavía no llegó a Operaciones (dimensionado o antes)

    return {
      numero: i + 1,
      fecha_firma: p.contrato_signed_at,
      dias_desde_firma: firma ? daysBetween(today, firma) : null,
      titulo: p.title || `${p.conjunto ?? ''}-${p.casa_numero ?? ''} (${p.client_name ?? ''}-${p.client_doc_number ?? ''})`,
      ciudad: p.client_city,
      conjunto_residencial: p.conjunto,
      casa: p.casa_numero,
      nombre_completo: p.client_name,
      fecha_estimada_inicio: p.cronograma_fecha_inicio ?? p.installation_date,
      dias_para_inicio: inicio ? daysBetween(inicio, today) : null,
      estudio_estructural: p.diseno_aprobado_at ? 'APROBADO' : 'PENDIENTE',
      instalacion: estadoObra,
      zona: p.zona ?? 'Sin zona',
      operations_stage: p.operations_stage,
    };
  });

  const summary = {
    por_instalar: rows.filter((p) => p.operations_stage === 'dimensionado' || p.operations_stage === 'alistamiento').length,
    en_instalacion: rows.filter((p) => p.operations_stage === 'instalacion').length,
    instalados: rows.filter((p) => p.operations_stage === 'operativo').length,
    legalizandose: rows.filter((p) => p.operations_stage === 'legalizacion').length,
  };

  return NextResponse.json({ deals: rows, summary, capturedAt: new Date().toISOString() });
}
