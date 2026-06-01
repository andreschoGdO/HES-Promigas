import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mailer';

/**
 * GET /api/_debug/test-email?to=email@dominio
 * Envía un email de prueba al destinatario indicado. Devuelve toda la
 * info del transport (messageId, accepted, rejected, response) para
 * diagnosticar problemas SMTP rápido.
 *
 * También devuelve el estado de las env vars (sin exponer el password).
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
    subject: '✅ Test SMTP — SUNNY APP',
    html: `<p>Este es un correo de prueba enviado desde el endpoint de diagnóstico.</p>
           <p>Si lo recibes, el SMTP de Office 365 funciona correctamente.</p>
           <p style="color:#94a3b8;font-size:12px">Timestamp: ${new Date().toISOString()}</p>`,
    text: 'Test SMTP - SUNNY APP. Si recibes este correo, el SMTP funciona.',
  });

  return NextResponse.json({
    result,
    env: envStatus(),
    sentAt: new Date().toISOString(),
  });
}

function envStatus() {
  return {
    SMTP_HOST: process.env.SMTP_HOST ?? null,
    SMTP_PORT: process.env.SMTP_PORT ?? null,
    SMTP_USER: process.env.SMTP_USER ?? null,
    SMTP_PASS_set: !!process.env.SMTP_PASS,
    SMTP_PASS_length: process.env.SMTP_PASS?.length ?? 0,
    SMTP_FROM: process.env.SMTP_FROM ?? null,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
  };
}
