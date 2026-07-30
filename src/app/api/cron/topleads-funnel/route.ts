import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listPipelines, listAllDealStages, listDealsByGroup } from '@/lib/activecampaign';

const PIPELINE_VENTAS_ID = '1'; // "Prospectos Sunny"

/**
 * GET /api/cron/topleads-funnel
 *
 * Foto diaria (reemplaza todo) del funnel de ventas de TopLeads (pipeline
 * "Prospectos Sunny"): conteo + valor por etapa, solo deals abiertos →
 * topleads_funnel_snapshot.
 *
 * La "BD Clientes Firmados Construcción" NO vive acá — sale de nuestro
 * propio crm_projects, en vivo (ver /api/topleads/construccion). La
 * primera versión de este cron asumía que salía del pipeline
 * "Constructoras" de TopLeads; corregido en migración 61 al comparar
 * contra el Excel real de referencia.
 *
 * No tiene entrada propia en vercel.json (mismo motivo que
 * import-activecampaign — Vercel Hobby limita a 2 crons): lo llama
 * /api/cron/sync como un paso más de su cascada diaria.
 *
 * Auth: Authorization Bearer CRON_SECRET, x-trigger: manual, o
 * x-internal-cron: 1 (llamada desde /api/cron/sync).
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  const isInternalUI = (request.headers.get('x-trigger') ?? 'cron') === 'manual';
  const isInternalCascade = request.headers.get('x-internal-cron') === '1';
  if (secret && auth !== `Bearer ${secret}` && !isInternalUI && !isInternalCascade) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const [pipelines, stages] = await Promise.all([listPipelines(), listAllDealStages()]);
    const pipelineTitle = new Map(pipelines.map((p) => [p.id, p.title]));
    const ventasStages = stages
      .filter((s) => s.group === PIPELINE_VENTAS_ID)
      .sort((a, b) => Number(a.order) - Number(b.order));

    // Solo deals ABIERTOS (status '0') — igual que la vista Kanban de
    // TopLeads, que por defecto filtra "Estado: Abierto". Un deal Ganado o
    // Perdido queda con la última etapa guardada, pero ya no cuenta como
    // "en" esa etapa del funnel activo.
    const ventasDeals = (await listDealsByGroup(PIPELINE_VENTAS_ID)).filter((d) => d.status === '0');
    const countByStage = new Map<string, { count: number; value: number }>();
    for (const d of ventasDeals) {
      const acc = countByStage.get(d.stage) ?? { count: 0, value: 0 };
      acc.count += 1;
      acc.value += Number(d.value ?? 0);
      countByStage.set(d.stage, acc);
    }

    const funnelRows = ventasStages.map((s) => ({
      pipeline_id: PIPELINE_VENTAS_ID,
      pipeline_title: pipelineTitle.get(PIPELINE_VENTAS_ID) ?? 'Prospectos Sunny',
      stage_id: s.id,
      stage_title: s.title,
      stage_order: Number(s.order),
      deals_count: countByStage.get(s.id)?.count ?? 0,
      deals_value_total: countByStage.get(s.id)?.value ?? 0,
    }));

    await supabaseAdmin.from('topleads_funnel_snapshot').delete().eq('pipeline_id', PIPELINE_VENTAS_ID);
    if (funnelRows.length > 0) {
      const { error } = await supabaseAdmin.from('topleads_funnel_snapshot').insert(funnelRows);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      funnel_stages: funnelRows.length,
      funnel_deals: ventasDeals.length,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
