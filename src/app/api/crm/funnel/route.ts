import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/crm/funnel
 * Devuelve agregaciones para el dashboard de seguimiento:
 *   - Conteo por (módulo, etapa) — solo proyectos donde current_module = ese módulo
 *   - Total por módulo
 *   - Top 50 proyectos más recientes con su estado actual y valores clave
 *   - Estadísticas globales (valor total propuestas firmadas, instalaciones cerradas, etc.)
 */
export async function GET() {
  try {
    const { data: projects, error } = await supabaseAdmin
      .from('crm_projects')
      .select('id, code, title, current_module, sales_stage, engineering_stage, operations_stage, client_name, client_city, invoice_kwh_mensual, propuesta_kwp, propuesta_valor_cop, diseno_kwp, contractor_name, installation_date, operativo_at, legalizado_at, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Conteos por módulo + etapa
    const byModule: Record<string, Record<string, number>> = {
      sales: {}, engineering: {}, operations: {}, closed: {},
    };
    let totalValorPropuesta = 0;
    let totalKwpAprobado = 0;
    let totalCerrados = 0;
    let totalOperativos = 0;
    let totalLegalizados = 0;

    for (const p of projects ?? []) {
      const mod = p.current_module ?? 'sales';
      const stage = mod === 'sales' ? p.sales_stage
        : mod === 'engineering' ? p.engineering_stage
        : mod === 'operations' ? p.operations_stage
        : 'completado';
      if (!byModule[mod]) byModule[mod] = {};
      byModule[mod][stage] = (byModule[mod][stage] ?? 0) + 1;

      if (p.propuesta_valor_cop && p.current_module !== 'sales') {
        // contrato firmado o más adelante → la propuesta ya cerró
        totalValorPropuesta += Number(p.propuesta_valor_cop);
      }
      if (p.diseno_kwp && (p.current_module === 'operations' || p.current_module === 'closed')) {
        totalKwpAprobado += Number(p.diseno_kwp);
      }
      if (p.current_module === 'closed') totalCerrados++;
      if (p.operativo_at) totalOperativos++;
      if (p.legalizado_at) totalLegalizados++;
    }

    return NextResponse.json({
      total: projects?.length ?? 0,
      by_module: byModule,
      stats: {
        total_valor_propuesta_cop: totalValorPropuesta,
        total_kwp_aprobado: totalKwpAprobado,
        cerrados: totalCerrados,
        operativos: totalOperativos,
        legalizados: totalLegalizados,
      },
      projects: projects ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
