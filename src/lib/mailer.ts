import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Transporter SMTP — single-process cache. La primera llamada lo crea con las
 * env vars y las siguientes lo reusan (Node.js conserva el módulo entre
 * invocaciones de la misma Function en Vercel).
 *
 * Env vars requeridas:
 *   SMTP_HOST  — ej. smtp.office365.com
 *   SMTP_PORT  — ej. 587
 *   SMTP_USER  — usuario completo (ej. notificaciones@gdo.com.co)
 *   SMTP_PASS  — password o app password
 *   SMTP_FROM  — opcional: "Nombre <email@dominio>" (default = SMTP_USER)
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null; // no configurado, no-op
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = TLS implícito; 587 = STARTTLS
    auth: { user, pass },
    // Office365: requiere STARTTLS en 587. La opción por defecto de nodemailer
    // (requireTLS si secure=false) ya cubre esto.
    requireTLS: port === 587,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(msg: MailMessage): Promise<{ ok: boolean; reason?: string }> {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'SMTP no configurado (faltan env vars SMTP_HOST/USER/PASS)' };
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
  try {
    await t.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? msg.html.replace(/<[^>]+>/g, ''),
    });
    return { ok: true };
  } catch (err) {
    console.error('sendEmail error', err);
    return { ok: false, reason: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

/** Detecta si una cadena parece email (validación liviana, lo suficientemente buena para gating) */
export function looksLikeEmail(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
