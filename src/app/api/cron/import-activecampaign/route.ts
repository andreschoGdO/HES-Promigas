import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { listDealsByGroup, getDealCustomFieldData, getContact, getUser } from '@/lib/activecampaign';
import { mapDealToProject } from '@/lib/activecampaign-mapping';

/**
 * GET /api/cron/import-activecampaign
 *
 * Importa a crm_projects los deals de ActiveCampaign que llegaron a
 * "Contrato firmado" (pipeline Ventas, stage id 47) O más allá (55
 * Instalados, 30 PRUEBAS, 45 Validar con negocio, o ganado) y todavía no
 * tienen un proyecto acá (dedup por ac_deal_id). La etapa inicial en
 * operaciones no es siempre "Dimensionado" — se deriva de dónde viene el
 * deal en TopLeads, ver `initialOperationsStage`. Contratista y fechas de
 * cronograma NO vienen de ActiveCampaign — quedan vacías; el proyecto no
 * podrá pasar a Alistamiento hasta que alguien las complete (gate ya
 * existente en la transición).
 *
 * Antes solo miraba deals parados EN ESE MOMENTO en la etapa 47 — un trato
 * que avanzaba de largo el mismo día (p.ej. de Contrato enviado directo a
 * Instalados) nunca quedaba capturado. Verificado en vivo: 38 de 88 tratos
 * ya "firmados" en TopLeads no tenían fila en crm_projects por este motivo.
 *
 * Ver docs/superpowers/specs/2026-07-21-activecampaign-import-design.md
 *
 * No tiene entrada propia en vercel.json — Vercel Hobby limita a 2 cron
 * jobs y ya estaban ocupados por /api/cron/sync y /api/cron/compute-
 * curtailment. En su lugar, /api/cron/sync lo llama como un paso más de
 * su cascada diaria (header x-internal-cron). Se puede seguir invocando
 * suelto para pruebas manuales (x-trigger: manual) o vía Vercel Cron si
 * el plan cambia a Pro y se le agrega su propia entrada.
 *
 * Auth: Authorization Bearer CRON_SECRET, x-trigger: manual (UI interna),
 * o x-internal-cron: 1 (llamada same-origin desde /api/cron/sync).
 */
export const runtime = 'nodejs';
export const maxDuration = 120;

const PIPELINE_VENTAS_ID = '1'; // "Prospectos Sunny"
// Etapas >= "Contrato firmado" en el orden del pipeline (ver STAGE_ORDER en
// funnel-comercial/route.ts) — excluye "No viable" (6).
const ADVANCED_STAGE_IDS = new Set(['47', '55', '30', '45']);

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Etapa de operaciones inicial para un proyecto nuevo, según dónde viene el
 * deal en TopLeads (mapeo confirmado con el usuario comparando ambos
 * sistemas): Ganado (instalación terminada) → operativo; abierto en
 * Instalados (obra en curso) → alistamiento; abierto en Contrato firmado
 * (obra sin empezar) → dimensionado.
 */
function initialOperationsStage(status: string, stage: string): string {
  if (status === '1') return 'operativo';
  if (stage === '55') return 'alistamiento';
  return 'dimensionado';
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  const isInternalUI = (request.headers.get('x-trigger') ?? 'cron') === 'manual';
  const isInternalCascade = request.headers.get('x-internal-cron') === '1';
  if (secret && auth !== `Bearer ${secret}` && !isInternalUI && !isInternalCascade) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startTs = Date.now();
  const errors: Array<{ deal_id: string; error: string }> = [];
  let imported = 0;
  let skipped = 0;
  let linked = 0;

  try {
    const allDeals = await listDealsByGroup(PIPELINE_VENTAS_ID);
    const deals = allDeals.filter((d) => d.status === '1' || (d.status === '0' && ADVANCED_STAGE_IDS.has(d.stage)));

    // Dedup en 2 niveles:
    //  1) ac_deal_id ya presente → ya lo importamos antes, saltar.
    //  2) título O (conjunto+casa_numero) coincide con un proyecto creado a
    //     mano ANTES de que existiera esta importación (ac_deal_id null) →
    //     no crear uno nuevo, solo pegarle el ac_deal_id para trazabilidad,
    //     sin tocar ningún otro campo (puede tener datos editados a mano).
    const { data: existing } = await supabaseAdmin
      .from('crm_projects')
      .select('id, title, conjunto, casa_numero, ac_deal_id');
    const byDealId = new Map((existing ?? []).filter((p) => p.ac_deal_id).map((p) => [p.ac_deal_id as string, p]));
    const byTitle = new Map((existing ?? []).filter((p) => !p.ac_deal_id).map((p) => [norm(p.title), p]));
    const byConjCasa = new Map(
      (existing ?? [])
        .filter((p) => !p.ac_deal_id && p.conjunto && p.casa_numero)
        .map((p) => [`${norm(p.conjunto)}|${norm(p.casa_numero)}`, p]),
    );

    for (const deal of deals) {
      if (byDealId.has(deal.id)) { skipped++; continue; }
      try {
        const [customFieldData, contact, owner] = await Promise.all([
          getDealCustomFieldData(deal.id),
          deal.contact ? getContact(deal.contact) : Promise.resolve(null),
          deal.owner ? getUser(deal.owner) : Promise.resolve(null),
        ]);
        const mapped = mapDealToProject(deal.title, customFieldData, contact, owner);

        const conjCasaKey = mapped.conjunto && mapped.casa_numero ? `${norm(mapped.conjunto)}|${norm(mapped.casa_numero)}` : null;
        const preExisting = byTitle.get(norm(deal.title)) ?? (conjCasaKey ? byConjCasa.get(conjCasaKey) : undefined);

        if (preExisting) {
          const { error } = await supabaseAdmin.from('crm_projects').update({ ac_deal_id: deal.id }).eq('id', preExisting.id);
          if (error) throw new Error(error.message);
          linked++;
          continue;
        }

        const { error } = await supabaseAdmin.from('crm_projects').insert({
          ...mapped,
          ac_deal_id: deal.id,
          current_module: 'operations',
          sales_stage: 'completado',
          engineering_stage: 'completado',
          operations_stage: initialOperationsStage(deal.status, deal.stage),
          created_by: 'import-activecampaign',
          assigned_to: 'import-activecampaign',
        });
        if (error) throw new Error(error.message);
        imported++;
      } catch (e) {
        errors.push({ deal_id: deal.id, error: e instanceof Error ? e.message : 'Error' });
      }
    }

    await supabaseAdmin.from('cron_runs').insert({
      trigger: isInternalUI ? 'manual' : 'cron',
      status: errors.length > 0 && imported === 0 && linked === 0 ? 'error' : 'ok',
      steps: { source: 'import-activecampaign', deals_found: deals.length, imported, linked, skipped, errors },
      error_message: errors.length > 0 ? `${errors.length} deal(s) fallaron` : null,
    });

    return NextResponse.json({
      ok: true,
      deals_found: deals.length,
      imported,
      linked_to_existing: linked,
      skipped,
      errors,
      elapsed_ms: Date.now() - startTs,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
