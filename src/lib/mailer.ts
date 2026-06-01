import { Resend } from 'resend';

/**
 * Cliente Resend cacheado en el proceso. Resend es un servicio HTTPS REST,
 * no requiere SMTP AUTH del tenant ni firewalls custom — solo una API key
 * y un dominio verificado.
 *
 * Env vars requeridas:
 *   RESEND_API_KEY  — API key generada en resend.com/api-keys
 *   EMAIL_FROM      — "Nombre <noreply@tudominio.com>" — el dominio
 *                     (tudominio.com) DEBE estar verificado en resend.com/domains.
 *                     Si no está verificado, Resend rechaza con error 422.
 *                     Para pruebas iniciales puedes usar
 *                     "onboarding@resend.dev" pero SOLO se envía al email
 *                     dueño de la cuenta Resend (sandbox).
 */
let client: Resend | null = null;

function getClient(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(msg: MailMessage): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
  const c = getClient();
  if (!c) {
    const missing: string[] = [];
    if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM');
    return { ok: false, reason: `Resend no configurado (faltan: ${missing.join(', ') || 'desconocido'})` };
  }
  const from = process.env.EMAIL_FROM;
  if (!from) {
    return { ok: false, reason: 'EMAIL_FROM no está definido' };
  }
  console.log('[mailer] sendEmail →', msg.to, '| subject:', msg.subject, '| from:', from);
  try {
    const res = await c.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? msg.html.replace(/<[^>]+>/g, ''),
    });
    if (res.error) {
      console.error('[mailer] Resend error', res.error);
      return { ok: false, reason: `${res.error.name}: ${res.error.message}` };
    }
    console.log('[mailer] OK id=', res.data?.id);
    return { ok: true, messageId: res.data?.id };
  } catch (err) {
    console.error('[mailer] EXCEPTION', err);
    return { ok: false, reason: err instanceof Error ? `${err.name}: ${err.message}` : 'Error desconocido' };
  }
}

/** Detecta si una cadena parece email (validación liviana) */
export function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
