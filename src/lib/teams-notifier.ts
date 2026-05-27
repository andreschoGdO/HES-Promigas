/**
 * Notificador de alertas a un canal de Microsoft Teams vía Incoming Webhook.
 *
 * Setup:
 * 1. En Teams, ve al canal donde quieres las alertas
 * 2. Click los "..." junto al nombre del canal → Workflows
 * 3. Busca y selecciona "Post to a channel when a webhook request is received"
 * 4. Sigue el wizard, copia la URL del webhook al final
 * 5. En Vercel → Settings → Environment Variables agrega:
 *      TEAMS_WEBHOOK_URL = <la URL pegada>
 *    (también en .env.local para desarrollo)
 * 6. Redeploy
 *
 * Si TEAMS_WEBHOOK_URL no está configurada, las llamadas son no-op silencioso —
 * el evaluador de alertas no falla por esto.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sunnyhes.vercel.app';

export interface AlertNotification {
  rule_name: string;
  casa: string;
  severity: 'high' | 'medium' | 'low';
  variable: string;
  value: number;
  threshold: number;
  operator: string;
  message?: string;
  record_date: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  high:   'attention',   // rojo en adaptive cards
  medium: 'warning',     // ámbar
  low:    'good',        // verde
};

const SEVERITY_EMOJI: Record<string, string> = {
  high:   '🔴',
  medium: '🟠',
  low:    '🟡',
};

const buildAdaptiveCard = (alerts: AlertNotification[]) => {
  const cardTitle = alerts.length === 1
    ? `Alerta nueva: ${alerts[0].rule_name}`
    : `${alerts.length} alertas nuevas en SUNNY APP`;

  const highCount = alerts.filter((a) => a.severity === 'high').length;
  const subtitle = highCount > 0
    ? `${highCount} de severidad alta · ${alerts.length} en total`
    : `${alerts.length} eventos en total`;

  const factSets = alerts.slice(0, 10).map((a) => ({
    type: 'FactSet',
    spacing: 'Small',
    separator: true,
    facts: [
      { title: `${SEVERITY_EMOJI[a.severity]} ${a.casa}`, value: a.rule_name },
      { title: 'Detalle', value: `${a.variable} = ${Number(a.value).toFixed(2)} ${a.operator} ${a.threshold}` },
      { title: 'Fecha', value: a.record_date },
    ],
  }));

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            size: 'Large',
            weight: 'Bolder',
            text: cardTitle,
            color: SEVERITY_COLOR[alerts[0]?.severity ?? 'medium'],
          },
          {
            type: 'TextBlock',
            spacing: 'None',
            isSubtle: true,
            text: subtitle,
            wrap: true,
          },
          ...factSets,
          ...(alerts.length > 10 ? [{
            type: 'TextBlock',
            isSubtle: true,
            text: `… y ${alerts.length - 10} más. Abre el dashboard para ver todos.`,
            wrap: true,
            spacing: 'Medium',
          }] : []),
        ],
        actions: [
          { type: 'Action.OpenUrl', title: 'Ver en SUNNY APP', url: `${APP_URL}/dashboard` },
          { type: 'Action.OpenUrl', title: 'Configurar reglas', url: `${APP_URL}/alertas` },
        ],
      },
    }],
  };
};

/**
 * Envía un batch de alertas al canal de Teams. Silencioso si no hay webhook configurado.
 * No relanza errores — el caller no debe fallar si Teams está caído.
 */
export async function notifyTeams(alerts: AlertNotification[]): Promise<void> {
  if (alerts.length === 0) return;
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    console.log('[teams-notifier] TEAMS_WEBHOOK_URL no configurada, omitiendo notificación de', alerts.length, 'alertas');
    return;
  }
  try {
    const payload = buildAdaptiveCard(alerts);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[teams-notifier] webhook respondió', r.status, body.slice(0, 200));
    }
  } catch (e) {
    console.error('[teams-notifier] error al notificar:', e instanceof Error ? e.message : e);
  }
}
