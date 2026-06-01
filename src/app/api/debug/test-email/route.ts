import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mailer';

/**
 * GET /api/debug/test-email?to=email@dominio
 * Envía un email de prueba al destinatario indicado. Devuelve toda la
 * info del envío (messageId, error) y el estado de las env vars
 * (sin exponer la API key) para diagnosticar problemas rápido.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = url.searchParams.get('to');
  if (!to) {
    return NextResponse.json({
      error: 'Falta query param ?to=email',
      env: envStatus(),
    }, { status: 400 });
  }

  const result = await sendEmail({
    to,
    subject: '✅ Test email — SUNNY APP',
    html: `<p>Este es un correo de prueba enviado desde el endpoint de diagnóstico.</p>
           <p>Si lo recibes, Resend está funcionando correctamente.</p>
           <p style="color:#94a3b8;font-size:12px">Timestamp: ${new Date().toISOString()}</p>`,
    text: 'Test email - SUNNY APP. Si recibes este correo, Resend funciona.',
  });

  return NextResponse.json({
    result,
    env: envStatus(),
    sentAt: new Date().toISOString(),
  });
}

function envStatus() {
  return {
    RESEND_API_KEY_set: !!process.env.RESEND_API_KEY,
    RESEND_API_KEY_length: process.env.RESEND_API_KEY?.length ?? 0,
    RESEND_API_KEY_prefix: process.env.RESEND_API_KEY?.slice(0, 6) ?? null,
    EMAIL_FROM: process.env.EMAIL_FROM ?? null,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
  };
}
