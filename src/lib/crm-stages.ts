/**
 * Definiciones compartidas de etapas para los 3 módulos:
 * CRM Ventas, Ingeniería, Operaciones.
 *
 * Las "transiciones permitidas" se validan en la API de transition;
 * acá la UI las usa para saber qué botón mostrar y qué campos pedir.
 */

export type SalesStage = 'prospecto' | 'levantamiento' | 'propuesta' | 'contrato' | 'firmado' | 'completado';
export type EngineeringStage = 'pending' | 'prefactibilidad_ok' | 'dimensionamiento' | 'aprobacion' | 'aprobado' | 'completado';
export type OperationsStage = 'pending' | 'dimensionamiento' | 'alistamiento' | 'instalacion' | 'operativo' | 'legalizado' | 'completado';
export type CrmModule = 'sales' | 'engineering' | 'operations' | 'closed';

export interface StageMeta {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}

export const SALES_STAGES: StageMeta[] = [
  { key: 'prospecto',     label: '1. Prospecto',     shortLabel: 'Prospecto',     color: '#94a3b8', description: 'Contacto inicial. Cliente potencial sin información detallada todavía.' },
  { key: 'levantamiento', label: '2. Levantamiento', shortLabel: 'Levantamiento', color: '#3b82f6', description: 'Recopilando factura, valores mensuales, ubicación y datos del cliente.' },
  { key: 'propuesta',     label: '3. Propuesta',     shortLabel: 'Propuesta',     color: '#8b5cf6', description: 'Propuesta comercial preparada con kWp y valor estimado.' },
  { key: 'contrato',      label: '4. Oferta/Contrato', shortLabel: 'Contrato',    color: '#f59e0b', description: 'Oferta y contrato enviados al cliente, esperando firma.' },
  { key: 'firmado',       label: '5. Firmado',       shortLabel: 'Firmado',       color: '#10b981', description: 'Contrato firmado por el cliente. Listo para handoff a Ingeniería.' },
];

export const ENGINEERING_STAGES: StageMeta[] = [
  { key: 'pending',              label: '1. Pendiente prefactibilidad', shortLabel: 'Pend. prefactibilidad', color: '#94a3b8', description: 'Recién recibido de Ventas. Falta levantar la visita previa en sitio.' },
  { key: 'prefactibilidad_ok',   label: '2. Prefactibilidad OK',       shortLabel: 'Prefactibilidad OK',    color: '#3b82f6', description: 'La visita previa de Operaciones está completa, ya se puede dimensionar.' },
  { key: 'dimensionamiento',     label: '3. Dimensionamiento',         shortLabel: 'Dimensionamiento',      color: '#8b5cf6', description: 'Calculando el sistema (kWp, paneles, inversor, batería) y verificando inventario.' },
  { key: 'aprobacion',           label: '4. Pendiente aprobación',     shortLabel: 'Aprobación',            color: '#f59e0b', description: 'Diseño listo, esperando firma de aprobación del ingeniero senior.' },
  { key: 'aprobado',             label: '5. Aprobado',                 shortLabel: 'Aprobado',              color: '#10b981', description: 'Diseño aprobado. Handoff a Operaciones para alistamiento e instalación.' },
];

export const OPERATIONS_STAGES: StageMeta[] = [
  { key: 'dimensionamiento', label: '1. Dimensionamiento', shortLabel: 'Dimensionamiento', color: '#94a3b8', description: 'Diseño aprobado por Ingeniería. Revisar paneles, inversor, baterías y responsable antes de iniciar alistamiento.' },
  { key: 'alistamiento',     label: '2. Alistamiento',     shortLabel: 'Alistamiento',     color: '#3b82f6', description: 'Reservar equipos en inventario con los SKUs del diseño y verificar disponibilidad física antes de despachar.' },
  { key: 'instalacion',      label: '3. Instalación',      shortLabel: 'Instalación',      color: '#8b5cf6', description: 'Contratista seleccionado, instalación en curso. Visita de instalación enlazada en /visitas.' },
  { key: 'operativo',        label: '4. Operativo',        shortLabel: 'Operativo',        color: '#f59e0b', description: 'Sistema instalado y generando. Lectura inicial registrada, conectado a Metrum.' },
  { key: 'legalizado',       label: '5. Legalizado',       shortLabel: 'Legalizado',       color: '#10b981', description: 'Papeleo cerrado: actas, garantías, normalización con el operador de red.' },
];

export const MODULE_META: Record<CrmModule, { label: string; color: string; href: string }> = {
  sales:       { label: 'CRM Ventas',   color: '#3b82f6', href: '/ventas' },
  engineering: { label: 'Ingeniería',   color: '#8b5cf6', href: '/ingenieria' },
  operations: { label: 'Operaciones',   color: '#f59e0b', href: '/operaciones' },
  closed:      { label: 'Cerrado',      color: '#10b981', href: '/' },
};

/**
 * Transición permitida = mapping de la acción al cambio que aplica.
 * Cada acción dice qué módulo/etapa quedará después.
 * El endpoint /api/crm/projects/[id]/transition valida y aplica.
 */
export interface TransitionDef {
  action: string;
  label: string;
  buttonLabel: string;
  fromModule: CrmModule;
  fromStage: string;
  toModule: CrmModule;
  toStage: string;
  /** Campos que se piden al ejecutar esta transición */
  requiredFields: Array<{
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'email' | 'url' | 'select';
    options?: string[];
    required?: boolean;
    placeholder?: string;
    help?: string;
  }>;
  /** Lo que aparece como `notes` en el evento al ejecutarse */
  noteTemplate?: string;
  /** Si true, NO marca el stage del fromModule como 'completado' al salir.
   *  Útil cuando el módulo está pausado esperando que otro módulo le devuelva
   *  el control (ej: engineering solicita previa a ops y se queda en 'pending'). */
  keepSourceStage?: boolean;
}

const f = (
  key: string, label: string, type: TransitionDef['requiredFields'][number]['type'],
  required = true, extra: Partial<TransitionDef['requiredFields'][number]> = {},
) => ({ key, label, type, required, ...extra });

export const TRANSITIONS: TransitionDef[] = [
  // ─── VENTAS ───
  {
    action: 'sales_to_levantamiento',
    label: 'Avanzar a Levantamiento',
    buttonLabel: 'Iniciar levantamiento →',
    fromModule: 'sales', fromStage: 'prospecto', toModule: 'sales', toStage: 'levantamiento',
    requiredFields: [
      f('client_name', 'Nombre del cliente', 'text'),
      f('client_phone', 'Teléfono', 'text'),
      f('client_email', 'Email', 'email', false),
    ],
  },
  {
    action: 'sales_to_propuesta',
    label: 'Avanzar a Propuesta',
    buttonLabel: 'Pasar a propuesta →',
    fromModule: 'sales', fromStage: 'levantamiento', toModule: 'sales', toStage: 'propuesta',
    requiredFields: [
      f('invoice_kwh_mensual', 'Consumo mensual (kWh)', 'number', true, { placeholder: 'Ej: 450' }),
      f('invoice_valor_cop', 'Valor mensual (COP)', 'number', true, { placeholder: 'Ej: 380000' }),
      f('client_address', 'Dirección', 'textarea'),
      f('client_city', 'Ciudad', 'text'),
      f('estrato', 'Estrato', 'select', false, { options: ['1', '2', '3', '4', '5', '6'] }),
      f('tipo_vivienda', 'Tipo de vivienda', 'select', false, { options: ['Casa unifamiliar', 'Apartamento', 'Casa en conjunto', 'Local comercial', 'Otro'] }),
    ],
  },
  {
    action: 'sales_to_contrato',
    label: 'Avanzar a Contrato',
    buttonLabel: 'Enviar oferta/contrato →',
    fromModule: 'sales', fromStage: 'propuesta', toModule: 'sales', toStage: 'contrato',
    requiredFields: [
      f('propuesta_kwp', 'kWp propuestos', 'number', true, { placeholder: 'Ej: 5' }),
      f('propuesta_valor_cop', 'Valor total propuesta (COP)', 'number', true),
      f('propuesta_url', 'URL del PDF de propuesta', 'url', false),
      f('contrato_url', 'URL del PDF del contrato', 'url', false),
      f('oferta_url', 'URL del PDF de la oferta', 'url', false),
    ],
  },
  {
    action: 'sales_to_firmado',
    label: 'Marcar Firmado',
    buttonLabel: 'Cliente firmó →',
    fromModule: 'sales', fromStage: 'contrato', toModule: 'sales', toStage: 'firmado',
    requiredFields: [
      f('contrato_signed_at', 'Fecha de firma', 'date'),
    ],
  },
  {
    action: 'sales_handoff_engineering',
    label: 'Enviar a Ingeniería',
    buttonLabel: 'Handoff a Ingeniería →',
    fromModule: 'sales', fromStage: 'firmado', toModule: 'engineering', toStage: 'pending',
    requiredFields: [],
    noteTemplate: 'Ventas cerró. Pasa a Ingeniería para prefactibilidad.',
  },

  // ─── INGENIERÍA ───
  // Ingeniería gestiona internamente si necesita visita previa (la crea en /visitas
  // vinculada al proyecto sin cambiar de módulo). Cuando ya tiene la info en sitio,
  // marca prefactibilidad lista.
  {
    action: 'engineering_pending_to_prefactibilidad_ok',
    label: 'Marcar prefactibilidad lista',
    buttonLabel: 'Prefactibilidad lista →',
    fromModule: 'engineering', fromStage: 'pending', toModule: 'engineering', toStage: 'prefactibilidad_ok',
    requiredFields: [
      f('visita_previa_id', 'ID de la visita previa en /visitas', 'text', false, { help: 'Opcional: UUID del acta de prefactibilidad si la levantaste en /visitas.' }),
    ],
    noteTemplate: 'Prefactibilidad lista. Listo para dimensionar.',
  },
  {
    action: 'engineering_to_dimensionamiento',
    label: 'Iniciar dimensionamiento',
    buttonLabel: 'Dimensionar sistema →',
    fromModule: 'engineering', fromStage: 'prefactibilidad_ok', toModule: 'engineering', toStage: 'dimensionamiento',
    requiredFields: [],
  },
  {
    action: 'engineering_to_aprobacion',
    label: 'Enviar a aprobación',
    buttonLabel: 'Listo para aprobar →',
    fromModule: 'engineering', fromStage: 'dimensionamiento', toModule: 'engineering', toStage: 'aprobacion',
    requiredFields: [
      f('diseno_kwp', 'kWp finales', 'number'),
      f('diseno_paneles', 'Cantidad de paneles', 'number'),
      f('diseno_baterias_cantidad', 'Cantidad de baterías', 'number', false),
      f('diseno_yield_estimado_kwh_mes', 'Yield estimado (kWh/mes)', 'number', false),
      f('diseno_notes', 'Notas del diseño', 'textarea', false),
    ],
  },
  {
    action: 'engineering_aprobar',
    label: 'Aprobar diseño',
    buttonLabel: 'Aprobar y enviar a Operaciones →',
    fromModule: 'engineering', fromStage: 'aprobacion', toModule: 'operations', toStage: 'dimensionamiento',
    requiredFields: [
      f('diseno_aprobado_por', 'Responsable / aprobado por', 'text', true, { placeholder: 'Nombre completo o email' }),
    ],
    noteTemplate: 'Diseño aprobado. Operaciones recibe la ficha de dimensionamiento.',
  },

  // ─── OPERACIONES ───
  {
    action: 'operations_dimensionamiento_to_alistamiento',
    label: 'Iniciar alistamiento',
    buttonLabel: 'Iniciar alistamiento →',
    fromModule: 'operations', fromStage: 'dimensionamiento', toModule: 'operations', toStage: 'alistamiento',
    requiredFields: [],
    noteTemplate: 'Dimensionamiento revisado. Alistando equipos.',
  },
  {
    action: 'operations_to_instalacion',
    label: 'Iniciar instalación',
    buttonLabel: 'Instalar →',
    fromModule: 'operations', fromStage: 'alistamiento', toModule: 'operations', toStage: 'instalacion',
    requiredFields: [
      f('contractor_name', 'Contratista', 'text'),
      f('contractor_email', 'Email del contratista', 'email', false),
      f('installation_date', 'Fecha de instalación', 'date'),
      f('reservation_id', 'ID reserva inventario', 'text', false, { help: 'UUID de la reserva confirmada en /inventario (opcional pero recomendado).' }),
    ],
  },
  {
    action: 'operations_to_operativo',
    label: 'Marcar operativo',
    buttonLabel: 'Sistema generando →',
    fromModule: 'operations', fromStage: 'instalacion', toModule: 'operations', toStage: 'operativo',
    requiredFields: [
      f('lectura_inicial_kwh', 'Lectura inicial (kWh)', 'number'),
      f('visita_instalacion_id', 'ID visita instalación', 'text', false, { help: 'UUID del acta de instalación en /visitas.' }),
    ],
  },
  {
    action: 'operations_to_legalizado',
    label: 'Legalizar',
    buttonLabel: 'Cerrar proyecto →',
    fromModule: 'operations', fromStage: 'operativo', toModule: 'closed', toStage: 'completado',
    requiredFields: [
      f('legalizado_at', 'Fecha de legalización', 'date'),
    ],
    noteTemplate: 'Proyecto legalizado y cerrado.',
  },
];

export const findTransition = (action: string) => TRANSITIONS.find((t) => t.action === action);

/** Transiciones disponibles desde el estado actual */
export const transitionsFrom = (currentModule: CrmModule, currentStage: string): TransitionDef[] =>
  TRANSITIONS.filter((t) => t.fromModule === currentModule && t.fromStage === currentStage);
