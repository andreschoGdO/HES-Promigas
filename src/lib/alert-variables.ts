/**
 * Catálogo de variables disponibles para crear reglas de alerta.
 * Una sola fuente de verdad — usada en /alertas (form de nueva regla)
 * y en el dashboard tab "Alertas por Casa" (formato de eventos).
 */

export type AlertCategory = 'solar' | 'reactiva' | 'demanda' | 'bateria' | 'alarma_inversor' | 'conexion';

export interface AlertVariableMeta {
  key: string;                 // valor que va en alert_rules.variable
  label: string;               // texto del select / encabezado
  unit: string;                // "Wh", "%", "A", etc.
  category: AlertCategory;
  frequency: 'diario' | 'mensual' | '15min' | 'instantaneo';
  description: string;         // explica qué mide y cuándo dispara
  format?: 'pct' | 'energy' | 'num' | 'bool';  // para renderizar values
}

export const ALERT_CATEGORIES: Record<AlertCategory, { label: string; color: string; icon: string }> = {
  solar:           { label: 'Solar / Producción', color: '#f59e0b', icon: '☀️' },
  reactiva:        { label: 'Reactiva / CREG',    color: '#3b82f6', icon: '⚡' },
  demanda:         { label: 'Demanda eléctrica', color: '#8b5cf6', icon: '🔌' },
  bateria:         { label: 'Batería',           color: '#10b981', icon: '🔋' },
  alarma_inversor: { label: 'Alarmas inversor', color: '#ef4444', icon: '⚠️' },
  conexion:        { label: 'Conexión / Estado', color: '#64748b', icon: '📡' },
};

export const ALERT_VARIABLES: AlertVariableMeta[] = [
  // ───── Solar / Producción (diario) ─────
  { key: 'generacion_wh', label: 'Generación', unit: 'Wh', category: 'solar', frequency: 'diario', format: 'energy',
    description: 'Energía generada por el inversor durante el día. Si baja de forma sostenida puede indicar sombras, sucio en paneles o falla.' },
  { key: 'demanda_wh', label: 'Demanda Día', unit: 'Wh', category: 'solar', frequency: 'diario', format: 'energy',
    description: 'Energía total consumida por la casa = Generación + Importación − Excedentes.' },
  { key: 'importacion_wh', label: 'Importación red', unit: 'Wh', category: 'solar', frequency: 'diario', format: 'energy',
    description: 'Energía tomada de la red eléctrica durante el día.' },
  { key: 'excedentes_wh', label: 'Excedentes a red', unit: 'Wh', category: 'solar', frequency: 'diario', format: 'energy',
    description: 'Energía exportada de vuelta a la red durante el día (cuando hay sobrante de generación).' },
  { key: 'gen_dem_pct', label: 'Gen / Demanda', unit: '%', category: 'solar', frequency: 'diario', format: 'pct',
    description: '% de la demanda diaria cubierto por la generación solar. Idealmente > 50% en una casa solar bien dimensionada.' },
  { key: 'exc_gen_pct', label: 'Exc / Gen', unit: '%', category: 'solar', frequency: 'diario', format: 'pct',
    description: '% de la generación que se exporta (no autoconsumida). Si es muy alto, hay sobre-dimensionamiento o consumo bajo.' },
  { key: 'imp_dem_pct', label: 'Imp / Demanda', unit: '%', category: 'solar', frequency: 'diario', format: 'pct',
    description: '% de la demanda cubierta por la red. Alto = poca autosuficiencia.' },
  { key: 'yield_real', label: 'Yield Real', unit: 'kWh/kWp', category: 'solar', frequency: 'diario', format: 'num',
    description: 'Energía generada por cada kWp de potencia instalada. Referencia Cali: 4.5 kWh/kWp/día.' },
  { key: 'desempeno_pct', label: 'Desempeño (PR)', unit: '%', category: 'solar', frequency: 'diario', format: 'pct',
    description: 'Performance Ratio vs Yield Teórico (4.5 kWh/kWp). > 80% es excelente, < 60% requiere intervención.' },
  { key: 'potencia_kw', label: 'Potencia instalada', unit: 'kWp', category: 'solar', frequency: 'diario', format: 'num',
    description: 'Suma de capacidad nominal de los inversores de la casa.' },
  { key: 'imax_a', label: 'Corriente máxima día', unit: 'A', category: 'demanda', frequency: 'diario', format: 'num',
    description: 'Pico máximo del día entre las corrientes del inversor y del medidor rojo. Si pasa el rating del breaker, riesgo de trip.' },

  // ───── Reactiva / CREG (mensual) ─────
  { key: 'eri_ratio_pct_mtd', label: 'Ratio ERI/EA mes-en-curso', unit: '%', category: 'reactiva', frequency: 'mensual', format: 'pct',
    description: 'Energía reactiva inductiva acumulada del mes / Energía activa importada. CREG penaliza si > 50% (fp < 0.9).' },
  { key: 'excedente_kvarh_mtd', label: 'Excedente sobre 50%', unit: 'kvarh', category: 'reactiva', frequency: 'mensual', format: 'num',
    description: 'Cantidad de reactiva inductiva que pasa del umbral CREG. Esto es lo que se factura como penalización.' },
  { key: 'cos_phi_mtd', label: 'Factor de potencia mes', unit: '', category: 'reactiva', frequency: 'mensual', format: 'num',
    description: 'cos φ mensual aproximado. CREG exige ≥ 0.9. Por debajo = penalización.' },
  { key: 'penalizacion_cop_mtd', label: 'Penalización estimada mes', unit: 'COP', category: 'reactiva', frequency: 'mensual', format: 'num',
    description: 'Estimación de cargo extra en la factura por reactiva excedente, a tarifa default 130 COP/kvarh.' },

  // ───── Demanda / Lazo 15 min ─────
  { key: 'current_a_max', label: 'Corriente máx (últimos 15 min)', unit: 'A', category: 'demanda', frequency: '15min', format: 'num',
    description: 'Mayor corriente entre las 3 fases en los últimos 15 minutos. Si se acerca al rating del breaker (típico 80 A), riesgo de trip.' },
  { key: 'power_active_w', label: 'Potencia activa actual', unit: 'W', category: 'demanda', frequency: 'instantaneo', format: 'num',
    description: 'Potencia activa instantánea del medidor rojo (importación desde red).' },
  { key: 'power_active_kw', label: 'Potencia activa actual', unit: 'kW', category: 'demanda', frequency: 'instantaneo', format: 'num',
    description: 'Igual que power_active_w pero en kW (más cómodo para umbrales humanos).' },
  { key: 'power_reactive_var', label: 'Potencia reactiva actual', unit: 'var', category: 'reactiva', frequency: 'instantaneo', format: 'num',
    description: 'Potencia reactiva inductiva instantánea del medidor rojo.' },
  { key: 'cos_phi_now', label: 'Factor de potencia en vivo', unit: '', category: 'reactiva', frequency: 'instantaneo', format: 'num',
    description: 'cos φ = P/√(P²+Q²) calculado de las potencias instantáneas. Si baja de 0.9, ya está acumulando penalización este mes.' },
  { key: 'fase_imbalance_pct', label: 'Desbalance entre fases', unit: '%', category: 'demanda', frequency: '15min', format: 'pct',
    description: '|fase mayor − fase menor| / fase mayor × 100. > 30% daña neutros y dispara breakers monofásicos.' },

  // ───── Calidad de red eléctrica / Tensión ─────
  { key: 'voltage_a_v', label: 'Voltaje fase A−N', unit: 'V', category: 'demanda', frequency: '15min', format: 'num',
    description: 'Voltaje fase A respecto a neutro. Nominal 127 V en sistemas 127/220. Bajo voltaje = falla en la red o transformador sobrecargado.' },
  { key: 'voltage_b_v', label: 'Voltaje fase B−N', unit: 'V', category: 'demanda', frequency: '15min', format: 'num',
    description: 'Voltaje fase B respecto a neutro. Si cae solo una fase = problema en esa rama (cable, breaker, conexión).' },
  { key: 'voltage_c_v', label: 'Voltaje fase C−N', unit: 'V', category: 'demanda', frequency: '15min', format: 'num',
    description: 'Voltaje fase C respecto a neutro. Comparar con A y B para detectar pérdida o desbalance.' },
  { key: 'voltage_min_v', label: 'Voltaje mínimo entre fases', unit: 'V', category: 'demanda', frequency: '15min', format: 'num',
    description: 'min(A, B, C). Si baja del 90% del nominal (~114 V) hay caída crítica — riesgo para equipos sensibles (PC, refrigeración, inversor en isla).' },
  { key: 'voltage_max_v', label: 'Voltaje máximo entre fases', unit: 'V', category: 'demanda', frequency: '15min', format: 'num',
    description: 'max(A, B, C). Si sube del 110% del nominal (~140 V) hay sobre-voltaje — riesgo de quemar equipos. Suele venir de exportación solar sin grid-following correcto.' },
  { key: 'voltage_imbalance_pct', label: 'Desbalance de voltaje', unit: '%', category: 'demanda', frequency: '15min', format: 'pct',
    description: '|Vmax − Vmin| / Vmax × 100. NEMA recomienda < 3%. Sobre 5% = cargas trifásicas (motores, AA) se calientan y pierden vida útil.' },
  { key: 'frequency_hz', label: 'Frecuencia de red', unit: 'Hz', category: 'demanda', frequency: '15min', format: 'num',
    description: 'Frecuencia del operador de red. Colombia nominal 60 Hz ± 0.5. Si baja de 59 Hz hay falla mayor del operador (riesgo de blackout regional).' },

  // ───── Batería ─────
  { key: 'batt_soh_pct', label: 'Salud batería (SOH)', unit: '%', category: 'bateria', frequency: 'diario', format: 'pct',
    description: 'State of Health — % de capacidad original que conserva la batería. < 80% indica degradación importante.' },
  { key: 'batt_energy_delivered_wh', label: 'Energía entregada batería día', unit: 'Wh', category: 'bateria', frequency: 'diario', format: 'energy',
    description: 'Energía que la batería entregó al sistema durante el día. Cero puede ser normal (si no hubo necesidad) o falla.' },
  { key: 'batt_delivery_time_s', label: 'Tiempo de entrega batería', unit: 's', category: 'bateria', frequency: 'diario', format: 'num',
    description: 'Segundos totales que la batería estuvo entregando energía durante el día.' },
  { key: 'batt_soc_pct', label: 'Carga batería en vivo (SOC)', unit: '%', category: 'bateria', frequency: '15min', format: 'pct',
    description: 'State of Charge — % de carga actual del banco. Si baja de 15% perdiste respaldo ante un corte.' },
  { key: 'batt_soc_min_24h', label: 'SOC mínimo últimas 24h', unit: '%', category: 'bateria', frequency: '15min', format: 'pct',
    description: 'Mínimo SOC alcanzado en las últimas 24 horas (agregado de instant_metrics). Si > 20%, la batería no se descargó hasta el límite saludable — probablemente no está ciclando.' },
  { key: 'batt_soc_max_24h', label: 'SOC máximo últimas 24h', unit: '%', category: 'bateria', frequency: '15min', format: 'pct',
    description: 'Máximo SOC alcanzado en las últimas 24 horas. Si < 80%, la batería no se cargó hasta el límite saludable — la generación solar no está aprovechándose para cargarla.' },

  // ───── Conexión / Estado ─────
  { key: 'gateway_offline_min', label: 'Tiempo Pulsar offline', unit: 'min', category: 'conexion', frequency: '15min', format: 'num',
    description: 'Minutos desde el último ping del gateway Pulsar. Si pasa de 30 min, la casa está muda.' },

  // ───── Alarmas inversor (flag*) ─────
  { key: 'alarm_FSVER', label: 'Sobre-voltaje (FSVER)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFSVER. Detectó voltaje fuera de rango superior. Riesgo de daño a equipos conectados.' },
  { key: 'alarm_FSCER', label: 'Sobre-corriente (FSCER)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFSCER. Corriente por encima del límite del inversor.' },
  { key: 'alarm_FBVER', label: 'Voltaje DC fuera de rango (FBVER)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFBVER. Voltaje del bus DC (paneles/batería) fuera de operación.' },
  { key: 'alarm_FFT', label: 'Sobre-temperatura (FFT)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFFT. Temperatura interna superando límite. Inversor puede derate o apagarse.' },
  { key: 'alarm_ETA', label: 'Pre-alerta temperatura (ETA)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagETA. Temperatura subiendo, posible ventilación obstruida.' },
  { key: 'alarm_FFDC', label: 'Falla DC (FFDC)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFFDC. Problema en paneles, MPPT o cableado DC.' },
  { key: 'alarm_FEM', label: 'Modo emergencia (FEM)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFEM. Inversor entró en modo emergencia (probable reset automático).' },
  { key: 'alarm_FFB', label: 'Falla feedback (FFB)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFFB. Lazo de control reporta error de seguimiento.' },
  { key: 'alarm_FFCT', label: 'Falla sensor CT (FFCT)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFFCT. Sensor de corriente con lectura inválida.' },
  { key: 'alarm_FAFER', label: 'Falla AFER', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagFAFER. Falla del módulo AFE de Livoltek.' },
  { key: 'alarm_UIcolorRojo', label: 'Estado UI rojo', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'Metrum marca el inversor en rojo. Falla activa sin identificar.' },
  { key: 'alarm_UIcolorAmarillo', label: 'Estado UI amarillo', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'Metrum marca el inversor en amarillo. Atención requerida.' },
  { key: 'alarm_UIcolorNaranja', label: 'Estado UI naranja', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'Metrum marca el inversor en naranja. Warning operativo.' },
  { key: 'alarm_TLinvstate_off', label: 'Inversor DEYE apagado', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'TLinvstate=off. El inversor DEYE está apagado. Generación detenida.' },
  { key: 'alarm_EMayor', label: 'Energía mayor (EMayor)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagEMayor. Lectura de energía superior al esperado, posible spike.' },
  { key: 'alarm_EMenor', label: 'Energía menor (EMenor)', unit: 'flag', category: 'alarma_inversor', frequency: 'instantaneo', format: 'bool',
    description: 'flagEMenor. Lectura de energía por debajo de lo esperado.' },
];

export const findVariableMeta = (key: string): AlertVariableMeta | undefined =>
  ALERT_VARIABLES.find((v) => v.key === key);

export const formatValue = (value: number | null, key: string): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const meta = findVariableMeta(key);
  if (!meta) return value.toFixed(2);
  if (meta.format === 'bool') return value > 0 ? 'ACTIVO' : 'inactivo';
  if (meta.format === 'pct') return `${value.toFixed(1)}%`;
  if (meta.format === 'energy') {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M${meta.unit}`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)} k${meta.unit}`;
    return `${value.toFixed(0)} ${meta.unit}`;
  }
  if (meta.unit === 'COP') return `$${value.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
  if (meta.unit) return `${value.toFixed(2)} ${meta.unit}`;
  return value.toFixed(2);
};
