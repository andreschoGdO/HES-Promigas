import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loginToMetrum, getDevices } from '@/lib/metrum-api';

interface ThingsBoardEntity {
  entityId?: { id?: string; entityType?: string };
  latest?: {
    ENTITY_FIELD?: Record<string, { value?: string }>;
    ATTRIBUTE?: Record<string, { value?: string }>;
  };
}

// Inversores Livoltek viejos reemplazados por DEYE + medidor solar duplicado.
// Estas entidades siguen existiendo en Metrum pero no representan equipo activo.
// NOTA: HP310K2HWC290023 fue movido a Casa 102p (originalmente Casa 76) y vuelve
// a estar activo — removido de la lista negra → suma 1 inversor (29º total).
const EXCLUDED_METRUM_IDS = new Set<string>([
  '97b87d30-bbf4-11f0-8b36-d3bdd5e2064a', // HP315K2HWC290041 — Casa 10 (Livoltek viejo)
  'fee67980-d83c-11f0-8b36-d3bdd5e2064a', // HP315K2HWC290038 — Casa 74 (Livoltek viejo)
  'bb97f160-e0cd-11f0-8b36-d3bdd5e2064a', // HP315K2HWC290042 — Casa 99 (Livoltek viejo)
  'd48d9bf0-bbf4-11f0-8b36-d3bdd5e2064a', // 2223005638 — Casa 10 (medidor solar duplicado)
]);

/**
 * GET /api/devices/sync
 * Fetches the list of devices from Metrum and upserts them into Supabase.
 */
export async function GET() {
  try {
    const token = await loginToMetrum();
    const response = await getDevices(token);

    const entities: ThingsBoardEntity[] = (Array.isArray(response)
      ? response
      : Array.isArray(response?.data)
        ? response.data
        : []) as ThingsBoardEntity[];

    const pick = (e: ThingsBoardEntity, keys: string[]): string | null => {
      const attrs = e.latest?.ATTRIBUTE ?? {};
      const efs = e.latest?.ENTITY_FIELD ?? {};
      for (const k of keys) {
        const v = attrs[k]?.value ?? efs[k]?.value;
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
      return null;
    };

    // Inversores Livoltek: HP*
    // Inversores DEYE: serie numérica que empieza con 24 o 25 (año de fabricación)
    // (Medidores Eastron también son numéricos pero empiezan con 2223 → distinguir)
    const nameMatchesInverter = (n: string) =>
      /^HP/i.test(n) || /^(24|25)\d{8}$/.test(n);

    const formatted = entities
      .map((e) => {
        const metrumId = e.entityId?.id;
        if (!metrumId) return null;
        if (EXCLUDED_METRUM_IDS.has(metrumId)) return null;
        const name = pick(e, ['name', 'label']) ?? 'Unnamed';

        // Tipo: priorizar mettype (atributo real), luego type entityField
        // Para inversores que no tienen mettype: usar 'inverter' si patrón de nombre coincide
        // Si nada matchea, cae a 'pulsar' (modem/gateway) — es lo más probable según el inventario
        // del piloto: todo lo que no es inversor ni medidor termina siendo gateway.
        let type = pick(e, ['mettype', 'type', 'deviceType', 'tipo']);
        if (!type || type === 'unknown') {
          if (/^IN\d+/i.test(name)) type = 'pulsar';
          else if (nameMatchesInverter(name)) type = 'inverter';
          else type = 'pulsar';
        }

        // Casa/cliente: el atributo real es `spcus` ("Casa 2", "Casa 23p")
        const casa = pick(e, ['spcus', 'casa', 'client', 'cliente']);
        const client = casa;
        // El gateway padre (IN42420370) actúa como cliente_id lógico para agrupar
        const parentGateway = pick(e, ['gateway', 'spgwserie']);
        const clienteId =
          pick(e, ['customerId', 'customer_id', 'cliente_id', 'clienteId', 'casa_id', 'casaId']) ??
          parentGateway;

        const location = pick(e, ['zone', 'zona', 'location', 'ubicacion']);
        const city = pick(e, ['city', 'ciudad']);

        const activeRaw = pick(e, ['active']);
        const isActive = activeRaw === null ? null : /^true$/i.test(activeRaw);

        // Inversores Livoltek (HP*): invbrand, invmodel, invcap
        // Inversores DEYE (numéricos): no tienen invbrand → inferir por patrón
        let marca = pick(e, ['invbrand', 'marca', 'brand']);
        if (!marca && nameMatchesInverter(name)) {
          if (/^HP/i.test(name)) marca = 'LIVOLTEK';
          else if (/^\d{8,}$/.test(name)) marca = 'DEYE';
        }
        const modelo = pick(e, ['invmodel', 'modelo', 'model']);
        const potRaw = pick(e, ['invcap', 'potencia_kw', 'potencia', 'power', 'powerKw']);
        const potencia = potRaw !== null && Number.isFinite(Number(potRaw)) ? Number(potRaw) : null;

        // Capturar TODAS las flags de alarma + estado del inversor (Livoltek y DEYE).
        // Se guardan como JSONB en devices.alarm_flags para que el evaluador las consulte.
        const FLAG_KEYS = [
          'flagFSVER', 'flagFSCER', 'flagFBVER',
          'flagFFT', 'flagETA',
          'flagFFDC',
          'flagFEM', 'flagFFB', 'flagFFCT', 'flagFAFER',
          'flagEMayor', 'flagEMenor', 'flagEAM', 'flagECEO', 'flagEPSR', 'flagESSI',
          'UIcolorRojo', 'UIcolorAmarillo', 'UIcolorNaranja',
        ];
        const alarmFlags: Record<string, number | string | null> = {};
        for (const k of FLAG_KEYS) {
          const v = pick(e, [k]);
          if (v === null) continue;
          const n = Number(v);
          alarmFlags[k] = Number.isFinite(n) ? n : v;
        }
        const tlInvState = pick(e, ['TLinvstate']);
        if (tlInvState !== null) {
          alarmFlags['TLinvstate'] = tlInvState.toLowerCase();
          alarmFlags['TLinvstate_off'] = tlInvState.toLowerCase() === 'off' ? 1 : 0;
        }
        const tlBattSoc = pick(e, ['TLBattSOC']);
        if (tlBattSoc !== null && Number.isFinite(Number(tlBattSoc))) {
          alarmFlags['TLBattSOC'] = Number(tlBattSoc);
        }

        return {
          metrum_id: metrumId,
          name,
          type: type.toLowerCase(),
          client,
          casa,
          cliente_id: clienteId,
          location,
          city,
          is_active: isActive,
          marca,
          modelo,
          potencia_kw: potencia,
          alarm_flags: alarmFlags,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    // Cuántas entidades trajo Metrum (incluyendo las excluidas y las que no son devices válidos)
    const metrumTotal = entities.length;
    const excludedCount = entities.filter((e) => e.entityId?.id && EXCLUDED_METRUM_IDS.has(e.entityId.id)).length;

    if (formatted.length === 0) {
      return NextResponse.json({
        success: true,
        inserted: 0,
        metrum_total: metrumTotal,
        excluded: excludedCount,
        warning: 'Metrum no devolvió dispositivos (después de filtros). Verifica credenciales o que existan entidades.',
      });
    }

    const { error, data: upserted } = await supabaseAdmin
      .from('devices')
      .upsert(formatted, { onConflict: 'metrum_id' })
      .select('id');
    if (error) throw error;

    return NextResponse.json({
      success: true,
      inserted: formatted.length,
      metrum_total: metrumTotal,
      excluded: excludedCount,
      upserted: upserted?.length ?? formatted.length,
    });
  } catch (err) {
    console.error('Device sync error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
