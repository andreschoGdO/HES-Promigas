'use client';

import { useEffect, useState, useMemo } from 'react';
import { Bell, Plus, Trash2, AlertTriangle, AlertCircle, Info, Power, Lightbulb, Sparkles, Settings2, Wrench, TrendingUp, Zap } from 'lucide-react';
import { ALERT_VARIABLES, ALERT_CATEGORIES, findVariableMeta, formatValue, type AlertCategory } from '@/lib/alert-variables';
import { ReactivaCREG } from '@/components/ReactivaCREG';

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  variable: string;
  operator: string;
  threshold: number;
  severity: 'high' | 'medium' | 'low';
  enabled: boolean;
  scope: string;
}

interface AlertEvent {
  id: string;
  rule_id: string;
  casa: string;
  record_date: string;
  variable: string;
  value: number;
  threshold: number;
  operator: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  fired_at: string;
  acknowledged: boolean;
  alert_rules: { name: string; description: string | null } | null;
}

interface TopAlertRow {
  rule_id: string;
  casa: string;
  rule_name: string;
  variable: string | null;
  severity: 'high' | 'medium' | 'low';
  count: number;
  last_fired_at: string;
  first_fired_at: string;
}

interface Recommendation {
  id: string;
  kind: 'tune_threshold' | 'site_visit' | 'creg_control' | 'enable_more' | 'review_disabled';
  title: string;
  body: string;
  severity: 'high' | 'medium' | 'low';
  ctaLabel?: string;
  ctaHref?: string;
  details?: string;
}

const OPERATORS = [
  { key: 'gt', label: 'mayor que (>)' },
  { key: 'gte', label: 'mayor o igual (≥)' },
  { key: 'lt', label: 'menor que (<)' },
  { key: 'lte', label: 'menor o igual (≤)' },
  { key: 'eq', label: 'igual a (=)' },
];
const opSymbol = (op: string) => ({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' }[op] ?? op);

const SEVERITIES: Array<{ key: 'high' | 'medium' | 'low'; label: string; color: string; icon: typeof AlertCircle }> = [
  { key: 'high', label: 'Alta', color: '#ef4444', icon: AlertCircle },
  { key: 'medium', label: 'Media', color: '#f59e0b', icon: AlertTriangle },
  { key: 'low', label: 'Baja', color: '#3b82f6', icon: Info },
];
const sevMeta = (s: string) => SEVERITIES.find((x) => x.key === s) ?? SEVERITIES[2];

type NarTab = 'notificaciones' | 'alertas' | 'recomendaciones' | 'reactiva' | 'reglas';

const NAR_META: Record<NarTab, { label: string; color: string; icon: typeof Bell; description: string }> = {
  notificaciones: {
    label: 'Notificaciones',
    color: '#3b82f6',
    icon: Info,
    description: 'Eventos de severidad baja. Información útil que no requiere acción inmediata, pero conviene mirar al revisar la operación.',
  },
  alertas: {
    label: 'Alertas',
    color: '#ef4444',
    icon: AlertCircle,
    description: 'Eventos de severidad media o alta. Requieren acción: revisar la casa, ajustar el sistema o contactar al cliente.',
  },
  recomendaciones: {
    label: 'Recomendaciones',
    color: '#10b981',
    icon: Lightbulb,
    description: 'Sugerencias inteligentes derivadas del patrón de eventos: ajustar umbrales, programar visitas, activar control de cos φ, habilitar reglas faltantes.',
  },
  reactiva: {
    label: 'Reactiva (CREG)',
    color: '#f59e0b',
    icon: Zap,
    description: 'Análisis mensual de reactiva vs activa según Resolución CREG 015-2018. Detecta casas en riesgo de penalización (cos φ < 0.9) y estima el costo COP.',
  },
  reglas: {
    label: 'Reglas',
    color: '#8b5cf6',
    icon: Settings2,
    description: 'Configuración de las reglas que el motor evalúa cada 15 min y cada día. Define qué se considera notificación, alerta o señal.',
  },
};

export default function NarPage() {
  const [tab, setTab] = useState<NarTab>('alertas');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [topAlerts, setTopAlerts] = useState<TopAlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [filterCategory, setFilterCategory] = useState<AlertCategory | 'all'>('all');

  const loadRules = async () => {
    const r = await fetch('/api/alerts/rules');
    const j = await r.json();
    setRules(j.rules ?? []);
  };
  const loadEvents = async () => {
    const r = await fetch('/api/alerts/events');
    const j = await r.json();
    setEvents(j.events ?? []);
  };
  const loadTop = async () => {
    const r = await fetch('/api/alerts/top?days=7&limit=100');
    const j = await r.json();
    setTopAlerts(j.items ?? []);
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([loadRules(), loadEvents(), loadTop()]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const toggleEnabled = async (rule: AlertRule) => {
    await fetch('/api/alerts/rules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
    });
    loadRules();
  };

  const deleteRule = async (rule: AlertRule) => {
    if (!confirm(`¿Eliminar la regla "${rule.name}"?`)) return;
    await fetch(`/api/alerts/rules?id=${rule.id}`, { method: 'DELETE' });
    loadRules();
  };

  const runEvaluate = async () => {
    setMsg(null);
    const r = await fetch('/api/alerts/evaluate');
    const j = await r.json();
    setMsg({ kind: r.ok ? 'success' : 'error', text: r.ok ? `Evaluadas ${j.evaluated} reglas · ${j.fired} eventos generados/actualizados` : (j.error ?? 'Error') });
    loadEvents(); loadTop();
  };

  // ── Filtrado por categoría (para events y rules)
  const filteredEvents = useMemo(() => {
    if (filterCategory === 'all') return events;
    return events.filter((e) => findVariableMeta(e.variable)?.category === filterCategory);
  }, [events, filterCategory]);

  const notiEvents = useMemo(() => filteredEvents.filter((e) => e.severity === 'low' && !e.acknowledged), [filteredEvents]);
  const alertEvents = useMemo(() => filteredEvents.filter((e) => (e.severity === 'high' || e.severity === 'medium') && !e.acknowledged), [filteredEvents]);
  const alertEventsHigh = useMemo(() => alertEvents.filter((e) => e.severity === 'high'), [alertEvents]);

  // ── Recomendaciones derivadas
  const recommendations = useMemo<Recommendation[]>(() => {
    const out: Recommendation[] = [];

    // 1. Reglas con muchos disparos → ajustar umbral o visitar
    const repeated = topAlerts.filter((t) => t.count >= 3);
    const groupedByCasa = new Map<string, TopAlertRow[]>();
    for (const r of repeated) {
      if (!groupedByCasa.has(r.casa)) groupedByCasa.set(r.casa, []);
      groupedByCasa.get(r.casa)!.push(r);
    }
    for (const [casa, list] of groupedByCasa.entries()) {
      const total = list.reduce((s, r) => s + r.count, 0);
      const topRule = list[0];
      const sev: 'high' | 'medium' | 'low' = list.some((r) => r.severity === 'high') ? 'high' : 'medium';
      out.push({
        id: `repeated-${casa}`,
        kind: total >= 10 ? 'site_visit' : 'tune_threshold',
        title: `${casa} — ${total} disparos en 7 días`,
        body: total >= 10
          ? `Recurrencia muy alta (${total} eventos). Recomendamos una visita técnica para validar en sitio. La regla más activa es «${topRule.rule_name}» (${topRule.count}× ${topRule.severity}).`
          : `Las reglas se están disparando con frecuencia (${total} eventos). Revisa si el umbral es realista o si hay un problema en sitio. Regla principal: «${topRule.rule_name}» (${topRule.count}×).`,
        severity: sev,
        ctaLabel: total >= 10 ? 'Crear visita en /visitas' : 'Editar reglas',
        ctaHref: total >= 10 ? '/visitas' : undefined,
        details: list.map((r) => `· ${r.rule_name} (${r.count}× ${r.severity})`).join('\n'),
      });
    }

    // 2. Reactiva CREG activa → sugerir control automático cos φ
    const reactiveActive = events.some((e) => {
      const cat = findVariableMeta(e.variable)?.category;
      return (cat === 'reactiva') && !e.acknowledged && (e.severity === 'high' || e.severity === 'medium');
    });
    if (reactiveActive) {
      out.push({
        id: 'reactiva-control',
        kind: 'creg_control',
        title: 'Casas con penalización CREG activa',
        body: 'Hay reglas de reactiva disparando. Considera enviar comando set_power_factor=0.95 a los inversores afectados para entrar en zona segura (cos φ ≥ 0.9 CREG 015-2018).',
        severity: 'high',
        ctaLabel: 'Ir a Control Manual',
        ctaHref: '/dashboard',
      });
    }

    // 3. Reglas desactivadas con eventos previos
    const disabledRules = rules.filter((r) => !r.enabled);
    if (disabledRules.length > 0) {
      out.push({
        id: 'disabled-rules',
        kind: 'review_disabled',
        title: `${disabledRules.length} regla${disabledRules.length === 1 ? '' : 's'} desactivada${disabledRules.length === 1 ? '' : 's'}`,
        body: `Hay reglas marcadas como inactivas que no se están evaluando. Si fue intencional (ruido excesivo), considera ajustar el umbral o el alcance en vez de desactivarlas — un valor mal medido sin alerta es invisible.`,
        severity: 'low',
        details: disabledRules.slice(0, 5).map((r) => `· ${r.name} (${r.variable})`).join('\n'),
      });
    }

    // 4. Variables sin reglas (cobertura)
    const variablesWithRules = new Set(rules.map((r) => r.variable));
    const criticalUncovered = ALERT_VARIABLES.filter((v) =>
      !variablesWithRules.has(v.key) && (
        v.key === 'gateway_offline_min' ||
        v.key === 'batt_soc_pct' ||
        v.key === 'cos_phi_now' ||
        v.key === 'desempeno_pct' ||
        v.key === 'alarm_TLinvstate_off' ||
        v.key === 'voltage_min_v' ||
        v.key === 'voltage_max_v'
      )
    );
    if (criticalUncovered.length > 0) {
      out.push({
        id: 'coverage-gap',
        kind: 'enable_more',
        title: `${criticalUncovered.length} variable${criticalUncovered.length === 1 ? '' : 's'} crítica${criticalUncovered.length === 1 ? '' : 's'} sin regla`,
        body: 'Estas variables son importantes para detectar fallas tempranas. Considera crear reglas para tener cobertura completa.',
        severity: 'medium',
        details: criticalUncovered.map((v) => `· ${v.label} (${v.key}) — ${v.description.slice(0, 80)}…`).join('\n'),
      });
    }

    // Ordenar: high → medium → low
    return out.sort((a, b) => {
      const ord = { high: 0, medium: 1, low: 2 };
      return ord[a.severity] - ord[b.severity];
    });
  }, [topAlerts, events, rules]);

  // ── Reglas agrupadas por categoría
  const rulesByCategory = useMemo(() => {
    const out = new Map<AlertCategory, AlertRule[]>();
    const otras: AlertRule[] = [];
    for (const r of rules) {
      if (filterCategory !== 'all') {
        const m = findVariableMeta(r.variable);
        if (m?.category !== filterCategory) continue;
      }
      const meta = findVariableMeta(r.variable);
      if (meta) {
        if (!out.has(meta.category)) out.set(meta.category, []);
        out.get(meta.category)!.push(r);
      } else {
        otras.push(r);
      }
    }
    return { out, otras };
  }, [rules, filterCategory]);

  const counts: Record<NarTab, number> = {
    notificaciones: events.filter((e) => e.severity === 'low' && !e.acknowledged).length,
    alertas: events.filter((e) => (e.severity === 'high' || e.severity === 'medium') && !e.acknowledged).length,
    recomendaciones: recommendations.length,
    reactiva: 0,
    reglas: rules.length,
  };

  return (
    <>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={22} style={{ color: 'var(--accent)' }} />
            <h1 style={{ margin: 0 }}>NAR — Centro de Notificaciones, Alertas y Recomendaciones</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
            Punto único para revisar lo que pasa en la flota: eventos informativos, alertas accionables y sugerencias proactivas derivadas del patrón de los últimos 7 días.
          </p>
        </div>
        <button className="primary-btn" onClick={runEvaluate}>
          <Bell size={14} /> Evaluar ahora
        </button>
      </div>

      {msg && <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ marginTop: 12 }}>{msg.text}</div>}

      {/* RESUMEN — cards top */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
        <SummaryCard
          color={NAR_META.alertas.color}
          icon={NAR_META.alertas.icon}
          label="Alertas accionables"
          value={counts.alertas}
          sublabel={`${alertEventsHigh.length} de severidad alta`}
          highlight={alertEventsHigh.length > 0}
        />
        <SummaryCard
          color={NAR_META.recomendaciones.color}
          icon={NAR_META.recomendaciones.icon}
          label="Recomendaciones"
          value={recommendations.length}
          sublabel={recommendations.filter((r) => r.severity === 'high').length > 0 ? `${recommendations.filter((r) => r.severity === 'high').length} prioritaria${recommendations.filter((r) => r.severity === 'high').length === 1 ? '' : 's'}` : 'al día'}
        />
        <SummaryCard
          color={NAR_META.notificaciones.color}
          icon={NAR_META.notificaciones.icon}
          label="Notificaciones"
          value={counts.notificaciones}
          sublabel="informativas (severidad baja)"
        />
        <SummaryCard
          color={NAR_META.reglas.color}
          icon={NAR_META.reglas.icon}
          label="Reglas activas"
          value={rules.filter((r) => r.enabled).length}
          sublabel={`${rules.length} en total`}
        />
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18, marginBottom: 6 }}>
        {(Object.keys(NAR_META) as NarTab[]).map((k) => {
          const m = NAR_META[k];
          const Icon = m.icon;
          return (
            <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? 'active' : ''}`}
              style={{ fontSize: '0.85rem', padding: '10px 14px', borderLeft: `4px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon size={14} /> {m.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>({counts[k]})</span>
            </button>
          );
        })}
      </div>

      {/* Strip de identidad del tab activo */}
      <div className="glass-panel" style={{ padding: 14, borderLeft: `4px solid ${NAR_META[tab].color}`, marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{NAR_META[tab].description}</p>
      </div>

      {/* Filtro de categoría (aplica a eventos y reglas) */}
      {tab !== 'recomendaciones' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          <button onClick={() => setFilterCategory('all')} className={`chip ${filterCategory === 'all' ? 'active' : ''}`}>
            Todas las categorías
          </button>
          {(Object.keys(ALERT_CATEGORIES) as AlertCategory[]).map((cat) => (
            <button key={cat} onClick={() => setFilterCategory(cat)} className={`chip ${filterCategory === cat ? 'active' : ''}`}>
              {ALERT_CATEGORIES[cat].icon} {ALERT_CATEGORIES[cat].label}
            </button>
          ))}
        </div>
      )}

      {/* CONTENIDO POR TAB */}
      {tab === 'notificaciones' && (
        <EventsList
          events={notiEvents}
          loading={loading}
          emptyText="No hay notificaciones pendientes. Las informativas (severidad baja) aparecerán aquí cuando se evalúen las reglas."
          onAck={loadEvents}
          kind="notificaciones"
        />
      )}

      {tab === 'alertas' && (
        <EventsList
          events={alertEvents}
          loading={loading}
          emptyText="✓ No hay alertas activas. El sistema está dentro de los umbrales configurados."
          onAck={loadEvents}
          kind="alertas"
        />
      )}

      {tab === 'recomendaciones' && (
        <RecommendationsList recos={recommendations} loading={loading} />
      )}

      {tab === 'reactiva' && <ReactivaCREG />}

      {tab === 'reglas' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button className="primary-btn" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Nueva regla
            </button>
          </div>

          {showAdd && <NewRuleForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); loadRules(); }} />}

          {loading ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
          ) : (
            <RulesByCategory grouped={rulesByCategory.out} otras={rulesByCategory.otras} toggleEnabled={toggleEnabled} deleteRule={deleteRule} />
          )}
        </>
      )}
    </>
  );
}

/* ─────────────── Summary cards ─────────────── */
function SummaryCard({ color, icon: Icon, label, value, sublabel, highlight }: {
  color: string; icon: typeof Bell; label: string; value: number; sublabel: string; highlight?: boolean;
}) {
  return (
    <div className="glass-panel" style={{ padding: '14px 16px', borderLeft: `4px solid ${color}`, background: highlight ? `${color}08` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        <Icon size={13} style={{ color }} /> {label}
      </div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: '1.7rem', fontWeight: 700, color: highlight ? color : 'var(--text-primary)' }}>{value}</span>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{sublabel}</span>
      </div>
    </div>
  );
}

/* ─────────────── Lista de eventos (Notificaciones / Alertas) ─────────────── */
function EventsList({ events, loading, emptyText, onAck, kind }: {
  events: AlertEvent[]; loading: boolean; emptyText: string; onAck: () => void;
  kind: 'notificaciones' | 'alertas';
}) {
  // Para alertas, agrupar por casa con casas críticas primero
  const grouped = useMemo(() => {
    const m = new Map<string, AlertEvent[]>();
    for (const ev of events) {
      if (!m.has(ev.casa)) m.set(ev.casa, []);
      m.get(ev.casa)!.push(ev);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const sa = a[1].filter((e) => e.severity === 'high').length;
      const sb = b[1].filter((e) => e.severity === 'high').length;
      if (sa !== sb) return sb - sa;
      return b[1].length - a[1].length;
    });
  }, [events]);

  if (loading) return <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;
  if (events.length === 0) {
    return <div className={kind === 'alertas' ? 'alert-success' : 'glass-panel'} style={{ fontSize: '0.86rem', padding: kind === 'alertas' ? undefined : 24, textAlign: kind === 'notificaciones' ? 'center' : undefined, color: kind === 'notificaciones' ? 'var(--text-muted)' : undefined }}>{emptyText}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {grouped.map(([casa, list]) => {
        const high = list.filter((e) => e.severity === 'high').length;
        const med = list.filter((e) => e.severity === 'medium').length;
        const low = list.filter((e) => e.severity === 'low').length;
        const topSev = high > 0 ? 'high' : med > 0 ? 'medium' : 'low';
        const sm = sevMeta(topSev);
        return (
          <div key={casa} className="glass-panel" style={{ padding: 0, borderLeft: `4px solid ${sm.color}` }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '0.98rem' }}>{casa}</h3>
              <div style={{ display: 'flex', gap: 6, fontSize: '0.74rem' }}>
                {high > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontWeight: 600 }}>{high} alto</span>}
                {med > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, background: '#f59e0b20', color: '#f59e0b', fontWeight: 600 }}>{med} medio</span>}
                {low > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, background: '#3b82f620', color: '#3b82f6', fontWeight: 600 }}>{low} bajo</span>}
              </div>
            </div>
            <div className="table-container" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th style={{ width: 110 }}>Fecha</th>
                    <th>Regla</th>
                    <th>Variable</th>
                    <th>Lectura</th>
                    <th>Umbral</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((ev) => {
                    const s = sevMeta(ev.severity);
                    const Icon = s.icon;
                    const meta = findVariableMeta(ev.variable);
                    const catMeta = meta ? ALERT_CATEGORIES[meta.category] : null;
                    return (
                      <tr key={ev.id} style={{ borderLeft: `3px solid ${s.color}` }}>
                        <td><Icon size={16} style={{ color: s.color }} /></td>
                        <td style={{ fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>{ev.record_date}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {catMeta && <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 8, background: catMeta.color + '20', color: catMeta.color, fontWeight: 600 }}>{catMeta.icon} {catMeta.label}</span>}
                              <strong style={{ fontSize: '0.84rem' }}>{ev.alert_rules?.name ?? ev.message}</strong>
                            </span>
                            {ev.alert_rules?.description && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ev.alert_rules.description}</span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{meta?.label ?? ev.variable}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', fontWeight: 600 }}>{formatValue(Number(ev.value), ev.variable)}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{opSymbol(ev.operator)} {formatValue(Number(ev.threshold), ev.variable)}</td>
                        <td>
                          <button
                            onClick={async () => { await fetch('/api/alerts/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, acknowledged: true }) }); onAck(); }}
                            style={{ fontSize: '0.7rem', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                          >
                            {kind === 'alertas' ? 'Resolver' : 'Marcar OK'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── Recomendaciones ─────────────── */
function RecommendationsList({ recos, loading }: { recos: Recommendation[]; loading: boolean }) {
  if (loading) return <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;
  if (recos.length === 0) {
    return (
      <div className="alert-success" style={{ fontSize: '0.86rem' }}>
        ✓ No hay recomendaciones nuevas. La operación está estable y la cobertura de reglas es adecuada.
      </div>
    );
  }

  const KIND_META: Record<Recommendation['kind'], { icon: typeof Wrench; label: string }> = {
    tune_threshold:   { icon: Settings2,  label: 'Ajustar umbral' },
    site_visit:       { icon: Wrench,     label: 'Visita técnica' },
    creg_control:     { icon: TrendingUp, label: 'Control reactiva' },
    enable_more:      { icon: Lightbulb,  label: 'Cobertura' },
    review_disabled:  { icon: Power,      label: 'Reglas inactivas' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {recos.map((r) => {
        const sm = sevMeta(r.severity);
        const km = KIND_META[r.kind];
        const KIcon = km.icon;
        return (
          <div key={r.id} className="glass-panel" style={{ padding: '14px 18px', borderLeft: `4px solid ${sm.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 8, background: sm.color + '20', color: sm.color, fontSize: '0.7rem', fontWeight: 700 }}>
                <KIcon size={11} /> {km.label}
              </span>
              <span style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {r.severity === 'high' ? 'Prioritaria' : r.severity === 'medium' ? 'Recomendada' : 'Sugerida'}
              </span>
              <strong style={{ fontSize: '0.95rem' }}>{r.title}</strong>
            </div>
            <p style={{ margin: '4px 0 8px', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{r.body}</p>
            {r.details && (
              <pre style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: '0.74rem', fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', margin: '6px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.details}</pre>
            )}
            {r.ctaLabel && (
              <div style={{ marginTop: 8 }}>
                {r.ctaHref ? (
                  <a href={r.ctaHref} className="secondary-btn" style={{ fontSize: '0.78rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {r.ctaLabel}
                  </a>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>→ {r.ctaLabel}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── Reglas agrupadas por categoría ─────────────── */
function RulesByCategory({
  grouped, otras, toggleEnabled, deleteRule,
}: {
  grouped: Map<AlertCategory, AlertRule[]>;
  otras: AlertRule[];
  toggleEnabled: (r: AlertRule) => void;
  deleteRule: (r: AlertRule) => void;
}) {
  const categories = (Object.keys(ALERT_CATEGORIES) as AlertCategory[]).filter((c) => grouped.has(c));
  if (categories.length === 0 && otras.length === 0) {
    return <div className="glass-panel" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No hay reglas. Crea una con &quot;Nueva regla&quot;.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {categories.map((cat) => {
        const catMeta = ALERT_CATEGORIES[cat];
        const list = grouped.get(cat) ?? [];
        return (
          <div key={cat} className="glass-panel" style={{ padding: 0, borderLeft: `4px solid ${catMeta.color}` }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.1rem' }}>{catMeta.icon}</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{catMeta.label}</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({list.length} regla{list.length !== 1 ? 's' : ''})</span>
            </div>
            <div className="table-container" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Severidad</th>
                    <th>Regla</th>
                    <th>Variable</th>
                    <th>Condición</th>
                    <th>Alcance</th>
                    <th style={{ width: 90 }}>Estado</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const sm = sevMeta(r.severity);
                    const Icon = sm.icon;
                    const meta = findVariableMeta(r.variable);
                    return (
                      <tr key={r.id}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 12, background: sm.color + '20', color: sm.color, fontSize: '0.72rem', fontWeight: 700 }}>
                            <Icon size={12} /> {sm.label}
                          </span>
                        </td>
                        <td>
                          <strong>{r.name}</strong>
                          {r.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: 2 }}>{r.description}</div>}
                        </td>
                        <td style={{ fontSize: '0.78rem' }}>{meta?.label ?? r.variable}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{opSymbol(r.operator)} {r.threshold}{meta?.unit ? ` ${meta.unit}` : ''}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{r.scope === 'all' ? 'Todas las casas' : r.scope}</td>
                        <td>
                          <button
                            onClick={() => toggleEnabled(r)}
                            style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', border: 'none', background: r.enabled ? '#10b98120' : '#94a3b820', color: r.enabled ? '#10b981' : '#64748b' }}
                          >
                            <Power size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                            {r.enabled ? 'Activa' : 'Inactiva'}
                          </button>
                        </td>
                        <td>
                          <button onClick={() => deleteRule(r)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} title="Eliminar regla">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {otras.length > 0 && (
        <div className="glass-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Otras ({otras.length}) — variables no catalogadas</h3>
          {otras.map((r) => <div key={r.id} style={{ fontSize: '0.78rem', marginTop: 6 }}>{r.name} · {r.variable}</div>)}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Form de nueva regla ─────────────── */
function NewRuleForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [variable, setVariable] = useState('generacion_wh');
  const [operator, setOperator] = useState('lt');
  const [threshold, setThreshold] = useState('');
  const [severity, setSeverity] = useState<'high' | 'medium' | 'low'>('medium');
  const [scope, setScope] = useState('all');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedMeta = findVariableMeta(variable);

  const submit = async () => {
    setErr(null);
    const n = Number(threshold);
    if (!name) return setErr('Nombre requerido');
    if (!Number.isFinite(n)) return setErr('Umbral debe ser número');
    setSaving(true);
    const r = await fetch('/api/alerts/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, variable, operator, threshold: n, severity, scope, description: description || null }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json();
      setErr(j.error ?? 'Error');
      return;
    }
    onSaved();
  };

  return (
    <div className="glass-panel">
      <h2 className="card-title" style={{ marginBottom: 12 }}>Nueva regla</h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: -4, marginBottom: 12 }}>
        Las reglas con severidad <strong>baja</strong> aparecen como <span style={{ color: '#3b82f6' }}>Notificaciones</span>. Las de severidad <strong>media</strong> o <strong>alta</strong> aparecen como <span style={{ color: '#ef4444' }}>Alertas</span> accionables.
      </p>
      {err && <div className="alert-error" style={{ marginBottom: 12 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="input-group">
          <label className="input-label">Nombre de la regla</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Casa 10 - corriente cerca de breaker" />
        </div>
        <div className="input-group">
          <label className="input-label">Severidad</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as 'high' | 'medium' | 'low')}>
            {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="input-group" style={{ gridColumn: 'span 2' }}>
          <label className="input-label">Variable a monitorear</label>
          <select value={variable} onChange={(e) => setVariable(e.target.value)}>
            {(Object.keys(ALERT_CATEGORIES) as AlertCategory[]).map((cat) => (
              <optgroup key={cat} label={`${ALERT_CATEGORIES[cat].icon} ${ALERT_CATEGORIES[cat].label}`}>
                {ALERT_VARIABLES.filter((v) => v.category === cat).map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label} {v.unit ? `(${v.unit})` : ''} — {v.frequency}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedMeta && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
              💡 {selectedMeta.description}
            </p>
          )}
        </div>
        <div className="input-group">
          <label className="input-label">Condición (operador)</label>
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Umbral{selectedMeta?.unit ? ` (${selectedMeta.unit})` : ''}</label>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={selectedMeta?.format === 'bool' ? '0 (para detectar flag activa)' : 'Ej: 50'} />
        </div>
        <div className="input-group">
          <label className="input-label">Alcance</label>
          <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="all (todas) o nombre de casa específico" />
        </div>
        <div className="input-group">
          <label className="input-label">Descripción (opcional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explicación que aparecerá en el evento" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="secondary-btn" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="primary-btn" onClick={submit} disabled={saving}>{saving ? 'Guardando…' : 'Guardar regla'}</button>
      </div>
    </div>
  );
}
