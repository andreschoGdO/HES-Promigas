import { NextResponse } from 'next/server';

/**
 * GET /api/inverter/config-status
 *
 * Reporta si las ENV necesarias para hablar con las APIs de fabricantes
 * están presentes en el servidor. Nunca expone los valores — solo un
 * booleano por variable — para poder mostrar el estado en la UI de
 * /gestion-equipos sin filtrar secretos al cliente.
 */
export async function GET() {
  return NextResponse.json({
    deye: {
      appId: Boolean(process.env.DEYE_APP_ID),
      appSecret: Boolean(process.env.DEYE_APP_SECRET),
      baseUrl: process.env.DEYE_BASE_URL ?? null,
    },
    livoltek: {
      apiKey: Boolean(process.env.LIVOLTEK_API_KEY),
    },
  });
}
