/**
 * Cliente delgado para la API REST clásica v3 de ActiveCampaign (cuenta
 * "sunnypromigas" — CRM de ventas, alias TopLeads).
 *
 * Auth: header `Api-Token` (no OAuth) contra `ACTIVECAMPAIGN_API_URL`.
 * Ver docs/superpowers/specs/2026-07-21-activecampaign-import-design.md
 */

const BASE_URL = process.env.ACTIVECAMPAIGN_API_URL;
const API_TOKEN = process.env.ACTIVECAMPAIGN_API_TOKEN;

function assertConfigured() {
  if (!BASE_URL || !API_TOKEN) {
    throw new Error('ActiveCampaign no configurado: falta ACTIVECAMPAIGN_API_URL o ACTIVECAMPAIGN_API_TOKEN');
  }
}

async function acFetch<T>(path: string): Promise<T> {
  assertConfigured();
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Api-Token': API_TOKEN! },
    cache: 'no-store',
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`ActiveCampaign ${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json() as Promise<T>;
}

export interface AcDeal {
  id: string;
  title: string;
  contact: string;
  owner: string;
  group: string;
  stage: string;
  cdate: string;
}

/** Lista todos los deals en una etapa dada, paginando de a 100. */
export async function listDealsByStage(stageId: string): Promise<AcDeal[]> {
  const out: AcDeal[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const j = await acFetch<{ deals: AcDeal[]; meta: { total: string } }>(
      `/api/3/deals?filters[stage]=${stageId}&limit=${limit}&offset=${offset}`,
    );
    out.push(...j.deals);
    offset += limit;
    if (offset >= Number(j.meta.total) || j.deals.length === 0) break;
  }
  return out;
}

export interface AcDealCustomFieldDatum {
  /** Viene como number en el JSON crudo pese a lo que sugiera el nombre del campo. */
  customFieldId: string | number;
  /** string para text/number/radio/dropdown; string[] para multiselect. */
  fieldValue: string | string[];
}

export async function getDealCustomFieldData(dealId: string): Promise<AcDealCustomFieldDatum[]> {
  const j = await acFetch<{ dealCustomFieldData: AcDealCustomFieldDatum[] }>(
    `/api/3/deals/${dealId}/dealCustomFieldData`,
  );
  return j.dealCustomFieldData;
}

export interface AcContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export async function getContact(contactId: string): Promise<AcContact | null> {
  try {
    const j = await acFetch<{ contact: AcContact }>(`/api/3/contacts/${contactId}`);
    return j.contact;
  } catch {
    return null;
  }
}

export interface AcUser {
  id: string;
  firstName: string;
  lastName: string;
}

export async function getUser(userId: string): Promise<AcUser | null> {
  try {
    const j = await acFetch<{ user: AcUser }>(`/api/3/users/${userId}`);
    return j.user;
  } catch {
    return null;
  }
}

/**
 * A diferencia de otros CRMs, `dealCustomFieldData.fieldValue` para campos
 * radio/dropdown/multiselect en ActiveCampaign viene como el LABEL literal
 * (ej. "LIVOLTEK"), no como un id — multiselect viene como array de labels
 * (ej. ["LIVOLTEK"]), el resto como string plano. Verificado contra un deal
 * real; no hace falta resolver contra ningún catálogo de opciones aparte.
 */
