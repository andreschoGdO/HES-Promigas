'use client';

import Link from 'next/link';
import { Home, BarChart3, ClipboardCheck, Bell, Settings, ArrowRight, Server, Database, Cloud, Cpu, Sun, FileText, AlertOctagon, Wrench, Settings2 } from 'lucide-react';

interface Module {
  href: string;
  title: string;
  description: string;
  Icon: typeof BarChart3;
  color: string;
  details: string[];
}

const MODULES: Module[] = [
  {
    href: '/dashboard',
    title: 'Dashboard',
    description: 'Visión integral del portafolio de 28 casas solares.',
    Icon: BarChart3,
    color: '#07c5a8',
    details: [
      'Widgets de Módems, Medidores e Inversores con estado en línea',
      'Cierres y Vista Granular: lectura diaria por casa con métricas calculadas (yield, PR, fp)',
      'Consumo por Dispositivo: tabla completa según diccionario (37 cols) + sub-tab de gráficas',
      'Reactiva vs Activa (CREG 015-2018): análisis mensual de penalización + gráficas comparativas',
      'Alertas por Casa: eventos agrupados por casa con severidad',
      'Control Manual Inversor: envío de comandos cos φ, Q, P_max, modo (stub hasta tener credenciales OEM)',
    ],
  },
  {
    href: '/visitas',
    title: 'Visitas en Campo',
    description: 'Actas técnicas digitales para móvil con fotos y geolocalización.',
    Icon: ClipboardCheck,
    color: '#10b981',
    details: [
      '4 tipos de visita: Previa, Instalación, Emergencia, Normalización',
      'Acta Previa adopta plantilla oficial PROMIGAS (FO:Prefactibilidad)',
      'Mobile-first: inputs grandes, GPS, captura directa de cámara',
      'Upload de fotos con preview y signed URLs en Supabase Storage',
      'Descarga PDF con layout oficial PROMIGAS (logo Sunny + secciones + fotos)',
      'Historial con filtros por tipo, estado, casa',
    ],
  },
  {
    href: '/alertas',
    title: 'Configuración Alertas',
    description: 'Reglas evaluadas automáticamente sobre las variables del sistema.',
    Icon: Bell,
    color: '#f59e0b',
    details: [
      '31 reglas seed agrupadas en 6 categorías (Solar, Reactiva CREG, Demanda, Batería, Alarmas inversor, Conexión)',
      'Cada regla se define con: variable + operador + umbral + severidad + alcance',
      'Evaluador corre cada 15 min (lazo instantáneo) y cada día (cierres)',
      'Eventos guardados en base de datos con timestamp, casa, valor real vs umbral',
      'Marcar OK para reconocer eventos atendidos',
    ],
  },
  {
    href: '/configuracion',
    title: 'Configuración API',
    description: 'Estado de la conexión con Metrum y sincronización manual.',
    Icon: Settings,
    color: '#3b82f6',
    details: [
      'Probar conexión a Metrum',
      'Estado del último sync',
      'Cuenta total de dispositivos, desglose por categoría',
      'Forzar sincronización manual',
    ],
  },
  {
    href: '/cuenta',
    title: 'Mi cuenta',
    description: 'Datos del usuario y cambio de contraseña.',
    Icon: Home,
    color: '#8b5cf6',
    details: [
      'Información de la cuenta (email, nombre, fecha de alta)',
      'Cambiar contraseña',
      'Cerrar sesión',
    ],
  },
];

export default function InicioPage() {
  return (
    <>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Sun size={28} style={{ color: 'var(--accent)' }} strokeWidth={2.5} fill="currentColor" />
          <h1 style={{ margin: 0 }}>SUNNY APP</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 6, maxWidth: 800 }}>
          Plataforma de monitoreo, control y operación de las instalaciones solares residenciales de HES Promigas.
          Integra Metrum (ThingsBoard) con Supabase y procesa cierres diarios, métricas mensuales CREG, alertas en tiempo real,
          actas de visitas técnicas en campo y eventualmente control de los inversores vía API del fabricante.
        </p>
      </div>

      {/* Diagrama de arquitectura */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 16 }}>Arquitectura general</h2>
        <ArchitectureDiagram />
      </div>

      {/* Módulos */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 8 }}>Módulos de la aplicación</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 18, marginTop: 0 }}>
          Estas son las áreas principales de la app. Click en cualquiera para entrar.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {MODULES.map((m) => (
            <Link key={m.href} href={m.href} className="glass-panel"
              style={{ textDecoration: 'none', color: 'inherit', padding: 18, borderLeft: `4px solid ${m.color}`, cursor: 'pointer', transition: 'transform 0.15s', display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <m.Icon size={20} style={{ color: m.color, flexShrink: 0 }} />
                <h3 style={{ margin: 0, fontSize: '1rem' }}>{m.title}</h3>
                <ArrowRight size={14} style={{ color: 'var(--text-muted)', marginLeft: 'auto' }} />
              </div>
              <p style={{ margin: '0 0 10px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{m.description}</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {m.details.slice(0, 3).map((d, i) => <li key={i}>{d}</li>)}
                {m.details.length > 3 && <li><em>…y {m.details.length - 3} más</em></li>}
              </ul>
            </Link>
          ))}
        </div>
      </div>

      {/* Flujo de datos diario */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 4 }}>Cómo fluye la data — ciclo diario</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 18, marginTop: 4 }}>
          Cada noche a la 01:00 hora Colombia (06:00 UTC), un cron programado de Vercel ejecuta este ciclo completo:
        </p>
        <DailyFlow />
      </div>

      {/* Flujo instantáneo */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 4 }}>Lazo de control instantáneo — cada 15 min</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 18, marginTop: 4 }}>
          GitHub Actions dispara una verificación cada 15 minutos para detectar alarmas en tiempo real:
        </p>
        <InstantFlow />
      </div>

      {/* Tipos de visitas */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 4 }}>Tipos de visita en campo</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 18, marginTop: 4 }}>
          Cada acta sigue una plantilla específica según el motivo de la visita:
        </p>
        <VisitTypesGrid />
      </div>

      {/* Stack tecnológico */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 4 }}>Stack tecnológico</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 18, marginTop: 4 }}>
          Las piezas que componen la plataforma:
        </p>
        <TechStack />
      </div>
    </>
  );
}

/* ═══════════════ Diagrama de arquitectura ═══════════════ */
function ArchitectureDiagram() {
  const box = {
    padding: '14px 18px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg-surface)',
    minWidth: 140,
    textAlign: 'center' as const,
  };
  const label = { fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 };
  const title = { fontSize: '0.95rem', fontWeight: 600 };
  const arrow = {
    width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent',
    borderLeft: '10px solid var(--text-muted)', alignSelf: 'center',
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, minWidth: 800, padding: '8px 0' }}>
        {/* Capa fuente */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div style={label}>Fuente de datos</div>
          <div style={{ ...box, borderColor: '#3b82f6', minWidth: 180 }}>
            <div style={{ color: '#3b82f6', marginBottom: 4 }}><Cloud size={20} /></div>
            <div style={title}>Metrum</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>ThingsBoard · 112 devices · 28 casas</div>
          </div>
        </div>
        <div style={arrow} />
        {/* Capa ingesta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div style={label}>Ingesta y sync</div>
          <div style={{ ...box, borderColor: '#07c5a8', minWidth: 200 }}>
            <div style={{ color: '#07c5a8', marginBottom: 4 }}><Server size={20} /></div>
            <div style={title}>Next.js API Routes</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>devices/sync · sync/all · sync/consumption · cron/sync · cron/instant-check</div>
          </div>
          <div style={{ ...box, borderColor: '#94a3b8', fontSize: '0.78rem' }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}><Cpu size={16} /></div>
            <div>Vercel Cron diario</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>06:00 UTC</div>
          </div>
          <div style={{ ...box, borderColor: '#94a3b8', fontSize: '0.78rem' }}>
            <div>GitHub Actions 15 min</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>*/15 * * * *</div>
          </div>
        </div>
        <div style={arrow} />
        {/* Capa almacenamiento */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div style={label}>Almacenamiento</div>
          <div style={{ ...box, borderColor: '#10b981', minWidth: 180 }}>
            <div style={{ color: '#10b981', marginBottom: 4 }}><Database size={20} /></div>
            <div style={title}>Supabase Postgres</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>devices · houses · closures · consumption · casa_metrics · instant_metrics · alert_rules · alert_events · field_visits</div>
          </div>
          <div style={{ ...box, borderColor: '#94a3b8', fontSize: '0.78rem' }}>
            <div>Supabase Storage</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>visit-photos bucket</div>
          </div>
        </div>
        <div style={arrow} />
        {/* Capa presentación */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div style={label}>UI</div>
          <div style={{ ...box, borderColor: '#f59e0b', minWidth: 180 }}>
            <div style={{ color: '#f59e0b', marginBottom: 4 }}><Sun size={20} /></div>
            <div style={title}>SUNNY APP</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Next.js 16 · React 19 · Recharts · Mobile-first</div>
          </div>
          <div style={{ ...box, borderColor: '#8b5cf6', fontSize: '0.78rem' }}>
            <div>Auth Supabase</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Email + password · bcrypt · dominio @gdo.com.co / @promigas.com</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Flujo diario ═══════════════ */
function DailyFlow() {
  const steps = [
    { t: '06:00 UTC', label: 'Vercel Cron dispara', desc: '/api/cron/sync', color: '#94a3b8' },
    { t: '1.', label: 'Sincronizar dispositivos', desc: '117 entidades Metrum → 112 devices (5 excluidos)', color: '#3b82f6' },
    { t: '2.', label: 'Reconstruir casas', desc: 'Agrupa devices por gateway padre → 28 casas en client_houses', color: '#07c5a8' },
    { t: '3.', label: 'Sincronizar cierres diarios', desc: 'Por device/día: CenergyAI/AE/RI/RE → daily_energy_closures', color: '#10b981' },
    { t: '4.', label: 'Sincronizar consumo', desc: 'Por casa/día: 37 cols del diccionario → daily_consumption', color: '#10b981' },
    { t: '5.', label: 'Pre-computar métricas casa', desc: 'Generación, demanda, yield, PR, Imax → daily_casa_metrics', color: '#f59e0b' },
    { t: '6.', label: 'Evaluar alertas', desc: '31 reglas activas → alert_events (idempotente)', color: '#ef4444' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: `4px solid ${s.color}` }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: s.color, fontWeight: 700, minWidth: 60 }}>{s.t}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ Flujo instantáneo 15 min ═══════════════ */
function InstantFlow() {
  const steps = [
    { t: '*/15 min', label: 'GitHub Actions dispara', desc: 'POST /api/cron/instant-check con CRON_SECRET', color: '#94a3b8' },
    { t: '1.', label: 'Por cada casa', desc: 'Lee powerAI · powerRI · currentA/B/C del meter rojo', color: '#3b82f6' },
    { t: '2.', label: 'Calcula derivadas', desc: 'cos φ_now = P / √(P² + Q²) · desbalance entre fases · Imax', color: '#f59e0b' },
    { t: '3.', label: 'Upsert instant_metrics', desc: '1 fila por casa por ventana de 15 min', color: '#10b981' },
    { t: '4.', label: 'Evaluador alertas', desc: 'Reglas instantáneas + alarmas flag* del inversor → alert_events', color: '#ef4444' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: `4px solid ${s.color}` }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: s.color, fontWeight: 700, minWidth: 60 }}>{s.t}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ Tipos de visita ═══════════════ */
function VisitTypesGrid() {
  const types = [
    { Icon: FileText, color: '#07c5a8', label: 'Visita Previa', desc: 'Inspección de prefactibilidad. Datos del sitio, mediciones eléctricas, registro fotográfico, recomendación técnica.' },
    { Icon: Wrench, color: '#10b981', label: 'Visita de Instalación', desc: 'Acta de instalación física. Inversor + paneles + batería + gateway + medidores. Pruebas y conformidad.' },
    { Icon: AlertOctagon, color: '#ef4444', label: 'Visita de Emergencia', desc: 'Atención a fallas o paradas. Diagnóstico, acciones, resultado, repuestos.' },
    { Icon: Settings2, color: '#f59e0b', label: 'Visita de Normalización', desc: 'Ajustes para cumplir norma (RETIE, CREG). Estado, cambios aplicados, pruebas finales, documentación.' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {types.map((t, i) => (
        <div key={i} style={{ padding: 14, borderRadius: 10, background: 'var(--bg-elevated)', borderLeft: `4px solid ${t.color}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <t.Icon size={18} style={{ color: t.color }} />
            <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{t.label}</div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.desc}</div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ Stack ═══════════════ */
function TechStack() {
  const items = [
    { label: 'Frontend', value: 'Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4' },
    { label: 'Charts', value: 'Recharts (líneas, barras, donuts, ejes duales)' },
    { label: 'Iconos', value: 'Lucide React' },
    { label: 'Base de datos', value: 'Supabase Postgres con 9 tablas + 1 schema auth.* gestionado' },
    { label: 'Storage', value: 'Supabase Storage para fotos de visitas (signed URLs)' },
    { label: 'Auth', value: 'Supabase Auth · email + password · bcrypt · validación de dominio en 3 capas' },
    { label: 'Backend datos', value: 'Metrum (ThingsBoard) API REST · login JWT · queries entitiesQuery y timeseries' },
    { label: 'Hosting', value: 'Vercel Hobby (auto-deploy desde main)' },
    { label: 'Cron diario', value: 'Vercel Cron 06:00 UTC (sync completo)' },
    { label: 'Cron 15 min', value: 'GitHub Actions */15 * * * * (lazo instantáneo)' },
    { label: 'PDF', value: 'jsPDF + jspdf-autotable (generación de actas)' },
  ];
  return (
    <table style={{ width: '100%', fontSize: '0.85rem' }}>
      <tbody>
        {items.map((it, i) => (
          <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
            <td style={{ padding: '8px 10px', color: 'var(--text-muted)', width: 140, fontWeight: 600, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{it.label}</td>
            <td style={{ padding: '8px 10px' }}>{it.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
