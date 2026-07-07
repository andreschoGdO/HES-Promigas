/**
 * Definiciones compartidas de etapas para Operaciones.
 *
 * El CRM en esta versión está reducido a un solo módulo activo (Operaciones)
 * más el estado de cierre. Los módulos previos (Ventas, Ingeniería) y sus
 * etapas fueron retirados — las columnas `sales_stage` y `engineering_stage`
 * permanecen en la BD por compatibilidad pero ya no se usan en la UI.
 */

export type OperationsStage =
  | 'pending'
  | 'dimensionado'
  | 'alistamiento'
  | 'instalacion'
  | 'legalizacion'
  | 'operativo'
  | 'logistica_inversa'
  | 'desistido'
  | 'sin_renovacion'
  | 'completado';
export type CrmModule = 'operations' | 'closed';

export interface StageMeta {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}

export const OPERATIONS_STAGES: StageMeta[] = [
  { key: 'dimensionado',     label: '1. Dimensionado',     shortLabel: 'Dimensionado',     color: '#94a3b8', description: 'Card con cliente, conjunto, dirección, dimensionamiento (paneles, inversor, batería) y responsable.' },
  { key: 'alistamiento',     label: '2. Alistamiento',     shortLabel: 'Alistamiento',     color: '#3b82f6', description: 'Reservar equipos en inventario con los SKUs del diseño y verificar disponibilidad física antes de despachar.' },
  { key: 'instalacion',      label: '3. Instalación',      shortLabel: 'Instalación',      color: '#8b5cf6', description: 'Contratista seleccionado, instalación en curso. Visita de instalación enlazada en /visitas.' },
  { key: 'operativo',        label: '4. Operativo',        shortLabel: 'Operativo',        color: '#10b981', description: 'Sistema instalado y generando. Lectura inicial registrada, conectado a Metrum.' },
  { key: 'legalizacion',     label: '5. Legalización',     shortLabel: 'Legalización',     color: '#0ea5e9', description: 'Trámite AGPE en curso para habilitar venta de excedentes. El sistema sigue OPERATIVO — solo queda registro de que se legalizó al volver.' },
  { key: 'desistido',        label: '6. Desistido',        shortLabel: 'Desistido',        color: '#f97316', description: 'Cliente desistió del proyecto antes o durante. Equipos se recuperan a bodega.' },
  { key: 'sin_renovacion',   label: '7. Sin renovación',   shortLabel: 'No renovado',      color: '#64748b', description: 'Fin del contrato — cliente no renueva. Equipos se retiran y se devuelven a bodega para reuso.' },
];
// Nota (mig 47): la etapa 'logistica_inversa' fue retirada del kanban.
// Garantía y cambio de equipos ahora se gestionan desde /inventario por
// equipo (status 'in_repair' / 'rma'). El tipo OperationsStage la mantiene
// como valor válido histórico para compatibilidad con eventos y logs viejos.

export const MODULE_META: Record<CrmModule, { label: string; color: string; href: string }> = {
  operations: { label: 'Construcción', color: '#f59e0b', href: '/operaciones' },
  closed:     { label: 'Cerrado',     color: '#10b981', href: '/' },
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
  keepSourceStage?: boolean;
  /** Marca transiciones que devuelven a una etapa anterior. La UI las renderiza
   *  distinto (secundarias) y no las muestra en el footer del card del Kanban. */
  direction?: 'backward';
}

const f = (
  key: string, label: string, type: TransitionDef['requiredFields'][number]['type'],
  required = true, extra: Partial<TransitionDef['requiredFields'][number]> = {},
) => ({ key, label, type, required, ...extra });

export const TRANSITIONS: TransitionDef[] = [
  // ─── OPERACIONES ───
  {
    action: 'operations_dimensionado_to_alistamiento',
    label: 'Iniciar alistamiento',
    buttonLabel: 'Iniciar alistamiento →',
    fromModule: 'operations', fromStage: 'dimensionado', toModule: 'operations', toStage: 'alistamiento',
    requiredFields: [],
    noteTemplate: 'Dimensionado revisado. Alistando equipos.',
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
    noteTemplate: 'Instalación completada. Sistema generando.',
  },
  // Legalización (AGPE) ahora vive DESPUÉS de operativo. La casa sigue
  // generando durante el trámite; al volver a operativo queda el registro
  // de que ya está legalizada (agpe_fecha_aprobacion + agpe_estado='Aprobado').
  {
    action: 'operativo_to_legalizacion',
    label: 'Iniciar legalización (AGPE)',
    buttonLabel: 'Legalizar →',
    fromModule: 'operations', fromStage: 'operativo', toModule: 'operations', toStage: 'legalizacion',
    requiredFields: [
      f('agpe_operador_red', 'Operador de red', 'select', true, { options: ['EPSA', 'EMCALI', 'AIR-E', 'AFINIA', 'ENEL', 'ELECTRICARIBE', 'Otro'] }),
      f('agpe_estado', 'Estado del trámite', 'select', true, { options: ['Con visita', 'Radicado', 'En revisión', 'Legalizada'] }),
      f('agpe_fecha_estimada', 'Fecha estimada de aprobación', 'date', false),
    ],
    noteTemplate: 'Iniciado trámite AGPE. Sistema sigue operativo.',
  },
  {
    action: 'legalizacion_to_operativo',
    label: 'Cerrar legalización (aprobado)',
    buttonLabel: 'Legalización aprobada →',
    fromModule: 'operations', fromStage: 'legalizacion', toModule: 'operations', toStage: 'operativo',
    requiredFields: [
      f('agpe_fecha_aprobacion', 'Fecha de aprobación AGPE', 'date'),
    ],
    noteTemplate: 'AGPE aprobado. Casa habilitada para venta de excedentes.',
  },
  // ─── NUEVAS ETAPAS POST-OPERATIVO ───
  // Nota: la transición Operativo → Cerrado se eliminó por diseño. Los
  // proyectos exitosos permanecen en Operativo indefinidamente (el sistema
  // sigue generando). Solo entran a 'closed' por desistimiento, fin de
  // contrato o cancelación explícita (botón Cancelar en el detalle).
  //
  // Garantía / cambio de equipos (mig 47): las transiciones
  // operations_to_logistica_inversa y logistica_inversa_to_operativo se
  // retiraron. Los tickets de garantía viven en /inventario por equipo.
  //
  // Desistido: cliente desistió. Se cierra y se cancela el proyecto.
  {
    action: 'operations_to_desistido',
    label: 'Marcar como desistido',
    buttonLabel: 'Cliente desistió →',
    fromModule: 'operations', fromStage: 'operativo', toModule: 'closed', toStage: 'desistido',
    requiredFields: [
      f('cancellation_reason', 'Motivo del desistimiento', 'textarea'),
    ],
    noteTemplate: 'Cliente desistió. Iniciar logística inversa de recuperación de equipos.',
  },
  {
    action: 'dimensionado_to_desistido',
    label: 'Desistido antes de instalar',
    buttonLabel: 'Cliente desistió →',
    fromModule: 'operations', fromStage: 'dimensionado', toModule: 'closed', toStage: 'desistido',
    requiredFields: [
      f('cancellation_reason', 'Motivo', 'textarea'),
    ],
    noteTemplate: 'Desistimiento previo a instalación.',
  },
  // Sin renovación: contrato termina, equipos retornan a bodega.
  {
    action: 'operations_to_sin_renovacion',
    label: 'No renueva contrato',
    buttonLabel: 'Fin de contrato →',
    fromModule: 'operations', fromStage: 'operativo', toModule: 'closed', toStage: 'sin_renovacion',
    requiredFields: [
      f('cancellation_reason', 'Motivo del cierre', 'textarea'),
    ],
    noteTemplate: 'Cliente no renueva contrato. Iniciar retiro de equipos.',
  },
  // ─── BACKWARD: devolver a la etapa anterior, sin perder ningún campo guardado ───
  {
    action: 'operations_back_to_dimensionado',
    label: 'Devolver a Dimensionado',
    buttonLabel: '← Volver a Dimensionado',
    fromModule: 'operations', fromStage: 'alistamiento', toModule: 'operations', toStage: 'dimensionado',
    requiredFields: [],
    noteTemplate: 'Devuelto a Dimensionado para revisar diseño.',
    direction: 'backward',
  },
  {
    action: 'operations_back_to_alistamiento',
    label: 'Devolver a Alistamiento',
    buttonLabel: '← Volver a Alistamiento',
    fromModule: 'operations', fromStage: 'instalacion', toModule: 'operations', toStage: 'alistamiento',
    requiredFields: [],
    noteTemplate: 'Devuelto a Alistamiento (ej. faltó equipo o reserva).',
    direction: 'backward',
  },
  {
    action: 'operations_back_to_instalacion',
    label: 'Devolver a Instalación',
    buttonLabel: '← Volver a Instalación',
    fromModule: 'operations', fromStage: 'operativo', toModule: 'operations', toStage: 'instalacion',
    requiredFields: [],
    noteTemplate: 'Devuelto a Instalación para ajustes.',
    direction: 'backward',
  },
];

export const findTransition = (action: string) => TRANSITIONS.find((t) => t.action === action);

/** Transiciones disponibles desde el estado actual */
export const transitionsFrom = (currentModule: CrmModule, currentStage: string): TransitionDef[] =>
  TRANSITIONS.filter((t) => t.fromModule === currentModule && t.fromStage === currentStage);
