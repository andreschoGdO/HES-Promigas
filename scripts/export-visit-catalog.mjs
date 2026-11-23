// Exporta el catálogo de actas a JSON para incluirlo dentro del APK de
// Sunny Visitas (copia de arranque para el primer uso sin conexión). Misma
// forma que responde GET /api/visits/catalog, con `user: null`.
//
// Uso:  npm run export:visit-catalog -- <ruta/catalog.json>
//
// Requiere Node >= 22.18 (carga los .ts quitando tipos). Los dos módulos
// que importa no tienen imports propios, por eso se pueden cargar directo.
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  console.error('Uso: npm run export:visit-catalog -- <archivo.json>');
  process.exit(1);
}

const { VISIT_SCHEMAS } = await import('../src/lib/visit-schemas.ts');
const { ETAPAS, CLIMAS, PHOTO_CATEGORIES } = await import('../src/lib/construction-log-catalog.ts');

writeFileSync(out, JSON.stringify({
  user: null,
  schemas: VISIT_SCHEMAS,
  bitacora: { etapas: ETAPAS, climas: CLIMAS, photoCategories: PHOTO_CATEGORIES },
}, null, 2));

console.log(`Catálogo exportado: ${VISIT_SCHEMAS.length} actas → ${out}`);
