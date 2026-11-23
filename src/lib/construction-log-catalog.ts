/**
 * Listas de opciones de la Bitácora de Construcción. Viven aparte del
 * componente (ConstructionLog.tsx) para que también las entregue
 * GET /api/visits/catalog a la app móvil — una sola fuente para web y app.
 *
 * Sin imports: scripts/export-visit-catalog.mjs carga este archivo directo
 * con Node, igual que visit-schemas.ts.
 */
export const ETAPAS = [
  'Alistamiento de sitio', 'Cimentación / anclajes', 'Estructura de montaje', 'Instalación de paneles',
  'Cableado DC', 'Cableado AC', 'Tablero SSFV / inversor', 'Puesta en marcha', 'Ajustes / retrabajo',
  'Retraso — clima', 'Retraso — material', 'Retraso — otro', 'Otro',
];
export const CLIMAS = ['Soleado', 'Parcialmente nublado', 'Nublado', 'Lluvia', 'Lluvia fuerte / tormenta'];
export const PHOTO_CATEGORIES = ['Avance general', 'Estructura', 'Paneles', 'Cableado', 'Tablero / Inversor', 'Incidencia', 'Otro'];
