'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Home, BarChart3, ClipboardCheck, Bell, Settings, ArrowRight, Server, Database, Cloud, Cpu, Sun, FileText, AlertOctagon, Wrench, Settings2, Package, ScanLine, ChevronRight, ChevronDown, Clock, Lock, HardDrive, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ShoppingCart, Ruler, HardHat, TrendingUp } from 'lucide-react';

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
    title: 'Head End System',
    description: 'Visión integral del portafolio de 28 casas solares operando hoy.',
    Icon: BarChart3,
    color: '#07c5a8',
    details: [
      'Widgets de Módems, Medidores e Inversores con estado en línea',
      'Cierres y Vista Granular: lectura diaria por casa con métricas calculadas (yield, PR, fp)',
      'Consumo por Dispositivo: tabla completa según diccionario (37 cols) + sub-tab de gráficas',
      'Reactiva vs Activa (CREG 015-2018): análisis mensual de penalización + gráficas comparativas',
      'NAR (Notificaciones, Alertas y Recomendaciones) — eventos por casa + recomendaciones automáticas (visita, ajuste umbral, control reactiva)',
      'Control Manual Inversor: envío de comandos cos φ, Q, P_max, modo (stub hasta tener credenciales OEM)',
    ],
  },
  {
    href: '/ventas',
    title: 'CRM Ventas',
    description: 'Pipeline comercial de 5 etapas: del prospecto al contrato firmado.',
    Icon: ShoppingCart,
    color: '#3b82f6',
    details: [
      '5 etapas: Prospecto → Levantamiento → Propuesta → Contrato → Firmado',
      'Vista Kanban con drag-style buttons + vista Tabla con toggle',
      'Modal de transición pide solo los campos mínimos para el siguiente paso',
      'Captura factura mensual, valor COP, ubicación, estrato, tipo vivienda',
      'Al firmar, handoff automático a Ingeniería',
    ],
  },
  {
    href: '/ingenieria',
    title: 'Ingeniería',
    description: 'Solicita prefactibilidad, dimensiona el sistema, aprueba el diseño.',
    Icon: Ruler,
    color: '#8b5cf6',
    details: [
      '5 etapas: Pendiente → Prefactibilidad OK → Dimensionamiento → Aprobación → Aprobado',
      'Calculadora rápida arriba: sugiere kWp, paneles y categoría de inversor desde kWh/mes',
      'Solicita visita previa a Operaciones (sin perder contexto, queda esperando)',
      'Verifica disponibilidad de SKUs en Inventario al dimensionar',
      'Aprobación por humano, queda firmada y con timestamp',
      'Al aprobar, handoff automático a Operaciones para alistamiento',
    ],
  },
  {
    href: '/operaciones',
    title: 'Operaciones en Campo',
    description: 'Visita previa, alistamiento, instalación, operativo y legalización.',
    Icon: HardHat,
    color: '#f59e0b',
    details: [
      '5 etapas: Visita previa → Alistamiento → Instalación → Operativo → Legalizado',
      'La visita previa enlaza con el acta de /visitas (mismo flujo del técnico en campo)',
      'Alistamiento crea reserva en /inventario con los SKUs aprobados',
      'Instalación captura contratista, fecha y enlaza acta de instalación',
      'Operativo confirma generación con lectura inicial conectada a Metrum',
      'Legalizado cierra el proyecto: actas, garantías, normalización con operador de red',
    ],
  },
  {
    href: '/funnel',
    title: 'Funnel de Proyectos',
    description: 'Seguimiento end-to-end del pipeline con gráfica y tabla.',
    Icon: TrendingUp,
    color: '#10b981',
    details: [
      'KPIs globales: valor del pipeline, kWp aprobados, operativos, legalizados',
      'Gráfica de barras horizontales con conteo por etapa de cada módulo',
      'Tasas de conversión Ventas → Ingeniería → Operaciones → Cerrado',
      'Tabla de todos los proyectos con módulo actual, etapa y valor',
      'Filtros por módulo para identificar dónde se atascan los proyectos',
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
      'Al completar una visita, dispara movimientos en Inventario automáticamente',
    ],
  },
  {
    href: '/inventario',
    title: 'Inventario',
    description: 'Trazabilidad de equipos serializados y consumibles, con audit log completo.',
    Icon: Package,
    color: '#8b5cf6',
    details: [
      '4 métodos de ingreso: CSV bulk + manual + cámara QR + pistola USB',
      '5 tabs: Resumen, Equipos, Consumibles, Movimientos, Categorías',
      'Equipos por serial del fabricante (sin SKU interno) con estado, ubicación, garantía',
      'Consumibles por cantidad con umbral mínimo y alerta de stock bajo',
      'Audit log: cada cambio de estado o ubicación genera un movimiento auditado',
      'Integración bidireccional: Instalación marca seriales como installed; Emergencia marca como in_repair',
    ],
  },
  {
    href: '/alertas',
    title: 'NAR — Notificaciones, Alertas y Recomendaciones',
    description: 'Centro único: eventos informativos (notificaciones), accionables (alertas) y sugerencias derivadas del patrón (recomendaciones).',
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
          actas de visitas técnicas en campo, inventario serializado con trazabilidad de equipos, y eventualmente control
          de los inversores vía API del fabricante.
        </p>
      </div>

      {/* Estado del sistema — sync en vivo */}
      <div className="glass-panel">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
          <h2 className="card-title" style={{ margin: 0 }}>Estado del sistema</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Última escritura por cada cron</p>
        </div>
        <SyncStatusWidget />
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

      {/* Integración Visitas ↔ Inventario */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: 4 }}>Visitas ↔ Inventario — lazo automático</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 18, marginTop: 4 }}>
          Cuando una visita se marca como completada, el sistema mueve los equipos del inventario sin acción manual extra:
        </p>
        <InventoryLinkFlow />
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
  return (
    <div className="arch">
      {/* Capa 1 — Fuente */}
      <ArchLayer label="Fuente de datos" color="#3b82f6">
        <ArchCard color="#3b82f6" Icon={Cloud} title="Metrum" subtitle="ThingsBoard">
          <ArchPill>112 devices</ArchPill>
          <ArchPill>28 casas</ArchPill>
        </ArchCard>
      </ArchLayer>

      <ArchArrow />

      {/* Capa 2 — Ingesta */}
      <ArchLayer label="Ingesta y sync" color="#07c5a8">
        <ArchCard color="#07c5a8" Icon={Server} title="Next.js API Routes" subtitle="Service role admin">
          <ArchPill>devices/sync</ArchPill>
          <ArchPill>sync/all</ArchPill>
          <ArchPill>sync/consumption</ArchPill>
        </ArchCard>
        <ArchCardSmall color="#94a3b8" Icon={Clock} title="Vercel Cron" hint="06:00 UTC · diario" />
        <ArchCardSmall color="#94a3b8" Icon={Clock} title="GitHub Actions" hint="*/15 min · instant-check" />
      </ArchLayer>

      <ArchArrow />

      {/* Capa 3 — Almacenamiento */}
      <ArchLayer label="Almacenamiento" color="#10b981">
        <ArchCard color="#10b981" Icon={Database} title="Supabase Postgres" subtitle="13 tablas + auth schema">
          <ArchTableGroup label="Operación" tables={['devices', 'client_houses', 'daily_energy_closures', 'daily_consumption', 'daily_casa_metrics', 'instant_metrics']} />
          <ArchTableGroup label="Alertas" tables={['alert_rules', 'alert_events']} />
          <ArchTableGroup label="Visitas" tables={['field_visits', 'field_visit_photos']} />
          <ArchTableGroup label="Inventario" tables={['inventory_categories', 'inventory_items', 'inventory_consumables', 'inventory_movements']} />
        </ArchCard>
        <ArchCardSmall color="#94a3b8" Icon={HardDrive} title="Supabase Storage" hint="visit-photos · signed URLs" />
      </ArchLayer>

      <ArchArrow />

      {/* Capa 4 — UI */}
      <ArchLayer label="Presentación" color="#f59e0b">
        <ArchCard color="#f59e0b" Icon={Sun} title="SUNNY APP" subtitle="Mobile-first">
          <ArchPill>Next.js 16</ArchPill>
          <ArchPill>React 19</ArchPill>
          <ArchPill>Recharts</ArchPill>
        </ArchCard>
        <ArchCardSmall color="#8b5cf6" Icon={Lock} title="Auth Supabase" hint="Email + password · @gdo.com.co · @promigas.com" />
      </ArchLayer>

      <style jsx>{`
        .arch {
          display: grid;
          grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
          align-items: stretch;
          gap: 14px;
        }
        @media (max-width: 900px) {
          .arch {
            grid-template-columns: 1fr;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  );
}

function ArchLayer({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="arch-layer">
      <div className="arch-layer-label" style={{ color }}>{label}</div>
      <div className="arch-layer-stack">{children}</div>
      <style jsx>{`
        .arch-layer {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .arch-layer-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
          padding-bottom: 6px;
          border-bottom: 2px solid currentColor;
          opacity: 0.9;
        }
        .arch-layer-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }
      `}</style>
    </div>
  );
}

function ArchCard({ color, Icon, title, subtitle, children }: {
  color: string; Icon: typeof Sun; title: string; subtitle?: string; children?: React.ReactNode;
}) {
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      background: 'var(--bg-surface)',
      padding: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: subtitle || children ? 8 : 0 }}>
        <Icon size={18} style={{ color, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.2 }}>{title}</div>
          {subtitle && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {children && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{children}</div>}
    </div>
  );
}

function ArchCardSmall({ color, Icon, title, hint }: { color: string; Icon: typeof Sun; title: string; hint: string }) {
  return (
    <div style={{
      borderRadius: 8,
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      background: 'var(--bg-elevated)',
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <Icon size={14} style={{ color, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
      </div>
    </div>
  );
}

function ArchPill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: '0.65rem',
      padding: '2px 7px',
      borderRadius: 10,
      background: 'var(--bg-elevated)',
      color: 'var(--text-secondary)',
      fontFamily: 'ui-monospace, monospace',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function ArchTableGroup({ label, tables }: { label: string; tables: string[] }) {
  return (
    <div style={{ width: '100%', marginTop: 4 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {tables.map((t) => (
          <span key={t} style={{
            fontSize: '0.62rem',
            padding: '1px 6px',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            fontFamily: 'ui-monospace, monospace',
          }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function ArchArrow() {
  return (
    <div className="arch-arrow">
      <ChevronRight size={20} className="h" />
      <ChevronDown size={20} className="v" />
      <style jsx>{`
        .arch-arrow {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          opacity: 0.5;
        }
        .arch-arrow :global(.v) { display: none; }
        @media (max-width: 900px) {
          .arch-arrow :global(.h) { display: none; }
          .arch-arrow :global(.v) { display: block; }
        }
      `}</style>
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

/* ═══════════════ Visitas ↔ Inventario ═══════════════ */
function InventoryLinkFlow() {
  const flows = [
    {
      color: '#10b981',
      Icon: Wrench,
      title: 'Visita de Instalación → Equipos como installed',
      bullets: [
        'Al completar el acta, lee inv_serial, batt_serial, gateway_serial, meter_solar_serial, meter_red_serial',
        'Por cada serial que ya esté en inventario: status = installed, current_house_id = casa de la visita',
        'Genera movimiento type=install con related_visit_id (auditable desde Movimientos)',
        'Seriales no encontrados en inventario se ignoran silenciosamente (no destructivo)',
      ],
    },
    {
      color: '#ef4444',
      Icon: AlertOctagon,
      title: 'Visita de Emergencia con requiere_repuesto → Equipos como in_repair',
      bullets: [
        'Si requiere_repuesto = Sí y equipo_afectado está marcado, busca el equipo instalado en esa casa de esa familia',
        'Cambia status a in_repair y genera movimiento type=repair_start con related_visit_id',
        'Cuando el equipo regresa de taller, se cambia manualmente a in_stock desde la tabla de Equipos',
      ],
    },
    {
      color: '#8b5cf6',
      Icon: ScanLine,
      title: 'Ingreso de equipos nuevos al inventario',
      bullets: [
        'CSV bulk (template descargable) para grandes lotes desde el proveedor',
        'Formulario manual con autocompletado por categoría (marca, modelo, capacidad, garantía default)',
        'Escáner de cámara (BarcodeDetector API: QR + Code 128 + EAN + UPC + Data Matrix + PDF417)',
        'Pistola USB: escanea al input enfocado, igual que tecleo',
      ],
    },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {flows.map((f, i) => (
        <div key={i} style={{ padding: 14, borderRadius: 10, background: 'var(--bg-elevated)', borderLeft: `4px solid ${f.color}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <f.Icon size={18} style={{ color: f.color }} />
            <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{f.title}</div>
          </div>
          <ul style={{ margin: 0, paddingLeft: 22, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {f.bullets.map((b, j) => <li key={j}>{b}</li>)}
          </ul>
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
    { label: 'Base de datos', value: 'Supabase Postgres con 13 tablas + 1 schema auth.* gestionado' },
    { label: 'Storage', value: 'Supabase Storage para fotos de visitas (signed URLs)' },
    { label: 'Auth', value: 'Supabase Auth · email + password · bcrypt · validación de dominio en 3 capas' },
    { label: 'Backend datos', value: 'Metrum (ThingsBoard) API REST · login JWT · queries entitiesQuery y timeseries' },
    { label: 'Hosting', value: 'Vercel Hobby (auto-deploy desde main)' },
    { label: 'Cron diario', value: 'Vercel Cron 06:00 UTC (sync completo)' },
    { label: 'Cron 15 min', value: 'GitHub Actions */15 * * * * (lazo instantáneo)' },
    { label: 'PDF', value: 'jsPDF + jspdf-autotable (generación de actas)' },
    { label: 'Escáner', value: 'BarcodeDetector API nativa del navegador (QR + Code 128 + EAN + UPC + Data Matrix + PDF417)' },
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

/* ═══════════════ Sync status widget ═══════════════ */
interface SyncStatus {
  instant_metrics: { last_at: string | null };
  casa_metrics: { last_date: string | null };
  closures: { last_date: string | null };
  devices: { last_seen_max: string | null; total: number | null };
  now: string;
}

function SyncStatusWidget() {
  const [data, setData] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/sync/status', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      setData(j as SyncStatus);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading && !data) return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 8 }}>Cargando estado…</div>;
  if (err) return <div className="alert-error" style={{ fontSize: '0.85rem' }}>No se pudo cargar el estado: {err}</div>;
  if (!data) return null;

  const nowMs = new Date(data.now).getTime();
  const minutesSince = (iso: string | null): number | null => iso ? Math.floor((nowMs - new Date(iso).getTime()) / 60000) : null;
  const daysSince = (dateStr: string | null): number | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00Z').getTime();
    return Math.floor((nowMs - d) / 86400000);
  };

  return (
    <>
      <div className="status-grid" style={{ marginTop: 14 }}>
        <StatusCard
          label="Lazo de 15 min"
          source="instant_metrics"
          schedule="GitHub Actions */15 min"
          minutes={minutesSince(data.instant_metrics.last_at)}
          freshUnder={30}
          warnUnder={120}
          stamp={data.instant_metrics.last_at}
          unit="min"
        />
        <StatusCard
          label="Cierre diario"
          source="daily_energy_closures"
          schedule="Vercel Cron 06:00 UTC"
          days={daysSince(data.closures.last_date)}
          freshUnder={1.5}
          warnUnder={3}
          stamp={data.closures.last_date}
          unit="día"
        />
        <StatusCard
          label="Métricas por casa"
          source="daily_casa_metrics"
          schedule="Vercel Cron 06:00 UTC"
          days={daysSince(data.casa_metrics.last_date)}
          freshUnder={1.5}
          warnUnder={3}
          stamp={data.casa_metrics.last_date}
          unit="día"
        />
        <StatusCard
          label="Devices (Metrum)"
          source={`${data.devices.total ?? 0} devices`}
          schedule="Vercel Cron 06:00 UTC"
          minutes={minutesSince(data.devices.last_seen_max)}
          freshUnder={60}
          warnUnder={360}
          stamp={data.devices.last_seen_max}
          unit="min"
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button onClick={load} disabled={loading} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
          <RefreshCw size={12} /> {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <style jsx>{`
        .status-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        @media (max-width: 900px) { .status-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .status-grid { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

function StatusCard({ label, source, schedule, minutes, days, freshUnder, warnUnder, stamp, unit }: {
  label: string;
  source: string;
  schedule: string;
  minutes?: number | null;
  days?: number | null;
  freshUnder: number;
  warnUnder: number;
  stamp: string | null;
  unit: 'min' | 'día';
}) {
  const value = minutes !== undefined ? minutes : days ?? null;
  let color = '#94a3b8';
  let Icon = XCircle;
  let statusText = 'sin datos';

  if (value === null || stamp === null) {
    color = '#94a3b8';
    Icon = XCircle;
    statusText = 'sin datos';
  } else if (value < freshUnder) {
    color = '#10b981';
    Icon = CheckCircle2;
    statusText = 'OK';
  } else if (value < warnUnder) {
    color = '#f59e0b';
    Icon = AlertTriangle;
    statusText = 'lento';
  } else {
    color = '#ef4444';
    Icon = XCircle;
    statusText = 'caído';
  }

  const relText = value === null
    ? '—'
    : value < 1 && unit === 'min'
      ? 'ahora'
      : `hace ${value} ${unit}${value === 1 ? '' : unit === 'min' ? '' : 's'}`;

  const stampShort = stamp
    ? unit === 'min'
      ? new Date(stamp).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
      : stamp
    : '—';

  return (
    <div style={{ padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${color}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{source}</div>
        </div>
        <Icon size={16} style={{ color, flexShrink: 0 }} />
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color, lineHeight: 1.1 }}>{relText}</div>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>{stampShort}</div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <span style={{ color }}>{statusText}</span> · {schedule}
      </div>
    </div>
  );
}
