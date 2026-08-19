import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/dash/proyectos
 *
 * Registro completo de TODOS los proyectos (a diferencia de /api/dash/gantt,
 * que solo trae los que ya tienen cronograma cargado) — mismas columnas que
 * la hoja de seguimiento externa que se usó para sincronizar el CRM esta
 * sesión: Proyecto/Casa/Equipo Inversor/Tipo/Ciudad/Zona/Estado/Fecha
 * instalación/EPC seleccionado.
 */

interface Row {
  id: string; conjunto: string | null; casa_numero: string | null;
  diseno_inversor_marca: string | null; tipo_red: string | null;
  client_city: string | null; zona: string | null;
  operations_stage: string; current_module: string;
  operativo_at: string | null; installation_date: string | null;
  contractor_name: string | null;
}

/** Misma regla que /api/dash/gantt y /api/dash/report. */
function deriveZona(zona: string | null, city: string | null): string {
  if (zona) return zona;
  if (!city) return 'Sin zona';
  const c = city.trim().toLowerCase();
  if (['cali', 'jamundí', 'jamundi', 'yumbo', 'palmira', 'valle', 'buenaventura'].some((x) => c.includes(x))) return 'Valle';
  if (['barranquilla', 'soledad', 'malambo', 'puerto colombia', 'sabanagrande', 'galapa'].some((x) => c.includes(x))) return 'Costa';
  if (['cartagena', 'turbaco', 'arjona', 'magangué', 'magangue', 'bolívar', 'bolivar', 'sincelejo', 'monteria', 'montería'].some((x) => c.includes(x))) return 'Costa';
  return 'Sin zona';
}

const TIPO_RED_LABEL: Record<string, string> = { trifasica: 'Trifásico', bifasica: 'Bifásico', monofasica: 'Monofásico' };

function estadoLabel(p: Row): string {
  if (p.current_module === 'closed') return 'Cancelado';
  if (['operativo', 'documentacion', 'o_m', 'legalizacion', 'sin_renovacion'].includes(p.operations_stage)) return 'Instalado';
  if (['alistamiento', 'instalacion'].includes(p.operations_stage)) return 'En proceso';
  return 'Por instalar';
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('crm_projects')
    .select(`
      id, conjunto, casa_numero, diseno_inversor_marca, tipo_red, client_city, zona,
      operations_stage, current_module, operativo_at, installation_date, contractor_name
    `)
    .not('conjunto', 'is', null)
    .neq('conjunto', 'PRUEBA')
    .order('conjunto').order('casa_numero');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as Row[]).map((p) => ({
    id: p.id,
    proyecto: p.conjunto ?? '—',
    casa: p.casa_numero ?? '—',
    equipoInversor: p.diseno_inversor_marca ?? '—',
    tipo: p.tipo_red ? (TIPO_RED_LABEL[p.tipo_red] ?? p.tipo_red) : '—',
    ciudad: p.client_city ?? '—',
    zona: deriveZona(p.zona, p.client_city),
    estado: estadoLabel(p),
    fechaInstalacion: (p.operativo_at ?? p.installation_date)?.slice(0, 10) ?? null,
    epc: p.contractor_name ?? 'Nueva/Sin Asignar',
  }));

  return NextResponse.json({ rows });
}
