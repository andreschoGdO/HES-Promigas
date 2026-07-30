import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listPipelines, listAllDealStages, listDealsByGroup, getContact } from '@/lib/activecampaign';

const PIPELINE_VENTAS_ID = '1';   // "Prospectos Sunny"
const PIPELINE_CONSTRUCCION_ID = '4'; // "Constructoras" — el "CRM de construcción"

/**
 * GET /api/cron/topleads-funnel
 *
 * Foto diaria (reemplaza todo) de:
 *  1. El funnel de ventas (pipeline "Prospectos Sunny"): conteo + valor
 *     por etapa → topleads_funnel_snapshot.
 *  2. Todos los deals del pipeline "Constructoras" (el CRM de
 *     construcción) → topleads_construccion_deals — la "BD Clientes
 *     Firmados Construcción".
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

    // ---- 1. Funnel de ventas ----
    const ventasDeals = await listDealsByGroup(PIPELINE_VENTAS_ID);
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

    // ---- 2. BD Clientes Firmados Construcción (pipeline "Constructoras") ----
    const construccionDeals = await listDealsByGroup(PIPELINE_CONSTRUCCION_ID);
    const stageTitleById = new Map(stages.map((s) => [s.id, s.title]));

    // Resolver contactos una sola vez por id (varios deals comparten el mismo contacto/constructora).
    const contactIds = Array.from(new Set(construccionDeals.map((d) => d.contact).filter(Boolean)));
    const contactById = new Map<string, { firstName: string; lastName: string; email: string; phone: string } | null>();
    for (const cid of contactIds) {
      contactById.set(cid, await getContact(cid));
    }

    const construccionRows = construccionDeals.map((d) => {
      const contact = contactById.get(d.contact) ?? null;
      return {
        ac_deal_id: d.id,
        title: d.title,
        stage_id: d.stage,
        stage_title: stageTitleById.get(d.stage) ?? d.stage,
        contact_name: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
        contact_email: contact?.email ?? null,
        contact_phone: contact?.phone ?? null,
        value: Number(d.value ?? 0),
        ac_created_at: d.cdate ? new Date(d.cdate).toISOString() : null,
        ac_updated_at: d.mdate ? new Date(d.mdate).toISOString() : null,
      };
    });

    await supabaseAdmin.from('topleads_construccion_deals').delete().neq('ac_deal_id', '');
    if (construccionRows.length > 0) {
      const { error } = await supabaseAdmin.from('topleads_construccion_deals').insert(construccionRows);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      funnel_stages: funnelRows.length,
      funnel_deals: ventasDeals.length,
      construccion_deals: construccionRows.length,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
