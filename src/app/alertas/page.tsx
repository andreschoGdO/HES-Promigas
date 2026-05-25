'use client';

import { useEffect, useState } from 'react';
import { Bell, Plus, Trash2, AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react';

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
  alert_rules: { name: string } | null;
}

interface VarOption { key: string; label: string; group: string; }
const VARIABLES: VarOption[] = [
  // Solar y consumo (diarias)
  { key: 'generacion_wh',         label: 'Generación (Wh)',              group: 'Solar / Diario' },
  { key: 'demanda_wh',            label: 'Demanda (Wh)',                 group: 'Solar / Diario' },
  { key: 'importacion_wh',        label: 'Importación red (Wh)',         group: 'Solar / Diario' },
  { key: 'excedentes_wh',         label: 'Excedentes (Wh)',              group: 'Solar / Diario' },
  { key: 'gen_dem_pct',           label: 'Gen / Dem (%)',                group: 'Solar / Diario' },
  { key: 'exc_gen_pct',           label: 'Exc / Gen (%)',                group: 'Solar / Diario' },
  { key: 'imp_dem_pct',           label: 'Imp / Dem (%)',                group: 'Solar / Diario' },
  { key: 'yield_real',            label: 'Yield Real (kWh/kWp)',         group: 'Solar / Diario' },
  { key: 'desempeno_pct',         label: 'Desempeño / PR (%)',           group: 'Solar / Diario' },
  { key: 'imax_a',                label: 'Corriente máxima (A)',         group: 'Solar / Diario' },
  { key: 'potencia_kw',           label: 'Potencia instalada (kW)',      group: 'Solar / Diario' },
  // Reactiva (mensual — CREG 015-2018)
  { key: 'eri_ratio_pct_mtd',     label: 'Ratio ERI/EA mes-en-curso (%)', group: 'Reactiva / CREG (mensual)' },
  { key: 'excedente_kvarh_mtd',   label: 'Excedente sobre 50% (kvarh)',  group: 'Reactiva / CREG (mensual)' },
  { key: 'cos_phi_mtd',           label: 'Factor de potencia cos φ',     group: 'Reactiva / CREG (mensual)' },
  { key: 'penalizacion_cop_mtd',  label: 'Penalización estimada (COP)',  group: 'Reactiva / CREG (mensual)' },
];

const OPERATORS = [
  { key: 'gt', label: '> mayor que' },
  { key: 'gte', label: '≥ mayor o igual' },
  { key: 'lt', label: '< menor que' },
  { key: 'lte', label: '≤ menor o igual' },
  { key: 'eq', label: '= igual a' },
];

const SEVERITIES: Array<{ key: 'high' | 'medium' | 'low'; label: string; color: string; icon: typeof AlertCircle }> = [
  { key: 'high', label: 'Alto', color: '#ef4444', icon: AlertCircle },
  { key: 'medium', label: 'Medio', color: '#f59e0b', icon: AlertTriangle },
  { key: 'low', label: 'Bajo', color: '#3b82f6', icon: Info },
];

const sevMeta = (s: string) => SEVERITIES.find((x) => x.key === s) ?? SEVERITIES[2];

export default function AlertasPage() {
  const [tab, setTab] = useState<'reglas' | 'eventos'>('reglas');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

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
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    setMsg({ kind: r.ok ? 'success' : 'error', text: r.ok ? `Evaluadas ${j.evaluated} reglas · ${j.fired} eventos generados` : (j.error ?? 'Error') });
    if (tab === 'eventos') loadEvents();
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Configuración de Alertas</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
            Reglas evaluadas por el cron horario contra las métricas diarias por casa.
          </p>
        </div>
        <button className="primary-btn" onClick={runEvaluate}>
          <Bell size={14} /> Evaluar ahora
        </button>
      </div>

      {msg && <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'}>{msg.text}</div>}

      <div className="tabs">
        <button onClick={() => setTab('reglas')} className={`tab ${tab === 'reglas' ? 'active' : ''}`}>Reglas ({rules.length})</button>
        <button onClick={() => setTab('eventos')} className={`tab ${tab === 'eventos' ? 'active' : ''}`}>Eventos ({events.length})</button>
      </div>

      {tab === 'reglas' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="primary-btn" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Nueva regla
            </button>
          </div>

          {showAdd && <NewRuleForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); loadRules(); }} />}

          <div className="glass-panel" style={{ padding: 0 }}>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Severidad</th>
                    <th>Nombre</th>
                    <th>Variable</th>
                    <th>Condición</th>
                    <th>Alcance</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</td></tr>
                  ) : rules.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No hay reglas. Crea una con &quot;Nueva regla&quot;.</td></tr>
                  ) : rules.map((r) => {
                    const sm = sevMeta(r.severity);
                    const Icon = sm.icon;
                    const variableLabel = VARIABLES.find((v) => v.key === r.variable)?.label ?? r.variable;
                    const opLabel = OPERATORS.find((o) => o.key === r.operator)?.label.split(' ')[0] ?? r.operator;
                    return (
                      <tr key={r.id}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px', borderRadius: 12, background: sm.color + '20', color: sm.color, fontSize: '0.75rem', fontWeight: 700 }}>
                            <Icon size={12} /> {sm.label}
                          </span>
                        </td>
                        <td><strong>{r.name}</strong>{r.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{r.description}</div>}</td>
                        <td style={{ fontSize: '0.8rem' }}>{variableLabel}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}>{opLabel} {r.threshold}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.scope === 'all' ? 'Todas las casas' : r.scope}</td>
                        <td>
                          <button
                            onClick={() => toggleEnabled(r)}
                            style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', border: 'none', background: r.enabled ? '#10b98120' : '#94a3b820', color: r.enabled ? '#10b981' : '#64748b' }}
                          >
                            {r.enabled ? 'Activa' : 'Inactiva'}
                          </button>
                        </td>
                        <td><button onClick={() => deleteRule(r)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><Trash2 size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'eventos' && (
        <div className="glass-panel" style={{ padding: 0 }}>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Sev.</th>
                  <th>Fecha</th>
                  <th>Casa</th>
                  <th>Regla</th>
                  <th>Variable</th>
                  <th>Valor</th>
                  <th>Umbral</th>
                  <th>Ack</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</td></tr>
                ) : events.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No hay eventos. Pulsa &quot;Evaluar ahora&quot; o espera al próximo cron.</td></tr>
                ) : events.map((ev) => {
                  const sm = sevMeta(ev.severity);
                  const Icon = sm.icon;
                  return (
                    <tr key={ev.id} style={{ opacity: ev.acknowledged ? 0.5 : 1 }}>
                      <td><Icon size={14} style={{ color: sm.color }} /></td>
                      <td style={{ fontSize: '0.8rem' }}>{ev.record_date}</td>
                      <td><strong>{ev.casa}</strong></td>
                      <td style={{ fontSize: '0.8rem' }}>{ev.alert_rules?.name ?? '—'}</td>
                      <td style={{ fontSize: '0.8rem' }}>{ev.variable}</td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem' }}>{Number(ev.value).toFixed(2)}</td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{ev.operator} {ev.threshold}</td>
                      <td>
                        {ev.acknowledged ? <CheckCircle2 size={14} style={{ color: '#10b981' }} /> : (
                          <button
                            onClick={async () => { await fetch('/api/alerts/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, acknowledged: true }) }); loadEvents(); }}
                            style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                          >
                            Ack
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
      )}
    </>
  );
}

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

  const submit = async () => {
    setErr(null);
    const n = Number(threshold);
    if (!name) return setErr('Nombre requerido');
    if (!Number.isFinite(n)) return setErr('Umbral debe ser número');
    setSaving(true);
    const r = await fetch('/api/alerts/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
          <label className="input-label">Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Generación baja casa 10" />
        </div>
        <div className="input-group">
          <label className="input-label">Severidad</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as 'high' | 'medium' | 'low')}>
            {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Variable</label>
          <select value={variable} onChange={(e) => setVariable(e.target.value)}>
            {Array.from(new Set(VARIABLES.map((v) => v.group))).map((group) => (
              <optgroup key={group} label={group}>
                {VARIABLES.filter((v) => v.group === group).map((v) => (
                  <option key={v.key} value={v.key}>{v.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Condición</label>
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {OPERATORS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Umbral</label>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Ej: 5000" />
        </div>
        <div className="input-group">
          <label className="input-label">Alcance</label>
          <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="all o Casa 10" />
        </div>
        <div className="input-group" style={{ gridColumn: 'span 2' }}>
          <label className="input-label">Descripción (opcional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="secondary-btn" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="primary-btn" onClick={submit} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </div>
  );
}
