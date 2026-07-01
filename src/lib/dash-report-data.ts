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

export interface DashReport {
  periodo: { desde: string; hasta: string; anio: string };
  global: {
    casasAcum: number;
    kwpAcum: number;
    kwhAcum: number;
    capexAcumM: number;
    avancePct: number;
    metaCasas: number;
    mesesActivos: number;
    porMes: AvanceGlobalMes[];
  };
  semana: {
    casasInstaladas: number; programadas: number;
    standBy: number; porIniciar: number;
    kwpSemana: number; kwhSemana: number; capexSemanaM: number;
    motivos: StandByRow[];
  };
  detalle: {
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
    alertas: AlertaRow[];
  };
}

export const DEFAULT_REPORT: DashReport = {
  periodo: { desde: '[DD/MM]', hasta: '[DD/MM]', anio: '[Año]' },
  global: {
    casasAcum: 142, kwpAcum: 850, kwhAcum: 1080, capexAcumM: 6200,
    avancePct: 62, metaCasas: 230, mesesActivos: 6,
    porMes: [
      { mes: 'Ene', casas: 15, kwp: 90,  kwh: 114, capexM: 650,  sol1: 5, sol2: 4, sol3: 3, sol4: 3 },
      { mes: 'Feb', casas: 18, kwp: 108, kwh: 137, capexM: 790,  sol1: 6, sol2: 5, sol3: 4, sol4: 3 },
      { mes: 'Mar', casas: 22, kwp: 132, kwh: 167, capexM: 960,  sol1: 7, sol2: 6, sol3: 5, sol4: 4 },
      { mes: 'Abr', casas: 25, kwp: 150, kwh: 190, capexM: 1090, sol1: 8, sol2: 7, sol3: 6, sol4: 4 },
      { mes: 'May', casas: 28, kwp: 168, kwh: 213, capexM: 1220, sol1: 9, sol2: 8, sol3: 6, sol4: 5 },
      { mes: 'Jun', casas: 34, kwp: 202, kwh: 258, capexM: 1490, sol1: 11, sol2: 9, sol3: 8, sol4: 6 },
    ],
  },
  semana: {
    casasInstaladas: 18, programadas: 22, standBy: 4, porIniciar: 9,
    kwpSemana: 126.5, kwhSemana: 162, capexSemanaM: 850,
    motivos: [
      { motivo: 'Pendiente aprobación de medidor', casas: 2, accion: 'Radicado ante el operador de red' },
      { motivo: 'Falta de material (estructura)',  casas: 1, accion: 'Despacho programado' },
      { motivo: 'Acceso restringido al predio',     casas: 1, accion: 'Coordinación con propietario' },
    ],
  },
  detalle: {
    marcas: [
      { marca: 'Livoltek', casas: 6, kwp: 42.0, kwh: 54 },
      { marca: 'Deye',     casas: 5, kwp: 35.5, kwh: 45 },
      { marca: 'Huawei',   casas: 4, kwp: 28.0, kwh: 36 },
      { marca: 'Tesla',    casas: 3, kwp: 21.0, kwh: 27 },
    ],
    zonas: [
      { zona: 'Norte',    casas: 6, capex: '$290M' },
      { zona: 'Interior', casas: 7, capex: '$340M' },
      { zona: 'Sur',      casas: 5, capex: '$220M' },
    ],
    constructores: [
      { constructor: 'Estruccon', asignadas: 7, instaladas: 7 },
      { constructor: 'Shuman',    asignadas: 6, instaladas: 6 },
      { constructor: 'Hybrytec',  asignadas: 5, instaladas: 5 },
    ],
  },
  planeacion: {
    casasAsignadas: 15, kwpPlan: 105, kwhPlan: 135, capexPlanM: 710,
    constructoresActivos: 3, constructoresLista: 'Estruccon · Shuman · Hybrytec',
    zonasActivas: 3, zonasLista: 'Norte · Interior · Sur',
    distribucion: [
      { zona: 'Norte',    constructor: 'Estruccon', casas: 5, marca: 'Livoltek', fecha: '[DD/MM]' },
      { zona: 'Interior', constructor: 'Shuman',    casas: 6, marca: 'Deye',     fecha: '[DD/MM]' },
      { zona: 'Sur',      constructor: 'Hybrytec',  casas: 4, marca: 'Huawei',   fecha: '[DD/MM]' },
    ],
  },
  legalizaciones: {
    tramite: 5, aprobadas: 2, enRevision: 3,
    detalle: [
      { casa: 'Casa 1', zona: 'Norte',    operador: 'EPSA',   estado: 'Aprobado',   fecha: '[DD/MM]' },
      { casa: 'Casa 2', zona: 'Interior', operador: 'EMCALI', estado: 'En revisión', fecha: '[DD/MM]' },
      { casa: 'Casa 3', zona: 'Sur',      operador: 'EPSA',   estado: 'Radicado',   fecha: '[DD/MM]' },
      { casa: 'Casa 4', zona: 'Interior', operador: 'EMCALI', estado: 'Aprobado',   fecha: '[DD/MM]' },
      { casa: 'Casa 5', zona: 'Norte',    operador: 'EPSA',   estado: 'Radicado',   fecha: '[DD/MM]' },
    ],
  },
  postventa: {
    abiertos: 3, enTransito: 2, resueltosSitio: 1,
    detalle: [
      { marca: 'Deye',     equipo: 'Inversor híbrido',  falla: 'Falla de comunicación', estado: 'En revisión',      retorno: '[DD/MM]' },
      { marca: 'Livoltek', equipo: 'Batería',           falla: 'Celda en falla',        estado: 'Reemplazo aprobado', retorno: '[DD/MM]' },
      { marca: 'Huawei',   equipo: 'Optimizador DC-DC', falla: 'Diagnóstico en sitio', estado: 'Resuelto en sitio', retorno: 'No aplica' },
    ],
  },
  logistica: {
    stock: [
      { marca: 'Livoltek', paneles: 48, inversores: 10, baterias: 9, estructuras: 12, cobertura: 5 },
      { marca: 'Deye',     paneles: 40, inversores: 8,  baterias: 7, estructuras: 10, cobertura: 4 },
      { marca: 'Huawei',   paneles: 32, inversores: 6,  baterias: 5, estructuras: 8,  cobertura: 3 },
      { marca: 'Tesla',    paneles: 24, inversores: 4,  baterias: 4, estructuras: 6,  cobertura: 2 },
    ],
    alertas: [
      { componente: 'Baterías Tesla',      nivel: 'Bajo' },
      { componente: 'Inversores Huawei',   nivel: 'Medio' },
      { componente: 'Estructuras (todas)', nivel: 'Adecuado' },
      { componente: 'Paneles (todas)',     nivel: 'Adecuado' },
    ],
  },
};
