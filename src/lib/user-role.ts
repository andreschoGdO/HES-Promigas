/**
 * Determina el rol del usuario a partir de su email. Reglas:
 *
 *   - @gdo.com.co / @promigas.com / @promigas.com.co  → admin (ve TODO)
 *   - email en OPERATIVO_EMAILS                       → operativo (Construcción, Inventario, Visitas)
 *   - cualquier otro                                  → user (contratista — solo /visitas)
 *
 * Compartido entre middleware (server), layouts (server) y sidebar (cliente).
 */

export type UserRole = 'admin' | 'operativo' | 'user';

export const ADMIN_DOMAINS: ReadonlyArray<string> = [
  '@gdo.com.co',
  '@promigas.com',
  '@promigas.com.co',
];

/**
 * Correos con rol 'operativo': acceso a Construcción, Inventario y Visitas
 * pero NO a Dashboard, Dash, Reportes, Facturación, Planner, Usuarios,
 * Configuración API. Se comparan en lowercase.
 */
export const OPERATIVO_EMAILS: ReadonlyArray<string> = [
  'alejandro.murillo@surtigas.co',
  'esnaider.florian@surtigas.co',
];

export function getRoleFromEmail(email: string | null | undefined): UserRole {
  if (!email) return 'user';
  const lc = email.toLowerCase();
  if (ADMIN_DOMAINS.some((d) => lc.endsWith(d))) return 'admin';
  if (OPERATIVO_EMAILS.includes(lc)) return 'operativo';
  return 'user';
}

// ─── Rutas permitidas por rol ───
// /auth/* y /login son públicas (manejadas por PUBLIC_PATHS).
// /cuenta queda accesible para todos los roles (para cerrar sesión).

/** user (contratista) — solo visitas + cuenta. */
export const USER_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/visitas',
  '/cuenta',
];

/** operativo — Construcción + Inventario + Visitas + cuenta. */
export const OPERATIVO_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/operaciones',
  '/inventario',
  '/visitas',
  '/cuenta',
];

export function isPathAllowedForUser(pathname: string): boolean {
  return USER_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function isPathAllowedForOperativo(pathname: string): boolean {
  return OPERATIVO_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Chequeo genérico por rol — usar en middleware. */
export function isPathAllowedForRole(pathname: string, role: UserRole): boolean {
  if (role === 'admin') return true;
  if (role === 'operativo') return isPathAllowedForOperativo(pathname);
  return isPathAllowedForUser(pathname);
}
