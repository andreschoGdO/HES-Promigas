import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { restrictedEmail, type RequestUser } from '@/lib/api-auth-core';

/**
 * Reglas de dueño para el rol 'user' (contratista). Admin y operativo pasan
 * siempre. Devuelven null si el acceso está permitido, o la respuesta
 * 403/404 que la ruta debe devolver tal cual.
 */

/** Solo sus propias actas (field_visits.created_by = su correo). */
export async function checkVisitAccess(user: RequestUser | null, visitId: string): Promise<NextResponse | null> {
  const email = restrictedEmail(user);
  if (!email) return null;
  const { data } = await supabaseAdmin.from('field_visits').select('created_by').eq('id', visitId).maybeSingle();
  if (!data) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
  if ((data.created_by ?? '').toLowerCase() !== email) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
  }
  return null;
}

/** Solo las bitácoras que él abrió (construction_logs.opened_by = su correo). */
export async function checkLogAccess(user: RequestUser | null, logId: string): Promise<NextResponse | null> {
  const email = restrictedEmail(user);
  if (!email) return null;
  const { data } = await supabaseAdmin.from('construction_logs').select('opened_by').eq('id', logId).maybeSingle();
  if (!data) return NextResponse.json({ error: 'no encontrado' }, { status: 404 });
  if ((data.opened_by ?? '').toLowerCase() !== email) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 });
  }
  return null;
}
