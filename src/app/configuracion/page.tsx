'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Server, Key, CheckCircle2, AlertCircle, Clock, RefreshCw, EyeOff, Eye, Copy, Code, ChevronDown, ChevronUp, Plug, Send, Lock } from 'lucide-react';
import { classifyDevice } from '@/lib/classify-device';
import { readVisibility, writeVisibility, MENU_ITEM_CATALOG, ALWAYS_VISIBLE_IDS, type SidebarVisibility } from '@/lib/sidebar-visibility';

export default function Configuracion() {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Configuración del Sistema</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Administración de credenciales, sincronización con Metrum y visibilidad del menú lateral.
          </p>
        </div>
      </div>

      <ConexionTab />
      <SidebarVisibilityCard />
      <ApiDocsCard />
    </>
  );
}

/* ============================================================
 *  Documentación de APIs y arquitectura
 * ============================================================ */

interface EndpointDef {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'none' | 'session' | 'key';
  desc: string;
  notes?: string;
}

const ENDPOINTS_PUBLIC: EndpointDef[] = [
  { method: 'POST', path: '/api/external/crm/projects', auth: 'key', desc: 'Crear card (proyecto) en el CRM desde otra app. Cae en /ventas etapa Prospecto.', notes: 'Idempotente vía external_id.' },
  { method: 'GET',  path: '/api/external/crm/projects', auth: 'key', desc: 'Listar proyectos. Filtros: module, stage, updated_since, limit. Usar module=operations para leer la cola de Operaciones.' },
  { method: 'GET',  path: '/api/external/crm/projects?meta=1', auth: 'key', desc: 'Metadata del endpoint (modulos, etapas disponibles).' },
  { method: 'GET',  path: '/api/external/crm/projects/[id]', auth: 'key', desc: 'Detalle de un proyecto con visitas + reserva + items asignados. ?include_events=1 anexa audit log.' },
];

const ENDPOINTS_INTERNAL: EndpointDef[] = [
  { method: 'GET',  path: '/api/sync/status',                   auth: 'none', desc: 'Timestamps de la última escritura de cada cron (15min, daily, devices).' },
  { method: 'POST', path: '/api/cron/sync?quick=1',             auth: 'key',  desc: 'Disparo manual de sincronización rápida (devices + lazo instantáneo). Auth: header Authorization: Bearer $CRON_SECRET.' },
  { method: 'POST', path: '/api/cron/instant-check',            auth: 'key',  desc: 'Lazo de 15 min: lee Metrum, escribe instant_metrics, evalúa alertas.' },
  { method: 'GET',  path: '/api/crm/projects',                  auth: 'session', desc: 'Lista proyectos CRM (filtro por module/stage/q).' },
  { method: 'POST', path: '/api/crm/projects/[id]/transition',  auth: 'session', desc: 'Avanza etapa de un proyecto con campos requeridos.' },
  { method: 'GET',  path: '/api/crm/funnel',                    auth: 'session', desc: 'Agregados de pipeline + lista de proyectos para reporting.' },
  { method: 'GET',  path: '/api/crm/stage-fields',              auth: 'session', desc: 'Configuración de campos por etapa (con seed automático en primer uso).' },
  { method: 'GET',  path: '/api/reports?type=...',              auth: 'session', desc: 'Genera reportes (operacion, reactiva, alertas, inventario, pipeline, ejecutivo).' },
  { method: 'GET',  path: '/api/inventory/items',               auth: 'session', desc: 'Catálogo de equipos serializados con filtros.' },
  { method: 'GET',  path: '/api/inventory/movements',           auth: 'session', desc: 'Audit log de movimientos de inventario.' },
  { method: 'POST', path: '/api/inventory/reservations',        auth: 'session', desc: 'Crear reserva de equipos para una visita planeada.' },
  { method: 'GET',  path: '/api/alerts/events',                 auth: 'session', desc: 'Eventos de alertas disparadas.' },
  { method: 'GET',  path: '/api/alerts/top?days=N',             auth: 'session', desc: 'Top alertas más frecuentes en N días por regla+casa.' },
  { method: 'GET',  path: '/api/alerts/rules',                  auth: 'session', desc: 'CRUD de reglas de alerta.' },
  { method: 'GET',  path: '/api/visits',                        auth: 'session', desc: 'CRUD de visitas en campo (previa, instalación, emergencia, normalización).' },
  { method: 'GET',  path: '/api/metrum/devices',                auth: 'session', desc: 'Listado raw de devices desde Metrum (proxy).' },
  { method: 'GET',  path: '/api/metrum/timeseries',             auth: 'session', desc: 'Series de tiempo crudas desde Metrum para granular charts.' },
  { method: 'GET',  path: '/api/metrum/keys',                   auth: 'session', desc: 'Lista las keys de timeseries disponibles para un device.' },
];

function methodColor(m: string): string {
  return m === 'GET' ? '#3b82f6' : m === 'POST' ? '#10b981' : m === 'PATCH' ? '#f59e0b' : '#ef4444';
}

function ApiDocsCard() {
  const [section, setSection] = useState<'external' | 'internal' | 'modules'>('external');
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="glass-panel" style={{ marginTop: 20 }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Code size={18} style={{ color: 'var(--text-secondary)' }} />
          <h2 className="card-title" style={{ margin: 0 }}>API y documentación del sistema</h2>
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {!expanded && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Cómo integrar otras apps, qué endpoints están disponibles, y qué hace cada módulo de SUNNY APP.
        </p>
      )}

      {expanded && (
        <>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '8px 0 16px' }}>
            Referencia de integración para conectar otras herramientas con SUNNY APP. Si la otra app necesita crear proyectos en el CRM o leer datos, esta es la guía.
          </p>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            <button className={`chip ${section === 'external' ? 'active' : ''}`} onClick={() => setSection('external')}>
              <Plug size={12} /> API externa (entrada)
            </button>
            <button className={`chip ${section === 'internal' ? 'active' : ''}`} onClick={() => setSection('internal')}>
              <Server size={12} /> Endpoints internos
            </button>
            <button className={`chip ${section === 'modules' ? 'active' : ''}`} onClick={() => setSection('modules')}>
              <Code size={12} /> Módulos y arquitectura
            </button>
          </div>

          {section === 'external' && <ExternalApiSection />}
          {section === 'internal' && <InternalApiSection />}
          {section === 'modules' && <ModulesSection />}
        </>
      )}
    </div>
  );
}

/* ───── Sección 1: API externa con setup, ejemplos, tester ───── */
function ExternalApiSection() {
  const [tester, setTester] = useState({ key: '', name: 'Cliente Demo', email: 'demo@ejemplo.co', city: 'Cali', kwh: '450' });
  const [response, setResponse] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://sunnyhes.vercel.app';

  const curlExample = `curl -X POST ${baseUrl}/api/external/crm/projects \\
  -H "X-API-Key: TU_CRM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Casa Juan Pérez - Cali",
    "client_name": "Juan Pérez",
    "client_email": "juan@ejemplo.co",
    "client_phone": "+57 300 1234567",
    "client_city": "Cali",
    "invoice_kwh_mensual": 450,
    "invoice_valor_cop": 380000,
    "source": "meta_ads",
    "external_id": "lead-campaign-001"
  }'`;

  const jsExample = `// Node.js / Browser fetch
const response = await fetch('${baseUrl}/api/external/crm/projects', {
  method: 'POST',
  headers: {
    'X-API-Key': process.env.CRM_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Casa Juan Pérez - Cali',
    client_name: 'Juan Pérez',
    client_email: 'juan@ejemplo.co',
    invoice_kwh_mensual: 450,
    source: 'meta_ads',
    external_id: 'lead-001', // si lo reintentas, no duplica
  }),
});
const data = await response.json();
// { ok: true, created: true, project: { id, code, ... } }`;

  const pythonExample = `import requests, os

resp = requests.post(
    '${baseUrl}/api/external/crm/projects',
    headers={
        'X-API-Key': os.environ['CRM_API_KEY'],
        'Content-Type': 'application/json',
    },
    json={
        'title': 'Casa Juan Pérez - Cali',
        'client_name': 'Juan Pérez',
        'client_email': 'juan@ejemplo.co',
        'invoice_kwh_mensual': 450,
        'source': 'hubspot',
        'external_id': 'deal-12345',
    },
)
print(resp.json())`;

  const runTest = async () => {
    setBusy(true); setResponse(null);
    try {
      const r = await fetch('/api/external/crm/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': tester.key },
        body: JSON.stringify({
          title: `TEST-${tester.name}`,
          client_name: tester.name,
          client_email: tester.email,
          client_city: tester.city,
          invoice_kwh_mensual: Number(tester.kwh) || null,
          source: 'configuracion-tester',
          external_id: `test-${Date.now()}`,
        }),
      });
      const j = await r.json();
      setResponse(JSON.stringify(j, null, 2));
    } catch (e) {
      setResponse(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Error' }, null, 2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DocBlock title="¿Para qué sirve?">
        Permite que otras apps (Meta Ads, HubSpot, formularios web, Make, n8n, Zapier) creen automáticamente cards en el CRM de Ventas sin que tengas que copiar a mano. El lead aparece en <code>/ventas</code> en la etapa <strong>Prospecto</strong> listo para ser trabajado.
      </DocBlock>

      <DocBlock title="1. Configurar la API key" icon={<Lock size={14} />}>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Genera una clave secreta de 32+ caracteres (Linux/Mac: <code>openssl rand -hex 32</code>; o usa cualquier generador online).</li>
          <li>Ve a <strong>Vercel → tu proyecto → Settings → Environment Variables</strong></li>
          <li>Agrega <code>CRM_API_KEY = &lt;tu clave&gt;</code>, marca Production y Preview</li>
          <li>Redeploy (cualquier push o forzando desde Vercel UI)</li>
          <li>Comparte la misma clave con la app externa — guárdala en su propio <code>.env</code></li>
        </ol>
        <p style={{ fontSize: '0.78rem', margin: '8px 0 0', color: 'var(--text-muted)' }}>
          <strong>Seguro por defecto:</strong> si <code>CRM_API_KEY</code> no está configurada, el endpoint rechaza TODAS las requests con 401. No hay forma de crear proyectos sin la key.
        </p>
      </DocBlock>

      <DocBlock title="2. Endpoint" icon={<Plug size={14} />}>
        <CodeBlock>POST {baseUrl}/api/external/crm/projects</CodeBlock>
        <p style={{ fontSize: '0.82rem', margin: '8px 0 6px' }}>Autenticación (uno de los dos):</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem' }}>
          <li>Header <code>X-API-Key: &lt;tu key&gt;</code></li>
          <li>Header <code>Authorization: Bearer &lt;tu key&gt;</code></li>
        </ul>
      </DocBlock>

      <DocBlock title="3. Campos del body">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Campo</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Tipo</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Descripción</th>
              </tr>
            </thead>
            <tbody>
              <FieldRow name="title" type="string" required>Título del proyecto. Aparece como el header del card.</FieldRow>
              <FieldRow name="external_id" type="string">ID en el sistema origen. Si ya existe un proyecto con este ID, retorna el existente (idempotencia, safe para retry).</FieldRow>
              <FieldRow name="source" type="string">Tag para tracking del origen: meta_ads, hubspot, formulario_web, n8n, etc. Se guarda en custom_data.</FieldRow>
              <FieldRow name="client_name" type="string">Nombre del contacto principal.</FieldRow>
              <FieldRow name="client_email" type="string">Email del contacto.</FieldRow>
              <FieldRow name="client_phone" type="string">Teléfono (acepta cualquier formato).</FieldRow>
              <FieldRow name="client_address" type="string">Dirección completa.</FieldRow>
              <FieldRow name="client_city" type="string">Ciudad.</FieldRow>
              <FieldRow name="client_doc_type" type="string">Tipo doc: CC, NIT, CE, etc.</FieldRow>
              <FieldRow name="client_doc_number" type="string">Número de documento.</FieldRow>
              <FieldRow name="estrato" type="integer">1-6.</FieldRow>
              <FieldRow name="tipo_vivienda" type="string">Casa unifamiliar, Apartamento, etc.</FieldRow>
              <FieldRow name="lat" type="number">Latitud GPS del sitio.</FieldRow>
              <FieldRow name="lng" type="number">Longitud GPS del sitio.</FieldRow>
              <FieldRow name="invoice_kwh_mensual" type="number">Consumo mensual en kWh (de la factura).</FieldRow>
              <FieldRow name="invoice_valor_cop" type="number">Valor mensual de la factura en COP.</FieldRow>
              <FieldRow name="assigned_to" type="string">Email del comercial responsable.</FieldRow>
              <FieldRow name="notes" type="string">Cualquier comentario libre.</FieldRow>
              <FieldRow name="created_by" type="string">Identificador del sistema que creó el lead (default: external-api).</FieldRow>
            </tbody>
          </table>
        </div>
      </DocBlock>

      <DocBlock title="4. Respuesta exitosa">
        <CodeBlock>{`HTTP 201 Created
{
  "ok": true,
  "created": true,
  "project": {
    "id": "uuid-...",
    "code": "PROJ-2026-0042",
    "title": "Casa Juan Pérez - Cali",
    "current_module": "sales",
    "sales_stage": "prospecto",
    "created_at": "2026-05-27T15:42:18.123Z"
  }
}`}</CodeBlock>
        <p style={{ fontSize: '0.78rem', margin: '8px 0 0', color: 'var(--text-muted)' }}>
          Si mandaste <code>external_id</code> y ya existía: <code>created: false</code> + el proyecto existente.
        </p>
      </DocBlock>

      <DocBlock title="5. Ejemplos">
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', padding: '6px 0', fontWeight: 600, fontSize: '0.82rem' }}>cURL (terminal)</summary>
          <CodeBlock>{curlExample}</CodeBlock>
        </details>
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', padding: '6px 0', fontWeight: 600, fontSize: '0.82rem' }}>JavaScript / Node.js</summary>
          <CodeBlock>{jsExample}</CodeBlock>
        </details>
        <details>
          <summary style={{ cursor: 'pointer', padding: '6px 0', fontWeight: 600, fontSize: '0.82rem' }}>Python</summary>
          <CodeBlock>{pythonExample}</CodeBlock>
        </details>
      </DocBlock>

      <DocBlock title="6. Leer datos de los 3 CRMs (Ventas / Ingeniería / Operaciones)" icon={<Server size={14} />}>
        <p style={{ fontSize: '0.82rem', margin: '0 0 8px' }}>
          Tenemos tres módulos CRM. Un mismo proyecto vive en uno a la vez, indicado por la columna <code>current_module</code>. Los stages se almacenan en columnas separadas (<code>sales_stage</code>, <code>engineering_stage</code>, <code>operations_stage</code>) para preservar historia.
        </p>
        <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', marginBottom: 10 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Módulo</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Etapas</th>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>Campos clave</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 10px', fontWeight: 600 }}>sales</td>
              <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>prospecto · levantamiento · propuesta · contrato · firmado</td>
              <td style={{ padding: '6px 10px', fontSize: '0.72rem' }}>client_*, invoice_kwh_mensual, invoice_valor_cop, propuesta_*, contrato_signed_at</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 10px', fontWeight: 600 }}>engineering</td>
              <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>pending · prefactibilidad_ok · dimensionamiento · aprobacion · aprobado</td>
              <td style={{ padding: '6px 10px', fontSize: '0.72rem' }}>diseno_kwp, diseno_paneles, diseno_inversor_categoria_id, diseno_aprobado_por, diseno_aprobado_at</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)', background: 'rgba(245,158,11,0.06)' }}>
              <td style={{ padding: '6px 10px', fontWeight: 700, color: '#f59e0b' }}>operations ←</td>
              <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>visita_previa · alistamiento · instalacion · operativo · legalizado</td>
              <td style={{ padding: '6px 10px', fontSize: '0.72rem' }}>visita_previa_id, visita_instalacion_id, reservation_id, contractor_name, contractor_email, installation_date, lectura_inicial_kwh, operativo_at, legalizado_at</td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: '0.82rem', margin: '10px 0 6px', fontWeight: 600 }}>Operaciones — ejemplo de polling desde la app externa</p>
        <CodeBlock>{`# 1. Lista TODOS los proyectos que están en Operaciones (cualquier etapa)
curl ${typeof window !== 'undefined' ? window.location.origin : 'https://sunnyhes.vercel.app'}/api/external/crm/projects?module=operations \\
  -H "X-API-Key: $CRM_API_KEY"

# 2. Sólo los listos para alistar equipos
curl '${typeof window !== 'undefined' ? window.location.origin : 'https://sunnyhes.vercel.app'}/api/external/crm/projects?module=operations&stage=alistamiento' \\
  -H "X-API-Key: $CRM_API_KEY"

# 3. Polling incremental (sólo los cambiados después de mi último sync)
curl '${typeof window !== 'undefined' ? window.location.origin : 'https://sunnyhes.vercel.app'}/api/external/crm/projects?module=operations&updated_since=2026-05-27T10:00:00Z' \\
  -H "X-API-Key: $CRM_API_KEY"

# 4. Detalle completo de un proyecto con visitas + reserva + items
curl '${typeof window !== 'undefined' ? window.location.origin : 'https://sunnyhes.vercel.app'}/api/external/crm/projects/PROYECTO_ID?include_events=1' \\
  -H "X-API-Key: $CRM_API_KEY"`}</CodeBlock>

        <p style={{ fontSize: '0.82rem', margin: '12px 0 6px', fontWeight: 600 }}>Respuesta (GET list)</p>
        <CodeBlock>{`{
  "ok": true,
  "count": 3,
  "projects": [
    {
      "id": "uuid-...",
      "code": "PROJ-2026-0042",
      "title": "Casa Juan Pérez - Cali",
      "current_module": "operations",
      "operations_stage": "alistamiento",
      "sales_stage": "completado",
      "engineering_stage": "completado",
      "client_name": "Juan Pérez",
      "client_city": "Cali",
      "diseno_kwp": 5.5,
      "diseno_paneles": 10,
      "reservation_id": "uuid-...",
      "contractor_name": null,
      "installation_date": null,
      "custom_data": { "external_id": "lead-001", "source": "meta_ads" },
      "updated_at": "2026-05-27T15:30:00Z"
    },
    ...
  ]
}`}</CodeBlock>

        <div className="alert-warning" style={{ fontSize: '0.78rem', marginTop: 10 }}>
          <strong>Para Operaciones específicamente:</strong> usa <code>module=operations</code> y filtra por <code>stage</code> según necesites:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            <li><code>visita_previa</code> — Ingeniería pidió visita, hay que ir al sitio</li>
            <li><code>alistamiento</code> — diseño aprobado, hay que preparar equipos (revisa <code>reservation_id</code>)</li>
            <li><code>instalacion</code> — hay contratista asignado, en proceso</li>
            <li><code>operativo</code> — sistema instalado y midiendo</li>
            <li><code>legalizado</code> — listo, papeleo cerrado</li>
          </ul>
        </div>
      </DocBlock>

      <DocBlock title="7. Probar en vivo" icon={<Send size={14} />}>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Crea un proyecto de prueba ahora mismo para verificar que tu key funciona. El proyecto aparecerá en <code>/ventas</code> con el título "TEST-...".
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 }}>
          <input type="text" placeholder="Tu CRM_API_KEY" value={tester.key} onChange={(e) => setTester({ ...tester, key: e.target.value })} style={{ fontFamily: 'ui-monospace, monospace' }} />
          <input type="text" placeholder="Nombre cliente" value={tester.name} onChange={(e) => setTester({ ...tester, name: e.target.value })} />
          <input type="text" placeholder="Email" value={tester.email} onChange={(e) => setTester({ ...tester, email: e.target.value })} />
          <input type="text" placeholder="Ciudad" value={tester.city} onChange={(e) => setTester({ ...tester, city: e.target.value })} />
          <input type="text" placeholder="kWh/mes" value={tester.kwh} onChange={(e) => setTester({ ...tester, kwh: e.target.value })} />
        </div>
        <button onClick={runTest} disabled={busy || !tester.key} className="primary-btn" style={{ fontSize: '0.82rem' }}>
          <Send size={12} /> {busy ? 'Enviando…' : 'Crear proyecto de prueba'}
        </button>
        {response && <CodeBlock style={{ marginTop: 10 }}>{response}</CodeBlock>}
      </DocBlock>
    </div>
  );
}

/* ───── Sección 2: lista de endpoints internos ───── */
function InternalApiSection() {
  return (
    <div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Endpoints que la app usa internamente. <strong>session</strong> = requiere sesión de usuario activa en SUNNY APP (cookies de Supabase Auth). <strong>key</strong> = requiere env var como <code>CRON_SECRET</code> o <code>CRM_API_KEY</code>. <strong>none</strong> = público.
      </p>

      <h3 style={{ fontSize: '0.92rem', margin: '14px 0 6px' }}>Externos (key-based)</h3>
      <EndpointTable endpoints={ENDPOINTS_PUBLIC} />

      <h3 style={{ fontSize: '0.92rem', margin: '20px 0 6px' }}>Internos (session-based)</h3>
      <EndpointTable endpoints={ENDPOINTS_INTERNAL} />

      <div className="alert-warning" style={{ fontSize: '0.78rem', marginTop: 14 }}>
        <strong>Nota:</strong> los endpoints internos usan cookies de sesión Supabase. No se pueden llamar desde otra app sin un usuario autenticado. Si necesitas un endpoint público para integrar, usa <code>/api/external/...</code> o pídeme que cree uno con auth de key.
      </div>
    </div>
  );
}

function EndpointTable({ endpoints }: { endpoints: EndpointDef[] }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-elevated)' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', width: 70 }}>Method</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Ruta</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', width: 90 }}>Auth</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Qué hace</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((e, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 10px' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', fontWeight: 700, color: methodColor(e.method), background: methodColor(e.method) + '20', padding: '2px 8px', borderRadius: 4 }}>{e.method}</span>
              </td>
              <td style={{ padding: '8px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>{e.path}</td>
              <td style={{ padding: '8px 10px' }}>
                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: e.auth === 'none' ? '#dcfce7' : e.auth === 'key' ? '#fef3c7' : '#dbeafe', color: e.auth === 'none' ? '#166534' : e.auth === 'key' ? '#92400e' : '#1e40af', fontWeight: 600 }}>
                  {e.auth}
                </span>
              </td>
              <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                {e.desc}
                {e.notes && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{e.notes}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───── Sección 3: módulos y arquitectura ───── */
function ModulesSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DocBlock title="Stack">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', lineHeight: 1.7 }}>
          <li><strong>Frontend:</strong> Next.js 16 (App Router) + React 19 + TypeScript</li>
          <li><strong>Base de datos:</strong> Supabase Postgres (13+ tablas, audit log completo)</li>
          <li><strong>Auth:</strong> Supabase Auth (email + password, dominio @gdo.com.co / @promigas.com)</li>
          <li><strong>Storage:</strong> Supabase Storage (bucket privado <code>visit-photos</code> + signed URLs)</li>
          <li><strong>Backend de datos:</strong> Metrum (ThingsBoard) — 28 casas × 4 devices = 112 dispositivos</li>
          <li><strong>Crons:</strong> Vercel Cron diario (06:00 UTC) + GitHub Actions cada 15 min (lazo instantáneo)</li>
          <li><strong>Hosting:</strong> Vercel (auto-deploy desde main)</li>
        </ul>
      </DocBlock>

      <DocBlock title="Módulos">
        <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Módulo</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Ruta</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Qué hace</th>
            </tr>
          </thead>
          <tbody>
            <ModRow path="/inicio" name="Inicio">Landing con diagramas de arquitectura + flujos + widget de status de crons en vivo.</ModRow>
            <ModRow path="/dashboard" name="HES Head End System">Operación diaria de la flota: cierres, vista granular interactiva, CREG mensual, alertas por casa, control manual de inversor.</ModRow>
            <ModRow path="/ventas" name="CRM Ventas">Kanban Pipefy-style de 5 etapas. Al firmar, handoff automático a Ingeniería.</ModRow>
            <ModRow path="/ingenieria" name="Ingeniería">Calculadora de dimensionamiento + workflow de 5 etapas. Solicita visita previa a Operaciones, aprueba diseño.</ModRow>
            <ModRow path="/operaciones" name="Operaciones">Visita previa, alistamiento de inventario (reserva auto), instalación con contratista, operativo, legalizado.</ModRow>
            <ModRow path="/funnel" name="Funnel">Vista agregada de todos los proyectos: KPIs, tasas de conversión, distribución por etapa.</ModRow>
            <ModRow path="/visitas" name="Visitas en Campo">4 tipos de acta (previa, instalación, emergencia, normalización) con fotos, GPS, PDF y handoff bidireccional con inventario.</ModRow>
            <ModRow path="/inventario" name="Inventario (WMS-lite)">Equipos por serial, consumibles con stock bajo, ubicaciones jerárquicas, reservas por visita, audit log completo.</ModRow>
            <ModRow path="/reportes" name="Reportes">6 reportes (ejecutivo, operación, CREG, alertas, inventario, pipeline) con descarga CSV + vista imprimible.</ModRow>
            <ModRow path="/alertas" name="Configuración Alertas">CRUD de reglas. 40+ variables agrupadas en 6 categorías. Evaluador automático cada 15 min y diario.</ModRow>
            <ModRow path="/configuracion" name="Configuración API">Conexión Metrum, visibilidad del menú, esta documentación.</ModRow>
          </tbody>
        </table>
      </DocBlock>

      <DocBlock title="Flujos de datos">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', lineHeight: 1.7 }}>
          <li><strong>06:00 UTC diario:</strong> Vercel Cron → /api/cron/sync → trae cierres del día anterior, recalcula daily_casa_metrics, evalúa reglas diarias y mensuales (CREG).</li>
          <li><strong>Cada 15 min:</strong> GitHub Actions → /api/cron/instant-check → trae powerAI/RI, corrientes, voltajes, SOC batería; calcula cos φ y desbalances; evalúa reglas instantáneas + agregadas 24h.</li>
          <li><strong>Visita instalación completada:</strong> el evaluador busca seriales del form, los marca como installed en la casa + crea movimiento en inventory_movements.</li>
          <li><strong>Reserva confirmada + visita instalación:</strong> al cerrar la visita, los items reservados pasan directo a installed (no hay que tipear seriales).</li>
          <li><strong>Sales firmado:</strong> handoff automático a Engineering. Engineering pide previa → Operations. Operations cierra → Engineering. Engineering aprueba → Operations. Operations legaliza → Closed.</li>
        </ul>
      </DocBlock>
    </div>
  );
}

/* ───── Helpers de presentación ───── */
function DocBlock({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {icon}
        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>{title}</h3>
      </div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function CodeBlock({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const copy = () => {
    if (typeof children === 'string') {
      navigator.clipboard?.writeText(children).catch(() => {});
    }
  };
  return (
    <div style={{ position: 'relative', ...style }}>
      <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', fontSize: '0.74rem', fontFamily: 'ui-monospace, monospace', overflow: 'auto', margin: 0, lineHeight: 1.5, color: 'var(--text-primary)' }}>{children}</pre>
      {typeof children === 'string' && (
        <button onClick={copy} title="Copiar" style={{ position: 'absolute', top: 8, right: 8, padding: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Copy size={12} />
        </button>
      )}
    </div>
  );
}

function FieldRow({ name, type, required, children }: { name: string; type: string; required?: boolean; children: React.ReactNode }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
        {name}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </td>
      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{type}</td>
      <td style={{ padding: '6px 10px', fontSize: '0.76rem' }}>{children}</td>
    </tr>
  );
}

function ModRow({ path, name, children }: { path: string; name: string; children: React.ReactNode }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 10px', fontWeight: 600, fontSize: '0.8rem' }}>{name}</td>
      <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', color: 'var(--accent)' }}>{path}</td>
      <td style={{ padding: '6px 10px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{children}</td>
    </tr>
  );
}

/* ---------------- Visibility del menú lateral ---------------- */
function SidebarVisibilityCard() {
  const [vis, setVis] = useState<SidebarVisibility>({});

  useEffect(() => { setVis(readVisibility()); }, []);

  const toggle = (id: keyof SidebarVisibility) => {
    if (ALWAYS_VISIBLE_IDS.has(id)) return;
    const cur = (vis[id] !== false);
    const next = { ...vis, [id]: !cur };
    setVis(next);
    writeVisibility(next);
  };

  const resetAll = () => {
    const empty: SidebarVisibility = {};
    setVis(empty);
    writeVisibility(empty);
  };

  const general = MENU_ITEM_CATALOG.filter((i) => i.group === 'general');
  const sistema = MENU_ITEM_CATALOG.filter((i) => i.group === 'sistema');

  return (
    <div className="glass-panel" style={{ marginTop: 20 }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={18} style={{ color: 'var(--text-secondary)' }} />
          <h2 className="card-title">Visibilidad del menú lateral</h2>
        </div>
      </div>
      <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
        Oculta secciones que no usas para tener un menú más limpio. Esta preferencia se guarda en este navegador. Inicio y Configuración API siempre quedan visibles (escape hatch).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
        <VisibilityGroup label="General" items={general} vis={vis} onToggle={toggle} />
        <VisibilityGroup label="Sistema" items={sistema} vis={vis} onToggle={toggle} />
      </div>

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={resetAll} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
          <RefreshCw size={12} /> Mostrar todos
        </button>
      </div>
    </div>
  );
}

function VisibilityGroup({ label, items, vis, onToggle }: {
  label: string;
  items: typeof MENU_ITEM_CATALOG;
  vis: SidebarVisibility;
  onToggle: (id: keyof SidebarVisibility) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => {
          const locked = ALWAYS_VISIBLE_IDS.has(it.id);
          const visible = vis[it.id] !== false;
          return (
            <label key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: locked ? 'not-allowed' : 'pointer',
              opacity: locked ? 0.6 : 1,
            }}>
              <input
                type="checkbox"
                checked={visible}
                disabled={locked}
                onChange={() => onToggle(it.id)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ flex: 1, fontSize: '0.86rem', fontWeight: visible ? 600 : 500, color: visible ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {it.label}
              </span>
              {locked ? (
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>Siempre visible</span>
              ) : visible ? (
                <Eye size={14} style={{ color: 'var(--accent)' }} />
              ) : (
                <EyeOff size={14} style={{ color: 'var(--text-muted)' }} />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- TAB: Conexión ---------------- */

interface SyncStats {
  total: number;
  inverters: number;
  meters: number;
  gateways: number;
  lastSeen: string | null;
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) return 'Sin datos';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
};

const relativeTime = (iso: string | null): string => {
  if (!iso) return '';
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'hace instantes';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
};

function ConexionTab() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  const loadStats = async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('type, name, marca, modelo, last_seen_at');
    if (error) {
      console.error(error);
      return;
    }
    const rows = data ?? [];
    let inverters = 0, meters = 0, gateways = 0;
    let lastSeen: string | null = null;
    for (const r of rows) {
      const cat = classifyDevice(r as { type: string | null; name: string | null; marca: string | null; modelo: string | null });
      if (cat === 'inverter') inverters++;
      else if (cat === 'meter') meters++;
      else if (cat === 'gateway') gateways++;
      if (r.last_seen_at && (!lastSeen || r.last_seen_at > lastSeen)) lastSeen = r.last_seen_at;
    }
    setStats({ total: rows.length, inverters, meters, gateways, lastSeen });
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/metrum/devices');
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setConnectionOk(true);
      setMsg({ kind: 'success', text: `Conexión OK · ${json.raw?.totalElements ?? 0} entidades visibles en Metrum.` });
    } catch (e) {
      setConnectionOk(false);
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch('/api/devices/sync');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error');
      setMsg({ kind: 'success', text: `Sincronización completa · ${json.inserted ?? 0} dispositivos.` });
      await loadStats();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} className="text-accent" />
            <h2 className="card-title">Conexión API Metrum</h2>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">URL Base</label>
          <input type="text" readOnly value="https://monitoreo-metrum.com" />
        </div>

        <div className="input-group">
          <label className="input-label">Usuario (Email)</label>
          <input type="email" readOnly value="davider@gdo.com.co" />
        </div>

        <div className="input-group">
          <label className="input-label">Contraseña</label>
          <input type="password" readOnly value="••••••••••••••" />
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Las credenciales se configuran vía variables de entorno (<code>METRUM_USERNAME</code> / <code>METRUM_PASSWORD</code>) en el servidor.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="secondary-btn" onClick={handleTest} disabled={testing}>
            <Key size={14} /> {testing ? 'Probando...' : 'Probar conexión'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {connectionOk === true && (
          <div className="alert-success">
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '2px' }}>Conexión establecida</strong>
              <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>
                El token JWT actual es válido. La comunicación con la API REST de Metrum está operativa.
              </span>
            </div>
          </div>
        )}
        {connectionOk === false && (
          <div className="alert-error">
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '2px' }}>Sin conexión</strong>
              <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>
                No se pudo autenticar contra Metrum. Verifica credenciales en el servidor.
              </span>
            </div>
          </div>
        )}

        {msg && msg.kind === 'success' && connectionOk === null && (
          <div className="alert-success">{msg.text}</div>
        )}
        {msg && msg.kind === 'error' && (
          <div className="alert-error">{msg.text}</div>
        )}

        <div className="glass-panel" style={{ flex: 1 }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} style={{ color: 'var(--text-secondary)' }} />
              <h2 className="card-title">Sincronización de datos</h2>
            </div>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            La sincronización lee los dispositivos visibles para el usuario en Metrum y persiste sus atributos (marca, modelo, ubicación, etc.) en Supabase.
          </p>

          <div className="table-container" style={{ marginBottom: '16px' }}>
            <table>
              <tbody>
                <tr>
                  <td style={{ width: '50%', color: 'var(--text-muted)' }}>Última actividad registrada</td>
                  <td>
                    <strong>{formatDateTime(stats?.lastSeen ?? null)}</strong>
                    {stats?.lastSeen && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.8rem' }}>({relativeTime(stats.lastSeen)})</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)' }}>Total dispositivos</td>
                  <td><strong>{stats?.total ?? '—'}</strong></td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)' }}>Desglose</td>
                  <td>
                    {stats
                      ? `${stats.inverters} Inversores · ${stats.meters} Medidores · ${stats.gateways} Módems`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button className="primary-btn" onClick={handleSync} disabled={syncing} style={{ width: '100%' }}>
            <RefreshCw size={14} /> {syncing ? 'Sincronizando...' : 'Forzar sincronización manual'}
          </button>
        </div>
      </div>
    </div>
  );
}

