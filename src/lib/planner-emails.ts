import { sendEmail, looksLikeEmail } from './mailer';

const URGENCY_LABEL: Record<string, string> = {
  low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica',
};
const URGENCY_COLOR: Record<string, string> = {
  low: '#3b82f6', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626',
};

interface TaskEmailPayload {
  title: string;
  description?: string | null;
  assignedTo: string;       // email del responsable
  urgency: string;
  dueDate?: string | null;
  startDate?: string | null;
  createdBy?: string | null;
  taskId: string;
}

/**
 * Envía notificación de asignación de tarea al responsable. Fire-and-forget
 * (devuelve la promesa pero no se debe await en el path crítico — si SMTP
 * falla no queremos romper el create de la tarea).
 */
export async function sendTaskAssignedEmail(task: TaskEmailPayload, appUrl: string): Promise<{ ok: boolean; reason?: string }> {
  if (!looksLikeEmail(task.assignedTo)) {
    return { ok: false, reason: 'assigned_to no es un email válido' };
  }

  const uColor = URGENCY_COLOR[task.urgency] ?? '#64748b';
  const uLabel = URGENCY_LABEL[task.urgency] ?? task.urgency;
  const dueLine = task.dueDate ? `<strong>Vencimiento:</strong> ${escapeHtml(task.dueDate)}` : '';
  const startLine = task.startDate ? `<strong>Inicio:</strong> ${escapeHtml(task.startDate)}` : '';
  const descBlock = task.description ? `<p style="margin: 12px 0; color: #475569; line-height: 1.5;">${escapeHtml(task.description)}</p>` : '';
  const fromLine = task.createdBy ? `<p style="margin-top: 16px; font-size: 12px; color: #94a3b8;">Creada por ${escapeHtml(task.createdBy)}</p>` : '';
  const link = `${appUrl.replace(/\/$/, '')}/planner`;

  const html = `<!doctype html>
<html><body style="margin: 0; padding: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f8fafc; padding: 24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background: white; border-radius: 12px; overflow: hidden; max-width: 560px;">
        <tr><td style="padding: 24px 28px; border-bottom: 4px solid ${uColor};">
          <p style="margin: 0 0 6px; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Nueva tarea asignada</p>
          <h1 style="margin: 0; font-size: 20px; color: #0f172a; line-height: 1.3;">${escapeHtml(task.title)}</h1>
        </td></tr>
        <tr><td style="padding: 20px 28px;">
          <p style="margin: 0 0 12px;">
            <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; background: ${uColor}20; color: ${uColor}; font-size: 13px; font-weight: 700;">Urgencia: ${uLabel}</span>
          </p>
          ${descBlock}
          <p style="margin: 8px 0; font-size: 14px; color: #334155; line-height: 1.6;">
            ${startLine}${startLine && dueLine ? '<br/>' : ''}${dueLine}
          </p>
          <p style="margin: 24px 0 8px;">
            <a href="${link}" style="display: inline-block; padding: 10px 18px; background: #07c5a8; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Ver en el Planner</a>
          </p>
          ${fromLine}
        </td></tr>
        <tr><td style="padding: 14px 28px; background: #f1f5f9; font-size: 11px; color: #94a3b8;">
          Este correo fue generado automáticamente por SUNNY APP. Si crees que es un error, responde con "STOP" o contacta a tu administrador.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    'Nueva tarea asignada en SUNNY APP',
    '',
    task.title,
    task.description ?? '',
    '',
    `Urgencia: ${uLabel}`,
    task.startDate ? `Inicio: ${task.startDate}` : '',
    task.dueDate ? `Vencimiento: ${task.dueDate}` : '',
    '',
    `Ver: ${link}`,
    task.createdBy ? `Creada por: ${task.createdBy}` : '',
  ].filter(Boolean).join('\n');

  return sendEmail({
    to: task.assignedTo,
    subject: `📋 Nueva tarea: ${task.title}`,
    html,
    text,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
