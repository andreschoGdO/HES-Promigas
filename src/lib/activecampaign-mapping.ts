import type { AcContact, AcDealCustomFieldDatum, AcUser } from './activecampaign';

/**
 * IDs de custom field de deals en ActiveCampaign (cuenta sunnypromigas,
 * pipeline "Ventas"). Verificados en vivo el 2026-07-21 — si alguien
 * renombra o borra un campo en ActiveCampaign, esto hay que revisarlo.
 * Ver docs/superpowers/specs/2026-07-21-activecampaign-import-design.md
 */
export const AC_FIELD = {
  CASA_NUMERO: '2',
  DIRECCION: '11',
  CONJUNTO: '10',
  ESTRATO: '60',
  CIUDAD_COBERTURA: '61',
  PANELES_CANTIDAD: '91',
  PANEL_MARCA: '92',
  POTENCIA_KWP: '93',
  INVERSOR_MARCA: '96',
  INVERSOR_POTENCIA: '97',
  BATERIA_MARCA: '94',
  BATERIA_CANTIDAD: '79',
  BATERIA_CAPACIDAD_KWH: '95',
  CONSUMO_PROMEDIO_DIMENSIONADO: '167',
  YIELD_DIMENSIONAMIENTO: '163',
  RESPONSABLE_DIMENSIONAMIENTO: '164',
} as const;

/** Arma un lookup customFieldId → fieldValue (ya resuelto a texto plano, primer valor si es array). */
function buildFieldMap(data: AcDealCustomFieldDatum[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of data) {
    const v = Array.isArray(f.fieldValue) ? f.fieldValue[0] : f.fieldValue;
    // customFieldId viene como number en el JSON crudo de ActiveCampaign
    // aunque el tipo declarado sea string — normalizar antes de usar como key.
    if (v !== undefined && v !== null && v !== '') map.set(String(f.customFieldId), String(v));
  }
  return map;
}

const num = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface MappedProject {
  title: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_city: string | null;
  client_address: string | null;
  conjunto: string | null;
  casa_numero: string | null;
  estrato: number | null;
  diseno_paneles: number | null;
  diseno_kwp: number | null;
  diseno_inversor_marca: string | null;
  diseno_inversor_potencia_kw: number | null;
  diseno_bateria_marca: string | null;
  diseno_baterias_cantidad: number | null;
  diseno_bateria_capacidad_kwh: number | null;
  diseno_yield_estimado_kwh_mes: number | null;
  invoice_kwh_mensual: number | null;
  diseno_aprobado_por: string | null;
  diseno_notes: string;
}

/**
 * Combina deal + custom fields + contacto + owner en el shape que espera
 * POST /api/crm/projects. Ningún campo es bloqueante: si algo falta, queda
 * null y el proyecto se crea igual (se completa a mano después).
 */
export function mapDealToProject(
  dealTitle: string,
  customFieldData: AcDealCustomFieldDatum[],
  contact: AcContact | null,
  owner: AcUser | null,
): MappedProject {
  const f = buildFieldMap(customFieldData);

  const panelMarca = f.get(AC_FIELD.PANEL_MARCA);
  const panelCantidad = f.get(AC_FIELD.PANELES_CANTIDAD);
  const inversorMarca = f.get(AC_FIELD.INVERSOR_MARCA);
  const inversorPotencia = f.get(AC_FIELD.INVERSOR_POTENCIA);
  const bateriaMarca = f.get(AC_FIELD.BATERIA_MARCA);
  const bateriaCantidad = f.get(AC_FIELD.BATERIA_CANTIDAD);

  const notesParts: string[] = [];
  if (panelMarca) notesParts.push(`Paneles ${panelMarca}${panelCantidad ? ` (${panelCantidad})` : ''}`);
  if (inversorMarca) notesParts.push(`Inversor ${inversorMarca}${inversorPotencia ? ` (${inversorPotencia}kW)` : ''}`);
  if (bateriaMarca) notesParts.push(`Baterías ${bateriaMarca}${bateriaCantidad ? ` (${bateriaCantidad})` : ''}`);

  const ownerName = owner ? [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() : null;

  return {
    title: dealTitle,
    client_name: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || null : null,
    client_email: contact?.email || null,
    client_phone: contact?.phone || null,
    client_city: f.get(AC_FIELD.CIUDAD_COBERTURA) ?? null,
    client_address: f.get(AC_FIELD.DIRECCION) ?? null,
    conjunto: f.get(AC_FIELD.CONJUNTO) ?? null,
    casa_numero: f.get(AC_FIELD.CASA_NUMERO) ?? null,
    estrato: num(f.get(AC_FIELD.ESTRATO)),
    diseno_paneles: num(panelCantidad),
    diseno_kwp: num(f.get(AC_FIELD.POTENCIA_KWP)),
    diseno_inversor_marca: inversorMarca ?? null,
    diseno_inversor_potencia_kw: num(inversorPotencia),
    diseno_bateria_marca: bateriaMarca ?? null,
    diseno_baterias_cantidad: num(bateriaCantidad),
    diseno_bateria_capacidad_kwh: num(f.get(AC_FIELD.BATERIA_CAPACIDAD_KWH)),
    diseno_yield_estimado_kwh_mes: num(f.get(AC_FIELD.YIELD_DIMENSIONAMIENTO)),
    invoice_kwh_mensual: num(f.get(AC_FIELD.CONSUMO_PROMEDIO_DIMENSIONADO)),
    diseno_aprobado_por: f.get(AC_FIELD.RESPONSABLE_DIMENSIONAMIENTO) ?? ownerName,
    diseno_notes: notesParts.join(' · '),
  };
}
