'use client';

import { useEffect, useState, useMemo } from 'react';
import { Bell, Plus, Trash2, AlertTriangle, AlertCircle, Info, CheckCircle2, Power } from 'lucide-react';
import { ALERT_VARIABLES, ALERT_CATEGORIES, findVariableMeta, formatValue, type AlertCategory } from '@/lib/alert-variables';

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

export default function AlertasPage() {
  const [tab, setTab] = useState<'reglas' | 'eventos'>('eventos');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [filterCategory, setFilterCategory] = useState<AlertCategory | 'all'>('all');

  const loadRules = async () => {
    setLoading(true);
    const r = await fetch('/api/alerts/rules');
    const j = await r.json();
    setRules(j.rules ?? []);
    setLoading(false);
  };
  const loadEvents = async () => {
    setLoading(true);
    const r = await fetch('/api/alerts/events');
    const j = await r.json();
    setEvents(j.events ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (tab === 'reglas') loadRules();
    else loadEvents();
  }, [tab]);

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
    if (tab === 'eventos') loadEvents();
  };

  // Agrupar reglas por categoría
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

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Configuración de Alertas</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
            Reglas evaluadas automáticamente por los crones diario y cada 15 min.
          </p>
        </div>
        <button className="primary-btn" onClick={runEvaluate}>
          <Bell size={14} /> Evaluar ahora
        </button>
      </div>

      {msg && <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'}>{msg.text}</div>}

      <div className="tabs">
        <button onClick={() => setTab('eventos')} className={`tab ${tab === 'eventos' ? 'active' : ''}`}>Eventos ({events.length})</button>
        <button onClick={() => setTab('reglas')} className={`tab ${tab === 'reglas' ? 'active' : ''}`}>Reglas ({rules.length})</button>
      </div>

      {/* Filtro de categoría */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button onClick={() => setFilterCategory('all')} className={`chip ${filterCategory === 'all' ? 'active' : ''}`}>
          Todas
        </button>
        {(Object.keys(ALERT_CATEGORIES) as AlertCategory[]).map((cat) => (
          <button key={cat} onClick={() => setFilterCategory(cat)} className={`chip ${filterCategory === cat ? 'active' : ''}`}>
            {ALERT_CATEGORIES[cat].icon} {ALERT_CATEGORIES[cat].label}
          </button>
        ))}
      </div>

      {tab === 'reglas' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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

      {tab === 'eventos' && <EventsTable events={events} loading={loading} filterCategory={filterCategory} onAck={loadEvents} />}
    </>
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

/* ─────────────── Tabla de eventos legible ─────────────── */
function EventsTable({ events, loading, filterCategory, onAck }: {
  events: AlertEvent[]; loading: boolean; filterCategory: AlertCategory | 'all'; onAck: () => void;
}) {
  const filtered = useMemo(() => {
    if (filterCategory === 'all') return events;
    return events.filter((e) => findVariableMeta(e.variable)?.category === filterCategory);
  }, [events, filterCategory]);

  return (
    <div className="glass-panel" style={{ padding: 0 }}>
      <div className="table-container" style={{ border: 'none' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              <th style={{ width: 110 }}>Fecha</th>
              <th>Casa</th>
              <th>Alerta</th>
              <th>Variable</th>
              <th>Lectura</th>
              <th>Umbral</th>
              <th style={{ width: 70 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No hay eventos. Espera al próximo cron o pulsa &quot;Evaluar ahora&quot;.</td></tr>
            ) : filtered.map((ev) => {
              const sm = sevMeta(ev.severity);
              const Icon = sm.icon;
              const meta = findVariableMeta(ev.variable);
              const catMeta = meta ? ALERT_CATEGORIES[meta.category] : null;
              return (
                <tr key={ev.id} style={{ opacity: ev.acknowledged ? 0.45 : 1, borderLeft: `3px solid ${sm.color}` }}>
                  <td><Icon size={16} style={{ color: sm.color }} /></td>
                  <td style={{ fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>{ev.record_date}</td>
                  <td><strong>{ev.casa}</strong></td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {catMeta && <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 8, background: catMeta.color + '20', color: catMeta.color, fontWeight: 600 }}>{catMeta.icon} {catMeta.label}</span>}
                        <strong style={{ fontSize: '0.85rem' }}>{ev.alert_rules?.name ?? ev.message}</strong>
                      </span>
                      {ev.alert_rules?.description && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ev.alert_rules.description}</span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{meta?.label ?? ev.variable}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', fontWeight: 600 }}>{formatValue(Number(ev.value), ev.variable)}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{opSymbol(ev.operator)} {formatValue(Number(ev.threshold), ev.variable)}</td>
                  <td>
                    {ev.acknowledged ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#10b981' }}>
                        <CheckCircle2 size={12} /> OK
                      </span>
                    ) : (
                      <button
                        onClick={async () => { await fetch('/api/alerts/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, acknowledged: true }) }); onAck(); }}
                        style={{ fontSize: '0.7rem', padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                      >
                        Marcar OK
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
