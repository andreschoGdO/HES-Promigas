import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createSupabaseServer } from '@/lib/supabase-server';
import { canAccess, registerPending } from '@/lib/user-allowlist';
import { getRoleFromEmail } from '@/lib/user-role';
import { resolveRequestUser, type RequestUser } from '@/lib/api-auth-core';

export type { RequestUser } from '@/lib/api-auth-core';
export { restrictedEmail, isUuid, isStale } from '@/lib/api-auth-core';

/**
 * Identifica al usuario de una petición a /api: token de la app móvil
 * (`Authorization: Bearer <access_token de Supabase>`) o cookie de sesión
 * de la web. Sin sesión responde 401; contratista no habilitado, 403.
 *
 * El middleware NO intercepta /api/*, así que cada ruta de Visitas y
 * Bitácora debe llamar esto al entrar — antes de este módulo esas rutas
 * respondían también sin sesión.
 *
 * Uso:
 *   const auth = await requireUser(request);
 *   if ('response' in auth) return auth.response;
 *   const { user } = auth;   // null solo con DISABLE_AUTH=1 y sin sesión
 */
export async function requireUser(
  request: Request,
): Promise<{ user: RequestUser | null } | { response: NextResponse }> {
  const result = await resolveRequestUser(request.headers.get('authorization'), {
    getEmailFromBearer: async (token) => {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      return error ? null : data.user?.email ?? null;
    },
    getEmailFromCookies: async () => {
      try {
        const supa = await createSupabaseServer();
        const { data } = await supa.auth.getUser();
        return data.user?.email ?? null;
      } catch {
        return null;
      }
    },
    canAccess,
    registerPending,
    getRole: getRoleFromEmail,
    authDisabled: process.env.DISABLE_AUTH === '1',
  });
  if (!result.ok) return { response: NextResponse.json(result.body, { status: result.status }) };
  return { user: result.user };
}
