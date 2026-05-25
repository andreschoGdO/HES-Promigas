/**
 * Diccionario de variables — mapeo nombre de columna ↔ key de Metrum + descripción.
 * Usado por el visualizador en Cierre Diario + Vista Granular.
 */

export interface VariableMeta {
  key: string;              // Key real en Metrum o columna en daily_casa_metrics
  label: string;            // Nombre para mostrar en la UI
  unit: string;
  description: string;
  source: 'metrum' | 'derived' | 'closure';
  category: 'energia' | 'corriente' | 'voltaje' | 'estado' | 'derivada';
}

export const VARIABLES: VariableMeta[] = [
  // ─── Métricas pre-computadas por casa (daily_casa_metrics) ───
  { key: 'generacion_wh',   label: 'Generación',           unit: 'Wh',       category: 'energia',  source: 'derived', description: 'Energía generada por el inversor en el día. Δ de CenergyAE del inversor (cumulativo hoy − cumulativo ayer).' },
  { key: 'importacion_wh',  label: 'Importación',          unit: 'Wh',       category: 'energia',  source: 'derived', description: 'Energía consumida desde la red eléctrica. Δ de CenergyAI del medidor rojo.' },
  { key: 'excedentes_wh',   label: 'Excedentes',           unit: 'Wh',       category: 'energia',  source: 'derived', description: 'Energía exportada a la red. Δ de CenergyAE del medidor rojo.' },
  { key: 'demanda_wh',      label: 'Demanda Día',          unit: 'Wh',       category: 'derivada', source: 'derived', description: 'Energía total consumida por la casa. = Generación + Importación − Excedentes.' },
  { key: 'gen_dem_pct',     label: 'Gen / Dem',            unit: '%',        category: 'derivada', source: 'derived', description: '% de la demanda diaria cubierto por la generación solar.' },
  { key: 'exc_gen_pct',     label: 'Exc / Gen',            unit: '%',        category: 'derivada', source: 'derived', description: '% de la generación solar que se exportó (no autoconsumida).' },
  { key: 'imp_dem_pct',     label: 'Imp / Dem',            unit: '%',        category: 'derivada', source: 'derived', description: '% de la demanda cubierto por la red eléctrica.' },
  { key: 'yield_real',      label: 'Yield Real',           unit: 'kWh/kWp',  category: 'derivada', source: 'derived', description: 'Energía generada por unidad de potencia instalada. = Generación / Σ potencia inversores.' },
  { key: 'desempeno_pct',   label: 'Desempeño (PR)',       unit: '%',        category: 'derivada', source: 'derived', description: 'Performance Ratio vs Yield Teórico (4.5 kWh/kWp/día Cali). = Yield Real / 4.5 × 100.' },
  { key: 'imax_a',          label: 'Corriente Máx',        unit: 'A',        category: 'corriente', source: 'derived', description: 'Máximo del día entre currentA/B/C del inversor y del medidor rojo. AGG=MAX en Metrum.' },
  { key: 'potencia_kw',     label: 'Potencia instalada',   unit: 'kWp',      category: 'energia',  source: 'derived', description: 'Suma de invcap (capacidad nominal en kW) de los inversores de la casa.' },

  // ─── Lecturas crudas Metrum — medidores (timeseries) ───
  { key: 'CenergyAI',       label: 'Energía activa importada (cum.)', unit: 'Wh',  category: 'energia', source: 'metrum',  description: 'Lectura cumulativa diaria de energía activa importada. Snapshot a las 05:00 UTC = 00:00 COT.' },
  { key: 'CenergyAE',       label: 'Energía activa exportada (cum.)', unit: 'Wh',  category: 'energia', source: 'metrum',  description: 'Lectura cumulativa diaria de energía activa exportada.' },
  { key: 'CenergyRI',       label: 'Energía reactiva importada (cum.)', unit: 'varh', category: 'energia', source: 'metrum', description: 'Lectura cumulativa de energía reactiva importada.' },
  { key: 'CenergyRE',       label: 'Energía reactiva exportada (cum.)', unit: 'varh', category: 'energia', source: 'metrum', description: 'Lectura cumulativa de energía reactiva exportada.' },
  { key: 'energyAI',        label: 'Energía activa importada (instant.)', unit: 'Wh', category: 'energia', source: 'metrum', description: 'Lectura instantánea (~15 min) de energía activa importada. NO usar para cálculos diarios — usar CenergyAI.' },
  { key: 'energyRI',        label: 'Energía reactiva importada (instant.)', unit: 'varh', category: 'energia', source: 'metrum', description: 'Lectura instantánea de reactiva importada.' },
  { key: 'currentA',        label: 'Corriente Fase A',     unit: 'A',  category: 'corriente', source: 'metrum', description: 'Corriente instantánea fase R/A.' },
  { key: 'currentB',        label: 'Corriente Fase B',     unit: 'A',  category: 'corriente', source: 'metrum', description: 'Corriente instantánea fase S/B.' },
  { key: 'currentC',        label: 'Corriente Fase C',     unit: 'A',  category: 'corriente', source: 'metrum', description: 'Corriente instantánea fase T/C.' },
  { key: 'powerAI',         label: 'Potencia activa imp.', unit: 'W',  category: 'energia',  source: 'metrum', description: 'Potencia activa importada instantánea.' },
  { key: 'powerRI',         label: 'Potencia reactiva imp.', unit: 'var', category: 'energia', source: 'metrum', description: 'Potencia reactiva importada instantánea.' },

  // ─── Atributos del inversor (Metrum SERVER_SCOPE) ───
  { key: 'invbrand',        label: 'Marca inversor',       unit: '',   category: 'estado', source: 'metrum', description: 'Marca del inversor: LIVOLTEK (HP*) o DEYE (numéricos 24/25*).' },
  { key: 'invmodel',        label: 'Modelo inversor',      unit: '',   category: 'estado', source: 'metrum', description: 'Modelo del inversor (ej: LIVOTEK HP3-10KL2 o SUN-15K-SG01HP3 HV trifásico).' },
  { key: 'invcap',          label: 'Capacidad inversor',   unit: 'kW', category: 'energia', source: 'metrum', description: 'Potencia nominal del inversor en kW.' },
  { key: 'invarray',        label: 'Paneles inversor',     unit: '',   category: 'estado', source: 'metrum', description: 'Número de paneles conectados al inversor.' },
  { key: 'invtype',         label: 'Tipo inversor',        unit: '',   category: 'estado', source: 'metrum', description: 'Tipo: Hibrido, On-Grid, Off-Grid.' },
  { key: 'BattSn',          label: 'Serial batería',       unit: '',   category: 'estado', source: 'metrum', description: 'Número de serie de la batería conectada al inversor.' },
  { key: 'TLinvstate',      label: 'Estado inversor',      unit: '',   category: 'estado', source: 'metrum', description: 'Estado del inversor DEYE: on / off.' },
  { key: 'TLBattSOC',       label: 'Estado de carga batería', unit: '%', category: 'estado', source: 'metrum', description: 'State of Charge — % de carga de la batería.' },

  // ─── Atributos generales ───
  { key: 'spcus',           label: 'Casa / Cliente',       unit: '',   category: 'estado', source: 'metrum', description: 'Nombre de la casa donde está instalado el equipo (ej: Casa 2, Casa 23p, Piloto Promigas).' },
  { key: 'gateway',         label: 'Gateway padre',        unit: '',   category: 'estado', source: 'metrum', description: 'Nombre del Pulsar (gateway IN*) al que pertenece el dispositivo.' },
  { key: 'mettype',         label: 'Tipo medidor',         unit: '',   category: 'estado', source: 'metrum', description: 'Subtipo del medidor: solar (lee generación) o red (lee importación/exportación).' },
  { key: 'active',          label: 'Activo',               unit: '',   category: 'estado', source: 'metrum', description: 'true si Metrum recibe datos del dispositivo recientemente; false si está sin conexión.' },
  { key: 'zone',            label: 'Ubicación',            unit: '',   category: 'estado', source: 'metrum', description: 'Conjunto residencial / ubicación física (ej: RESERVAS DE PANCE).' },
  { key: 'city',            label: 'Ciudad',               unit: '',   category: 'estado', source: 'metrum', description: 'Ciudad donde está la casa.' },
  { key: 'dept',            label: 'Departamento',         unit: '',   category: 'estado', source: 'metrum', description: 'Departamento de Colombia.' },
  { key: 'latDev',          label: 'Latitud GPS',          unit: '°',  category: 'estado', source: 'metrum', description: 'Latitud del gateway. Solo presente en devices tipo pulsar (IN*).' },
  { key: 'lonDev',          label: 'Longitud GPS',         unit: '°',  category: 'estado', source: 'metrum', description: 'Longitud del gateway.' },
];

export const findVariable = (key: string): VariableMeta | undefined =>
  VARIABLES.find((v) => v.key === key);

export const variablesByCategory = (): Record<string, VariableMeta[]> => {
  const out: Record<string, VariableMeta[]> = {};
  for (const v of VARIABLES) {
    if (!out[v.category]) out[v.category] = [];
    out[v.category].push(v);
  }
  return out;
};
