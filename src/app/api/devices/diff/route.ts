import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getDevices } from '@/lib/metrum-api';

/**
 * GET /api/devices/diff
 *
 * Compara lo que Metrum devuelve hoy contra lo que tenemos en la tabla
 * devices. Útil para diagnosticar cuando hay equipos nuevos en Metrum
 * que no se están sincronizando.
 *
 * Devuelve:
 *   {
 *     metrum_total: número de entidades que devuelve Metrum (todas las páginas)
 *     metrum_filtered: cuántas pasaron el filtro de exclusión
 *     db_total: cuántas hay en la tabla devices
 *     in_metrum_not_in_db: equipos en Metrum pero NO en BD (los que falta sincronizar)
 *     in_db_not_in_metrum: equipos en BD pero ya no en Metrum (huérfanos, posiblemente borrados)
 *   }
 */
export async function GET() {
  try {
    const token = await loginToMetrum();
    const response = await getDevices(token);

    interface Entity { entityId?: { id?: string }; latest?: { ENTITY_FIELD?: Record<string, { value?: string }>; ATTRIBUTE?: Record<string, { value?: string }> } }
    const entities: Entity[] = (Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : []) as Entity[];

    const metrumIds = entities
      .map((e) => e.entityId?.id)
      .filter((id): id is string => Boolean(id));
    const metrumMap = new Map<string, { id: string; name: string; type: string | null; casa: string | null }>();
    for (const e of entities) {
      const id = e.entityId?.id;
      if (!id) continue;
      const ef = e.latest?.ENTITY_FIELD ?? {};
      const at = e.latest?.ATTRIBUTE ?? {};
      const name = ef.name?.value ?? at.label?.value ?? '(sin nombre)';
      const type = at.mettype?.value ?? ef.type?.value ?? null;
      const casa = at.spcus?.value ?? null;
      metrumMap.set(id, { id, name, type, casa });
    }

    const { data: dbDevices } = await supabaseAdmin
      .from('devices')
      .select('id, metrum_id, name, type, casa');
    const dbMap = new Map((dbDevices ?? []).map((d) => [d.metrum_id, d]));

    const inMetrumNotInDb: Array<{ id: string; name: string; type: string | null; casa: string | null }> = [];
    for (const [id, meta] of metrumMap) {
      if (!dbMap.has(id)) inMetrumNotInDb.push(meta);
    }

    const inDbNotInMetrum: Array<{ metrum_id: string; name: string; type: string; casa: string | null }> = [];
    for (const d of dbDevices ?? []) {
      if (!metrumMap.has(d.metrum_id)) inDbNotInMetrum.push(d);
    }

    return NextResponse.json({
      metrum_total: entities.length,
      metrum_unique_ids: metrumIds.length,
      db_total: dbDevices?.length ?? 0,
      in_metrum_not_in_db: inMetrumNotInDb,
      in_db_not_in_metrum: inDbNotInMetrum,
      fetch_metadata: typeof response === 'object' && response !== null && !Array.isArray(response)
        ? { totalElements: (response as { totalElements?: number }).totalElements, fetchedCount: (response as { fetchedCount?: number }).fetchedCount }
        : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
