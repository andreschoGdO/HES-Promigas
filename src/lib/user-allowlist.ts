import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRoleFromEmail } from '@/lib/user-role';

/**
 * Allowlist de usuarios contratistas (rol 'user'). Los admins (gdo/promigas)
 * NO pasan por acá — su acceso es automático por dominio.
 *
 * Cuando un user nuevo intenta login:
 *   1. Supabase ya autenticó la cuenta (email/password)
 *   2. Middleware llama isUserAllowed(email)
 *   3. Si false: registerPending(email) + signOut + redirect a /login?error=pending
 *   4. El admin ve el pending en /usuarios y lo habilita con setEnabled(email, true)
 */

export interface AllowlistRow {
  id: string;
  email: string;
  enabled: boolean;
  note: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

/** True si el email está autorizado a entrar como user (rol 'user'). Los admins
 *  no se consultan acá — el caller decide saltarse este check si es admin. */
export async function isUserAllowed(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const { data } = await supabaseAdmin
    .from('user_allowlist')
    .select('enabled')
    .ilike('email', normalized)
    .maybeSingle();
  return !!data?.enabled;
}

/** Registra un email como "pending" (enabled=false) si no existía. Idempotente. */
export async function registerPending(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  // upsert con onConflict en lower(email) no funciona en supabase-js; usamos
  // un insert + ignorar conflicto vía catch (la columna es UNIQUE).
  const { error } = await supabaseAdmin
    .from('user_allowlist')
    .insert({ email: normalized, enabled: false });
  if (error && error.code !== '23505') { // 23505 = unique violation, ignorar
    console.error('registerPending error:', error.message);
  }
}

/** Lista todos los registros, los pending primero. */
export async function listAllowlist(): Promise<AllowlistRow[]> {
  const { data } = await supabaseAdmin
    .from('user_allowlist')
    .select('*')
    .order('enabled', { ascending: true })
    .order('created_at', { ascending: false });
  return (data ?? []) as AllowlistRow[];
}

/** Habilita o deshabilita una entrada. Devuelve la fila actualizada. */
export async function setEnabled(email: string, enabled: boolean, addedBy: string | null): Promise<AllowlistRow | null> {
  const normalized = email.toLowerCase().trim();
  const { data, error } = await supabaseAdmin
    .from('user_allowlist')
    .update({ enabled, added_by: addedBy, updated_at: new Date().toISOString() })
    .ilike('email', normalized)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AllowlistRow | null) ?? null;
}

/** Agrega manualmente un email a la allowlist (típicamente habilitándolo de una). */
export async function addToAllowlist(email: string, enabled: boolean, addedBy: string | null, note: string | null): Promise<AllowlistRow> {
  const normalized = email.toLowerCase().trim();
  // Si ya existe, actualizamos. Si no, insertamos.
  const existing = await supabaseAdmin
    .from('user_allowlist')
    .select('id')
    .ilike('email', normalized)
    .maybeSingle();
  if (existing.data) {
    const updated = await setEnabled(normalized, enabled, addedBy);
    if (!updated) throw new Error('No se pudo actualizar');
    return updated;
  }
  const { data, error } = await supabaseAdmin
    .from('user_allowlist')
    .insert({ email: normalized, enabled, added_by: addedBy, note })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as AllowlistRow;
}

/** Borra un email de la allowlist completamente. */
export async function removeFromAllowlist(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  await supabaseAdmin
    .from('user_allowlist')
    .delete()
    .ilike('email', normalized);
}

/** Check rápido para el middleware: dado un email, decide si pasa el filtro
 *  de allowlist (admin pasa siempre; user pasa solo si está enabled). */
export async function canAccess(email: string): Promise<{ ok: boolean; reason?: 'pending' | 'disabled' | 'not_listed' }> {
  if (!email) return { ok: false, reason: 'not_listed' };
  if (getRoleFromEmail(email) === 'admin') return { ok: true };
  // user: requiere allowlist
  const normalized = email.toLowerCase().trim();
  const { data } = await supabaseAdmin
    .from('user_allowlist')
    .select('enabled')
    .ilike('email', normalized)
    .maybeSingle();
  if (!data) return { ok: false, reason: 'not_listed' };
  if (!data.enabled) return { ok: false, reason: 'disabled' };
  return { ok: true };
}
