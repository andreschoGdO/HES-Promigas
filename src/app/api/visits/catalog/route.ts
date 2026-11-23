import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { VISIT_SCHEMAS } from '@/lib/visit-schemas';
import { ETAPAS, CLIMAS, PHOTO_CATEGORIES } from '@/lib/construction-log-catalog';

/**
 * GET /api/visits/catalog
 * Catálogo de actas (VISIT_SCHEMAS) + listas de la bitácora + usuario
 * actual con su rol. Lo consume la app móvil para dibujar los formularios
 * sin duplicar los esquemas: una acta nueva acá aparece en la app sin
 * publicar otro APK. Requiere sesión (cookie web o Bearer de la app).
 *
 * La copia que va dentro del APK para el primer uso sin conexión se genera
 * con `npm run export:visit-catalog` (misma forma, `user: null`).
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  return NextResponse.json({
    user: auth.user,
    schemas: VISIT_SCHEMAS,
    bitacora: { etapas: ETAPAS, climas: CLIMAS, photoCategories: PHOTO_CATEGORIES },
  });
}
