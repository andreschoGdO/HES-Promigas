/**
 * Núcleo puro de autenticación para las rutas /api de Visitas y Bitácora.
 *
 * Sin imports en tiempo de ejecución (solo tipos): recibe todas sus
 * dependencias por parámetro, así se prueba con el ejecutor integrado de
 * Node sin levantar Next ni Supabase (ver api-auth-core.test.mjs). El
 * envoltorio real —que conecta esto con Supabase y las cookies— vive en
 * api-auth.ts.
 */
import type { UserRole } from './user-role';

export interface RequestUser {
  email: string;
  role: UserRole;
}

export interface AuthDeps {
  /** Valida un access token de Supabase (app móvil). null si no es válido. */
  getEmailFromBearer(token: string): Promise<string | null>;
  /** Sesión web por cookie. null si no hay sesión. */
  getEmailFromCookies(): Promise<string | null>;
  canAccess(email: string): Promise<{ ok: boolean; reason?: 'pending' | 'disabled' | 'not_listed' }>;
  registerPending(email: string): Promise<void>;
  getRole(email: string): UserRole;
  /** DISABLE_AUTH=1 — solo desarrollo: sin sesión se deja pasar con user null. */
  authDisabled: boolean;
}

export type AuthResult =
  | { ok: true; user: RequestUser | null }
  | { ok: false; status: 401 | 403; body: { error: string; reason?: 'pending' | 'disabled' } };

export async function resolveRequestUser(authorization: string | null, deps: AuthDeps): Promise<AuthResult> {
  const unauthenticated: AuthResult = { ok: false, status: 401, body: { error: 'No autenticado' } };

  let email: string | null;
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    // Un token presentado y rechazado nunca cae a la cookie ni a authDisabled.
    email = await deps.getEmailFromBearer(bearer);
    if (!email) return unauthenticated;
  } else {
    email = await deps.getEmailFromCookies();
    if (!email) return deps.authDisabled ? { ok: true, user: null } : unauthenticated;
  }

  const normalized = email.toLowerCase().trim();
  const role = deps.getRole(normalized);

  // Mismo criterio que el middleware de páginas: solo el rol 'user'
  // (contratista) pasa por la allowlist; admin y operativo entran por regla.
  if (role === 'user') {
    const access = await deps.canAccess(normalized);
    if (!access.ok) {
      if (access.reason === 'not_listed') await deps.registerPending(normalized);
      const disabled = access.reason === 'disabled';
      return {
        ok: false,
        status: 403,
        body: {
          error: disabled ? 'Tu cuenta está deshabilitada.' : 'Tu cuenta está pendiente de aprobación.',
          reason: disabled ? 'disabled' : 'pending',
        },
      };
    }
  }
  return { ok: true, user: { email: normalized, role } };
}

/** Correo al que hay que limitar los datos (rol 'user'), o null si ve todo. */
export function restrictedEmail(user: RequestUser | null): string | null {
  return user?.role === 'user' ? user.email : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida los ids que genera la app móvil antes de usarlos en consultas o rutas de Storage. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * true si el cliente editó sobre una versión distinta a la del servidor.
 * Compara instantes, no cadenas: Postgres devuelve "+00:00" y JS "Z".
 * Sin `baseUpdatedAt` (la web no lo envía) nunca hay conflicto.
 */
export function isStale(baseUpdatedAt: unknown, currentUpdatedAt: string | null | undefined): boolean {
  if (typeof baseUpdatedAt !== 'string' || baseUpdatedAt === '') return false;
  if (!currentUpdatedAt) return false;
  const base = Date.parse(baseUpdatedAt);
  if (Number.isNaN(base)) return true;
  return base !== Date.parse(currentUpdatedAt);
}
