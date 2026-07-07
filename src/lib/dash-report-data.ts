/**
 * Datos del Avance Semanal de Construcción.
 * Espejo del PDF corporativo — mismo orden y variables.
 * Todos los valores son editables. En una siguiente iteración pueden
 * cargarse desde la BD; hoy funcionan como plantilla editable.
 */

export interface AvanceGlobalMes {
  mes: string;
  casas: number;
  kwp: number;
  kwh: number;
  capexM: number; // millones COP
  sol1: number;
  sol2: number;
  sol3: number;
  sol4: number;
}

export interface StandByRow {
  motivo: string;
  casas: number;
  accion: string;
}

export interface MarcaRow  { marca: string; casas: number; kwp: number; kwh: number; }
export interface ZonaRow   { zona: string; casas: number; capex: string; }
export interface ConstRow  { constructor: string; asignadas: number; instaladas: number; }
export interface PlanRow   { zona: string; constructor: string; casas: number; marca: string; fecha: string; }
export interface LegalRow  { casa: string; zona: string; operador: string; estado: string; fecha: string; }
export interface GarantRow { marca: string; equipo: string; falla: string; estado: string; retorno: string; }
export interface StockRow  { marca: string; paneles: number; inversores: number; baterias: number; estructuras: number; cobertura: number; }
export interface AlertaRow { componente: string; nivel: 'Bajo' | 'Medio' | 'Adecuado' | 'Alto'; }

export interface UsdWpBySolucion {
  solucion: string;      // "Sol.2" | "Sol.3" | "Sol.4"
  casas: number;         // # casas de esta solución
  usdWpPromedio: number; // promedio ponderado por kWp
}

export interface KitsPorBodega {
  warehouseName: string;
  city: string;
  priority: { T2: number; T3: number; T4: number };  // en fracción 0-1
  totalKits: number;
  byTipo: { T2: number; T3: number; T4: number };    // conteo por tipo
  porKit: Array<{ id: string; label: string; count: number }>; // detalle por sub-kit
}

export interface DashReport {
  periodo: { desde: string; hasta: string; anio: string };
  global: {
    casasAcum: number;
    kwpAcum: number;
    kwhAcum: number;
    capexAcumM: number;
    capexVentaAcumM: number;   // capex de venta acumulado (mig 46)
    avancePct: number;
    metaCasas: number;
    mesesActivos: number;
    porMes: AvanceGlobalMes[];
    usdWpBySolucion: UsdWpBySolucion[];  // métrica USD/Wp por solución (mig 46)
  };
  semana: {
    casasInstaladas: number; programadas: number;
    standBy: number; porIniciar: number;
    kwpSemana: number; kwhSemana: number; capexSemanaM: number;
    motivos: StandByRow[];
    /** Listas de casas por KPI — usadas como tooltip al hover. */
    detalle?: {
      instaladas: string[];
      programadas: string[];
      standBy: string[];
      porIniciar: string[];
    };
  };
  detalle: {
    marcas: MarcaRow[];
    zonas: ZonaRow[];
    constructores: ConstRow[];
  };
  detalleGlobal: {
    marcas: MarcaRow[];
    zonas: ZonaRow[];
    constructores: ConstRow[];
  };
  planeacion: {
    casasAsignadas: number; kwpPlan: number; kwhPlan: number; capexPlanM: number;
    constructoresActivos: number; constructoresLista: string;
    zonasActivas: number; zonasLista: string;
    distribucion: PlanRow[];
  };
  legalizaciones: {
    tramite: number; aprobadas: number; enRevision: number;
    detalle: LegalRow[];
  };
  postventa: {
    abiertos: number; enTransito: number; resueltosSitio: number;
    detalle: GarantRow[];
  };
  logistica: {
    stock: StockRow[];
    /** Mismo modelo que `stock` pero desglosado por bodega (Cali/BQ/Cartagena). */
    stockPorBodega: Array<{ warehouseName: string; city: string; stock: StockRow[] }>;
    alertas: AlertaRow[];
    kitsPorBodega: KitsPorBodega[];
  };
}

/**
 * Placeholder VACÍO — todo en cero. Se usa como estado inicial mientras
 * `/api/dash/report` responde. Antes había mocks (142 casas, marcas Huawei/
 * Tesla, motivos de stand-by inventados, etc.) que aparecían por 1-2s cada
 * vez que se abría el Dash — creaban la impresión de datos falsos.
 * Ahora todo lo que se muestra viene del endpoint real.
 */
export const DEFAULT_REPORT: DashReport = {
  periodo: { desde: '—', hasta: '—', anio: '—' },
  global: {
    casasAcum: 0, kwpAcum: 0, kwhAcum: 0, capexAcumM: 0, capexVentaAcumM: 0,
    avancePct: 0, metaCasas: 0, mesesActivos: 0,
    porMes: [], usdWpBySolucion: [],
  },
  semana: {
    casasInstaladas: 0, programadas: 0, standBy: 0, porIniciar: 0,
    kwpSemana: 0, kwhSemana: 0, capexSemanaM: 0,
    motivos: [],
  },
  detalle: { marcas: [], zonas: [], constructores: [] },
  detalleGlobal: { marcas: [], zonas: [], constructores: [] },
  planeacion: {
    casasAsignadas: 0, kwpPlan: 0, kwhPlan: 0, capexPlanM: 0,
    constructoresActivos: 0, constructoresLista: '',
    zonasActivas: 0, zonasLista: '',
    distribucion: [],
  },
  legalizaciones: { tramite: 0, aprobadas: 0, enRevision: 0, detalle: [] },
  postventa:     { abiertos: 0, enTransito: 0, resueltosSitio: 0, detalle: [] },
  logistica:     { stock: [], stockPorBodega: [], alertas: [], kitsPorBodega: [] },
};
