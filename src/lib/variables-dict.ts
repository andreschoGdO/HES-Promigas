/**
 * Diccionario de variables — mapeo entre los nombres que vienen de Metrum
 * (o que calculamos nosotros) y una descripción comprensible.
 *
 * El objetivo es que cualquier persona del equipo (no solo el desarrollador)
 * pueda abrir Vista Granular o un reporte, leer la descripción aquí, y entender:
 *   1) Qué mide la variable
 *   2) De dónde sale (Metrum directo, agregado nuestro, o cierre diario)
 *   3) Cómo interpretar los valores típicos
 *   4) Cuándo es útil usarla
 */

export interface VariableMeta {
  key: string;              // Key real en Metrum o columna en daily_casa_metrics
  label: string;            // Nombre para mostrar en la UI
  unit: string;
  description: string;      // Explicación completa: qué es + cómo se lee + cuándo se usa
  source: 'metrum' | 'derived' | 'closure';
  category: 'energia' | 'corriente' | 'voltaje' | 'estado' | 'derivada';
}

export const VARIABLES: VariableMeta[] = [
  // ═══════════════════════════════════════════════════════════════════════
  //  MÉTRICAS DIARIAS POR CASA  (tabla daily_casa_metrics)
  //  Las calcula nuestro cron diario a partir de los cierres de Metrum.
  //  Se ven en /reportes, /funnel y se usan en alertas.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'generacion_wh', label: 'Generación', unit: 'Wh',
    category: 'energia', source: 'derived',
    description:
      'Energía solar que el inversor entregó al sistema durante todo el día (lado AC). ' +
      'Se calcula como la diferencia entre la lectura cumulativa exportada de hoy y la de ayer ' +
      '(Δ CenergyAE del inversor). Es la métrica principal para responder "¿cuánto produjo el solar?". ' +
      'Una casa de ~5 kWp en Cali típicamente da 18-25 kWh/día con sol normal.',
  },
  {
    key: 'importacion_wh', label: 'Importación', unit: 'Wh',
    category: 'energia', source: 'derived',
    description:
      'Energía que la casa tomó de la red de Promigas durante el día. ' +
      'Se calcula como Δ CenergyAI del medidor rojo (el que mide la red). ' +
      'Si es 0 todo el día significa que el solar + batería cubrieron todo el consumo (deseable). ' +
      'Si es alta, hay autoconsumo bajo o consumo nocturno fuerte.',
  },
  {
    key: 'excedentes_wh', label: 'Excedentes', unit: 'Wh',
    category: 'energia', source: 'derived',
    description:
      'Energía que se exportó hacia la red — sobrante del solar que la casa no consumió ni almacenó en batería. ' +
      'Se calcula como Δ CenergyAE del medidor rojo. ' +
      'Si es muy alta indica sobre-dimensionamiento del sistema o consumo bajo del usuario; el comercializador suele pagar poco por estos kWh.',
  },
  {
    key: 'demanda_wh', label: 'Demanda Día', unit: 'Wh',
    category: 'derivada', source: 'derived',
    description:
      'Energía total que la casa consumió en el día (toda la "demanda"). ' +
      'Fórmula: Generación + Importación − Excedentes. ' +
      'Esta es la respuesta a "¿cuánta luz usó esta casa hoy?" sin importar de dónde haya venido.',
  },
  {
    key: 'gen_dem_pct', label: 'Gen / Dem', unit: '%',
    category: 'derivada', source: 'derived',
    description:
      'Porcentaje de la demanda diaria que cubrió la generación solar. ' +
      'Indicador de autosuficiencia. ' +
      '> 80% es excelente (sistema bien dimensionado), 50-80% normal, < 50% el sistema queda corto para la casa.',
  },
  {
    key: 'exc_gen_pct', label: 'Exc / Gen', unit: '%',
    category: 'derivada', source: 'derived',
    description:
      'Porcentaje de la generación solar que se exportó a la red (no autoconsumida directamente ni guardada en batería). ' +
      'Si es > 40% indica sobre-dimensionamiento o falta de cargas en horario solar. ' +
      'En instalaciones con batería bien usada, este número baja porque la batería absorbe el sobrante.',
  },
  {
    key: 'imp_dem_pct', label: 'Imp / Dem', unit: '%',
    category: 'derivada', source: 'derived',
    description:
      'Porcentaje de la demanda que cubrió la red eléctrica. ' +
      'El complemento de la autosuficiencia: si gen_dem_pct es 70%, imp_dem_pct va a ser ~30%. ' +
      'Es lo que el usuario sigue pagando a Promigas a pesar de tener solar.',
  },
  {
    key: 'yield_real', label: 'Yield Real', unit: 'kWh/kWp',
    category: 'derivada', source: 'derived',
    description:
      'Energía generada por cada kWp instalado. Es el indicador estándar de la industria solar para comparar instalaciones de distinto tamaño. ' +
      'Fórmula: Generación / Σ capacidad nominal de inversores. ' +
      'Para Cali el yield teórico es ~4.5 kWh/kWp/día; valores > 4 son buenos, < 3.5 sugieren problema (sombra, sucio, falla).',
  },
  {
    key: 'desempeno_pct', label: 'Desempeño (PR)', unit: '%',
    category: 'derivada', source: 'derived',
    description:
      'Performance Ratio: qué tan cerca está el sistema del rendimiento teórico ideal. ' +
      'Fórmula: Yield Real / 4.5 × 100 (donde 4.5 kWh/kWp/día es el yield teórico Cali). ' +
      '> 80% excelente · 70-80% normal · 60-70% requiere revisión · < 60% intervenir en sitio.',
  },
  {
    key: 'imax_a', label: 'Corriente Máx', unit: 'A',
    category: 'corriente', source: 'derived',
    description:
      'Pico máximo de corriente registrado en el día — el mayor valor entre las 3 fases (currentA/B/C) del inversor y del medidor rojo. ' +
      'Si se acerca al rating del breaker (típico 50-80 A en residencial), hay riesgo de disparo del totalizador. ' +
      'Útil para detectar momentos de sobrecarga sin tener que mirar la curva instantánea.',
  },
  {
    key: 'potencia_kw', label: 'Potencia instalada', unit: 'kWp',
    category: 'energia', source: 'derived',
    description:
      'Capacidad nominal total instalada en la casa, en kWp. Suma de invcap de todos los inversores de esa casa. ' +
      'Es la base para calcular yield, performance ratio y para dimensionar nuevas reservas de inventario.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  MEDIDORES — telemetría cruda de Metrum  (timeseries)
  //  Las exponen los medidores STAR DDSY23S/DTSY23S. Hay dos tipos en cada
  //  casa: el "medidor rojo" mide la red, el "medidor solar" mide la salida
  //  del sistema solar antes de entrar a las cargas/red.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'CenergyAI', label: 'Energía activa importada (cumulativa)', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description:
      'Contador cumulativo de energía activa importada — un número que solo crece, igual que el odómetro de un carro. ' +
      'Metrum toma un snapshot diario a las 05:00 UTC (= 00:00 COT). ' +
      'Para saber cuánto se importó en el día calculamos hoy − ayer. ' +
      'En medidor rojo: energía tomada de Promigas. En medidor solar: no aplica (debería ser 0).',
  },
  {
    key: 'CenergyAE', label: 'Energía activa exportada (cumulativa)', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description:
      'Contador cumulativo de energía activa exportada (que sale del medidor hacia afuera). ' +
      'En medidor rojo: energía vertida a la red (excedentes). ' +
      'En medidor solar: energía generada por el sistema solar — esta es la base del cálculo de "generacion_wh".',
  },
  {
    key: 'CenergyRI', label: 'Energía reactiva inductiva (cumulativa)', unit: 'varh',
    category: 'energia', source: 'metrum',
    description:
      'Contador cumulativo de energía reactiva inductiva — la que generan motores, refrigeradores, AA. ' +
      'Es la que cobra CREG si supera el 50% de la energía activa importada (penalización por cos φ < 0.9). ' +
      'Lo monitoreamos mensualmente en el módulo NAR → Reactiva (CREG).',
  },
  {
    key: 'CenergyRE', label: 'Energía reactiva capacitiva (cumulativa)', unit: 'varh',
    category: 'energia', source: 'metrum',
    description:
      'Contador cumulativo de energía reactiva capacitiva — menos común en residencial. ' +
      'Aparece cuando hay bancos de capacitores, equipos electrónicos en standby o inversores en modo capacitivo. ' +
      'No genera penalización CREG (lo penalizado es la inductiva).',
  },
  {
    key: 'energyAI', label: 'Energía activa importada (instantánea)', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description:
      'Lectura instantánea (~cada 15 min) de la energía importada en el último intervalo. ' +
      'Es un VALOR de ventana, no un acumulado. ' +
      'NO usar para cálculos diarios — para eso siempre usar CenergyAI (cumulativo). ' +
      'Útil para ver picos de consumo en una ventana corta.',
  },
  {
    key: 'energyRI', label: 'Energía reactiva inductiva (instantánea)', unit: 'varh',
    category: 'energia', source: 'metrum',
    description:
      'Energía reactiva inductiva del último intervalo de 15 min. Ventana, no acumulado. ' +
      'Útil para detectar momentos del día donde aparece mucha reactiva (típicamente cuando arrancan AA o motores).',
  },
  {
    key: 'currentA', label: 'Corriente Fase A', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente instantánea por la fase A (también llamada R) del medidor. ' +
      'En residencial trifásico ideal las 3 fases deberían estar balanceadas (diferencia < 10%). ' +
      'Si una fase está mucho más cargada, hay desbalance que se debe corregir redistribuyendo circuitos.',
  },
  {
    key: 'currentB', label: 'Corriente Fase B', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente instantánea por la fase B (también llamada S). ' +
      'Comparar con A y C para evaluar desbalance entre fases.',
  },
  {
    key: 'currentC', label: 'Corriente Fase C', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente instantánea por la fase C (también llamada T). ' +
      'Si una sola fase mide significativamente más corriente, probablemente concentra cargas grandes (cocina inducción, AA central, etc.).',
  },
  {
    key: 'powerAI', label: 'Potencia activa importada', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia activa instantánea que pasa por el medidor (lectura cada ~15 min). ' +
      'En el medidor rojo: lo que se está importando de la red ahora mismo. ' +
      'En el medidor solar: la potencia que el sistema solar está entregando a la casa en ese instante (= curva de generación AC).',
  },
  {
    key: 'powerRI', label: 'Potencia reactiva importada', unit: 'var',
    category: 'energia', source: 'metrum',
    description:
      'Potencia reactiva instantánea que pasa por el medidor. ' +
      'Si es alta de forma sostenida, el cos φ está bajo y la casa está acumulando energía reactiva inductiva (camino a penalización CREG).',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  INVERSOR LIVOLTEK (HP3-*) — TELEMETRÍA REAL desde Metrum
  //  Estas son las keys que Metrum REALMENTE expone para inversores Livoltek
  //  HP3 (verificado en piloto Promigas). El sufijo "_LV" significa Livoltek
  //  (es nomenclatura del fabricante, NO "low voltage").
  //
  //  NOTA IMPORTANTE: Livoltek NO expone potencia DC por string (no hay Ppv1,
  //  Ppv2, Vpv1, etc.). Para análisis de generación DC se infiere a partir
  //  de powerAPg / powerAEg + BattPower.
  // ═══════════════════════════════════════════════════════════════════════
  // ── Potencias AC instantáneas
  {
    key: 'powerAEg', label: 'Potencia activa hacia red', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia activa que el inversor está entregando hacia la red AC en este instante. Es la lectura más cercana a "AC output del inversor". ' +
      'Si está cargando la batería, este número es menor que la generación PV total (parte va a batería en lugar de salir como AC).',
  },
  {
    key: 'powerAPg', label: 'Potencia activa generada (PV+Batt)', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia activa total generada por el inversor — suma de aporte PV + descarga de batería (− carga de batería). ' +
      'Es lo más cercano que Livoltek expone a "generación AC". Para aislar solo PV restá BattPower (que es negativo cuando carga, positivo cuando descarga).',
  },
  {
    key: 'powerAE', label: 'Potencia activa exportada', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia activa exportada del inversor (lo que efectivamente sale del equipo hacia las cargas + red). ' +
      'Suele ser muy parecido a powerAEg; cuando difieren reflejan pérdidas internas del inversor.',
  },
  {
    key: 'powerAEgdc_LV', label: 'Potencia DC equivalente', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia DC equivalente calculada por el inversor Livoltek. Es la mejor aproximación disponible a "potencia desde los paneles" ' +
      'cuando se descuentan pérdidas de conversión. NO viene de medición real por string (Livoltek no la expone).',
  },
  {
    key: 'powerREg_LV', label: 'Potencia reactiva', unit: 'var',
    category: 'energia', source: 'metrum',
    description:
      'Potencia reactiva del inversor Livoltek. Si es 0 sostenido = cos φ ≈ 1 (ideal). ' +
      'Si crece, el inversor está generando reactiva — la variable que se controla via API set_reactive_power.',
  },
  {
    key: 'powerPFg_LV', label: 'Factor de potencia (cos φ)', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Factor de potencia instantáneo medido por el inversor Livoltek. Rango -1 a +1. ' +
      'CREG exige ≥ 0.9. En la lectura típica este valor está cerca de 1.0 cuando el inversor opera correctamente.',
  },
  // ── Corrientes y voltajes (3 grupos: general, Grid, EPS/Backup)
  {
    key: 'currentA', label: 'Corriente Fase A (general)', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente AC fase A del inversor — visión general (combinada). Para distinguir entre lo que va a red vs lo que va a backup usá curGridA y curEpsA.',
  },
  {
    key: 'currentB', label: 'Corriente Fase B (general)', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente AC fase B del inversor — visión general (combinada).',
  },
  {
    key: 'currentC', label: 'Corriente Fase C (general)', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente AC fase C del inversor — visión general (combinada).',
  },
  {
    key: 'curGridA', label: 'Corriente Grid Fase A', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente fase A en el puerto Grid del inversor — lo que efectivamente fluye desde/hacia la red eléctrica. ' +
      'Combinada con voltGridA da la potencia que se intercambia con la red en esa fase.',
  },
  {
    key: 'curGridB', label: 'Corriente Grid Fase B', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente fase B en el puerto Grid del inversor.',
  },
  {
    key: 'curGridC', label: 'Corriente Grid Fase C', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente fase C en el puerto Grid del inversor.',
  },
  {
    key: 'curEpsA_LV', label: 'Corriente Backup Fase A', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente fase A en el puerto EPS (Emergency Power Supply / Backup) — lo que va hacia las cargas críticas. ' +
      'Cuando el inversor opera grid-tied este número refleja consumo del backup; cuando se cae la red este es el único camino activo.',
  },
  {
    key: 'curEpsB_LV', label: 'Corriente Backup Fase B', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente fase B en puerto EPS/Backup del inversor.',
  },
  {
    key: 'curEpsC_LV', label: 'Corriente Backup Fase C', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente fase C en puerto EPS/Backup del inversor.',
  },
  {
    key: 'voltageA', label: 'Voltaje Fase A (general)', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje AC fase A del inversor — lectura general (combinada de los puertos).',
  },
  {
    key: 'voltageB', label: 'Voltaje Fase B (general)', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje AC fase B del inversor — lectura general.',
  },
  {
    key: 'voltageC', label: 'Voltaje Fase C (general)', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje AC fase C del inversor — lectura general.',
  },
  {
    key: 'voltGridA', label: 'Voltaje Grid Fase A', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje fase A en el puerto Grid — lo que mide el inversor del lado de la red Promigas. Nominal ~120 V para sistema 120/208.',
  },
  {
    key: 'voltGridB', label: 'Voltaje Grid Fase B', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje fase B en el puerto Grid.',
  },
  {
    key: 'voltGridC', label: 'Voltaje Grid Fase C', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje fase C en el puerto Grid.',
  },
  {
    key: 'voltEpsA', label: 'Voltaje Backup Fase A', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje fase A en puerto EPS/Backup. Cuando el inversor está formando red en isla, este es el voltaje que el inversor SINTETIZA.',
  },
  {
    key: 'voltEpsB', label: 'Voltaje Backup Fase B', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje fase B en puerto EPS/Backup.',
  },
  {
    key: 'voltEpsC', label: 'Voltaje Backup Fase C', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje fase C en puerto EPS/Backup.',
  },
  {
    key: 'frequency', label: 'Frecuencia Grid', unit: 'Hz',
    category: 'estado', source: 'metrum',
    description: 'Frecuencia AC de la red eléctrica (Grid). Nominal Colombia: 60 Hz ± 0.5. Caídas por debajo de 59 Hz son señal de falla del operador.',
  },
  {
    key: 'freqEps', label: 'Frecuencia Backup', unit: 'Hz',
    category: 'estado', source: 'metrum',
    description: 'Frecuencia AC en el puerto EPS/Backup. En modo isla el inversor la sintetiza independientemente de la red.',
  },
  // ── Energías diarias (D = Day) y totales (T = Total) Livoltek
  {
    key: 'energyED', label: 'Energía exportada del día', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Energía activa exportada en el día (Export Day). Se reinicia a 0 cada día calendario en hora local del inversor.',
  },
  {
    key: 'energyET', label: 'Energía exportada total', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Energía activa exportada acumulada total desde que el inversor está en operación (Export Total). Solo crece.',
  },
  {
    key: 'energyID', label: 'Energía importada del día', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Energía activa importada en el día (Import Day) — lo que el inversor TOMÓ de la red ese día.',
  },
  {
    key: 'energyIT', label: 'Energía importada total', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Energía activa importada acumulada total desde puesta en marcha.',
  },
  {
    key: 'energyPD', label: 'Generación PV del día', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description:
      'Energía solar generada en el día (PV Day) — del lado DC, antes de pérdidas de conversión y batería. ' +
      'ESTA es la métrica más cercana a "cuánto generaron los paneles hoy" disponible en Livoltek. ' +
      'Se reinicia a 0 cada día calendario.',
  },
  {
    key: 'energyLD', label: 'Consumo de cargas del día', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Energía consumida por las cargas en el día (Load Day) — lo que efectivamente usó la casa.',
  },
  {
    key: 'energyLT', label: 'Consumo de cargas total', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Energía consumida por las cargas acumulada total desde puesta en marcha.',
  },
  {
    key: 'energyAE', label: 'Energía exportada (var. alterna)', unit: 'Wh',
    category: 'energia', source: 'metrum',
    description: 'Variante de la energía activa exportada. Suele coincidir con energyET; mantener trazabilidad si difieren.',
  },
  {
    key: 'ExportGrid_LV', label: 'Potencia exportada a red', unit: 'W',
    category: 'energia', source: 'metrum',
    description: 'Potencia activa que sale del inversor hacia la red eléctrica en este instante. Si es 0 todo el sistema solar va a autoconsumo o batería.',
  },
  {
    key: 'LoadPower_LV', label: 'Potencia a cargas', unit: 'W',
    category: 'energia', source: 'metrum',
    description: 'Potencia que el inversor entrega a las cargas conectadas al puerto Load/Backup. Es la demanda real de la casa en este instante.',
  },
  // ── Batería Livoltek (HP3 trae batería integrada o conectada vía BHF-S*)
  {
    key: 'BattPower', label: 'Potencia batería', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia neta de la batería en el inversor Livoltek. Convención: ' +
      'POSITIVO = descargando (batería entregando energía al sistema). ' +
      'NEGATIVO = cargando (absorbiendo energía).',
  },
  {
    key: 'BattCur', label: 'Corriente batería', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente DC de batería. Misma convención: positivo descarga, negativo carga.',
  },
  {
    key: 'BattVolt', label: 'Voltaje batería', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description:
      'Voltaje DC del bus de batería. ' +
      'En sistemas Livoltek HV (HP3-15K, etc.) los valores típicos son 150-500 V. ' +
      'Si baja a < 150V el sistema deja de poder usar la batería.',
  },
  {
    key: 'BattSOC', label: 'SOC batería', unit: '%',
    category: 'estado', source: 'metrum',
    description:
      'State of Charge — porcentaje de carga actual. 0%=vacía, 100%=llena. ' +
      'Operación recomendada para vida útil: ciclar entre 15% y 95%. ' +
      'Si TLBattSOC también aparece en DEYE, este es su equivalente Livoltek.',
  },
  {
    key: 'BattSOH', label: 'SOH batería', unit: '%',
    category: 'estado', source: 'metrum',
    description:
      'State of Health — capacidad restante respecto a la nominal de fábrica. ' +
      '100% = nueva, 80% = umbral de garantía típica, < 80% degradación significativa.',
  },
  {
    key: 'BattTemp', label: 'Temperatura batería', unit: '°C',
    category: 'estado', source: 'metrum',
    description:
      'Temperatura de la celda de batería (más caliente). ' +
      'Rango operativo seguro: 0-50°C. Sobre 55°C el BMS limita la corriente para proteger las celdas.',
  },
  {
    key: 'BattStateOp_LV', label: 'Estado operativo batería', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Estado operativo de la batería: charging / discharging / idle / standby. ' +
      'A veces hay desfase con BattCur (la corriente puede ser negativa = cargando pero el estado siga "discharging" por retardo del reporte).',
  },
  {
    key: 'BattState_LV', label: 'Estado conexión batería', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Estado de comunicación con la batería: online (BMS reportando) / offline (sin comunicación). Si está offline durante operación, hay problema de cable BMS o BMS apagado.',
  },
  {
    key: 'BattCapAH_LV', label: 'Capacidad batería', unit: 'Ah',
    category: 'estado', source: 'metrum',
    description: 'Capacidad nominal de la batería en amperios-hora. Atributo de configuración inicial, no cambia con el tiempo.',
  },
  {
    key: 'BattCharges_LV', label: 'Ciclos batería', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Contador de ciclos carga-descarga acumulados de la batería. ' +
      'LiFePO4 típica: ~6000 ciclos antes de bajar a 80% SOH. ' +
      'A 1 ciclo/día son ~16 años nominales.',
  },
  // ── Estado y meta del inversor
  {
    key: 'invstate', label: 'Estado inversor', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Estado on/off del inversor. "on" = generando o disponible para generar. "off" = apagado. Si está "off" durante horas de sol, hay alerta operativa.',
  },
  {
    key: 'invrun', label: 'Modo de operación', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Modo en que está corriendo el inversor: ' +
      '"normal" = grid-tied operando normal · ' +
      '"backup" = en modo isla por caída de red · ' +
      '"fault" = falla activa · ' +
      '"standby" = encendido pero no generando.',
  },
  {
    key: 'activityState', label: 'Estado de telemetría', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Estado del reporte de telemetría: "succesful" (sic — typo del firmware) = está enviando datos al gateway correctamente. ' +
      'Si difiere, hay problema en la comunicación local entre inversor y Pulsar.',
  },
  {
    key: 'MeterState_LV', label: 'Estado medidor inversor', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Estado del medidor interno del inversor (CT clamps). online = leyendo / offline = sensor desconectado o falla.',
  },
  {
    key: 'platts', label: 'Timestamp plataforma', unit: 'ms',
    category: 'estado', source: 'metrum',
    description: 'Timestamp Unix (ms) cuando el dato fue recibido por Metrum. Útil para detectar lag entre el inversor y la plataforma.',
  },
  {
    key: 'DCts', label: 'Timestamp diario', unit: 'ms',
    category: 'estado', source: 'metrum',
    description: 'Timestamp Unix del último cierre diario que el inversor reportó. Si está atrasado más de 24h hay problema con el cierre.',
  },
  {
    key: 'dailyReportTel', label: 'Reporte diario telemetría', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Bandera/blob que el inversor manda como resumen diario. Generalmente no se grafica directamente.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  INVERSOR — TELEMETRÍA INSTANTÁNEA — LADO DC (PANELES)
  //  Estas vienen como timeseries del inversor. La cantidad de strings (1, 2 o 3)
  //  depende del modelo: HP3-8K=2, HP3-10K=2, SG01HP3-12K/15K=3, SG04LP3-6K=2.
  //  Sumar todas las Ppv* da la generación solar pura (antes del inversor y batería).
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'Ppv1', label: 'Potencia DC String 1', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia DC que los paneles conectados al MPPT 1 están entregando ahora mismo. ' +
      'Es la generación REAL de ese grupo de paneles — antes de pasar por el inversor, sin pérdidas de conversión, sin efecto de batería. ' +
      'Usarla para evaluar performance solar puro: sombras, sucio, panel defectuoso.',
  },
  {
    key: 'Ppv2', label: 'Potencia DC String 2', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia DC del MPPT 2. Equivalente a Ppv1 pero para el segundo grupo de paneles. ' +
      'En la mayoría de inversores residenciales hay 2 MPPT. ' +
      'Para ver la generación solar total instantánea sumá Ppv1 + Ppv2 (+ Ppv3 si aplica).',
  },
  {
    key: 'Ppv3', label: 'Potencia DC String 3', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia DC del MPPT 3. Solo presente en inversores con 3 trackers (típicamente DEYE SUN-12K/15K-SG01HP3). ' +
      'Si no aparece para tu inversor, es que solo tiene 2 strings.',
  },
  {
    key: 'Ppv', label: 'Potencia DC total', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia DC agregada de todos los MPPT, cuando el inversor la expone como una sola key. ' +
      'Esta ES la curva clásica de generación solar — empieza al amanecer, pico al mediodía, cero al anochecer. ' +
      'Si tu inversor no expone esta key, sumá Ppv1+Ppv2(+Ppv3) manualmente.',
  },
  {
    key: 'pvPower', label: 'Potencia PV total (DEYE)', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Alias DEYE para la potencia PV total. Equivalente a Ppv pero con el naming que usa DEYE en su API/Metrum. ' +
      'Usar esta si la otra no aparece para inversores DEYE.',
  },
  {
    key: 'Vpv1', label: 'Voltaje DC String 1', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description:
      'Voltaje DC en el string 1. Depende de la cantidad de paneles en serie en ese string. ' +
      'Útil para detectar sombras parciales: si un string tiene voltaje significativamente menor que el otro a la misma hora, probablemente uno o varios paneles del string bajo están sombreados o defectuosos.',
  },
  {
    key: 'Vpv2', label: 'Voltaje DC String 2', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje DC del MPPT 2. Comparar con Vpv1 para detectar problemas en un string específico.',
  },
  {
    key: 'Vpv3', label: 'Voltaje DC String 3', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description: 'Voltaje DC del MPPT 3 (cuando aplica).',
  },
  {
    key: 'Ipv1', label: 'Corriente DC String 1', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente DC del string 1. Combinada con Vpv1 da la potencia: Ppv1 = Vpv1 × Ipv1. ' +
      'Si la corriente es muy distinta entre strings, hay disparidad de irradiación o configuración asimétrica.',
  },
  {
    key: 'Ipv2', label: 'Corriente DC String 2', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente DC del MPPT 2.',
  },
  {
    key: 'Ipv3', label: 'Corriente DC String 3', unit: 'A',
    category: 'corriente', source: 'metrum',
    description: 'Corriente DC del MPPT 3 (cuando aplica).',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  INVERSOR — TELEMETRÍA INSTANTÁNEA — LADO AC (SALIDA)
  //  Lo que el inversor entrega al sistema después de la conversión DC→AC.
  //  Incluye generación + descarga de batería − carga de batería.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'Pac', label: 'Potencia AC inversor', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia activa AC que el inversor está entregando ahora mismo. ' +
      'Composición: PV (Ppv1+Ppv2) + descarga de batería − carga de batería − pérdidas de conversión (~3-5%). ' +
      'Si querés ver solo la generación solar pura, usá las Ppv* en lugar de Pac.',
  },
  {
    key: 'Sac', label: 'Potencia aparente AC', unit: 'VA',
    category: 'energia', source: 'metrum',
    description:
      'Potencia aparente — vector que combina activa y reactiva. ' +
      'Relación clave: cos φ = Pac / Sac. ' +
      'Si Pac y Sac son muy parecidos → cos φ ≈ 1 (ideal). Si Sac >> Pac → mucha reactiva (mal factor de potencia).',
  },
  {
    key: 'Qac', label: 'Potencia reactiva AC', unit: 'var',
    category: 'energia', source: 'metrum',
    description:
      'Potencia reactiva del inversor. Convención: positivo = inductiva, negativo = capacitiva. ' +
      'Es la variable que controlamos via API cuando enviamos el comando set_reactive_power para corregir cos φ y evitar penalización CREG.',
  },
  {
    key: 'Vac', label: 'Voltaje AC', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description:
      'Voltaje AC instantáneo en la salida del inversor. ' +
      'Nominal en Colombia residencial: ~120V monofásico, ~208V o ~220V trifásico. ' +
      'Variaciones > ±10% indican problemas de la red local.',
  },
  {
    key: 'Iac', label: 'Corriente AC', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente AC que sale del inversor. ' +
      'Para inversor trifásico, esta key suele ser el promedio o la fase principal — para detalle por fase se usan currentA/B/C del medidor solar.',
  },
  {
    key: 'Freq', label: 'Frecuencia AC', unit: 'Hz',
    category: 'estado', source: 'metrum',
    description:
      'Frecuencia de la red eléctrica que el inversor está siguiendo (o formando si está en isla). ' +
      'Nominal Colombia: 60 Hz ± 0.5. ' +
      'Caídas por debajo de 59 Hz indican falla mayor del operador; subidas > 61 Hz son menos comunes.',
  },
  {
    key: 'cosPhi', label: 'Factor de potencia', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Factor de potencia instantáneo (cos φ) del inversor. Rango -1 a +1. ' +
      'CREG exige ≥ 0.9. Por debajo de eso la casa entra en zona de penalización mensual. ' +
      'Lo podemos ajustar remotamente vía API DEYE/Livoltek (cuando tengamos credenciales OEM) con set_power_factor.',
  },
  {
    key: 'Tinv', label: 'Temperatura inversor', unit: '°C',
    category: 'estado', source: 'metrum',
    description:
      'Temperatura interna del inversor. ' +
      'Operación normal: 30-60°C. Por encima de ~70°C inicia derating (baja la potencia para protegerse). Arriba de 85°C se apaga preventivamente. ' +
      'Si crece sostenidamente, probable ventilación obstruida o ubicación con mala disipación.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  BATERÍA — TELEMETRÍA INSTANTÁNEA
  //  En instalaciones con almacenamiento (Pylontech Force L1, DEYE GB-L,
  //  Livoltek BHF). El SOC se usa en alertas y reportes.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'Pbat', label: 'Potencia batería neta', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia neta de la batería. ' +
      'Positivo = batería entregando energía (descargando). ' +
      'Negativo = batería absorbiendo energía (cargando). ' +
      'Cerca de cero = batería en reposo.',
  },
  {
    key: 'Pcharge', label: 'Potencia carga batería', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia con que se está cargando la batería en este instante (siempre ≥ 0). ' +
      'Cuando hay sol y la casa consume menos que la generación, este número crece. ' +
      'Cero si la batería está descargando o en reposo.',
  },
  {
    key: 'Pdischarge', label: 'Potencia descarga batería', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia con que la batería está entregando energía (siempre ≥ 0). ' +
      'Típicamente sube al anochecer (cuando ya no hay sol pero hay carga) y en cortes de red. ' +
      'Cero si está cargando o en reposo.',
  },
  {
    key: 'Vbat', label: 'Voltaje batería', unit: 'V',
    category: 'voltaje', source: 'metrum',
    description:
      'Voltaje DC del bus de batería. ' +
      'Sistema LV (DEYE SG04LP3 / Pylontech): ~48V nominal, rango 42-58V. ' +
      'Sistema HV (DEYE SG01HP3 / Livoltek BHF): ~150-500V dependiendo de la cantidad de módulos en serie. ' +
      'Refleja el SOC: voltaje bajo = batería descargada.',
  },
  {
    key: 'Ibat', label: 'Corriente batería', unit: 'A',
    category: 'corriente', source: 'metrum',
    description:
      'Corriente DC de la batería. ' +
      'Convención típica: positivo = descarga, negativo = carga. ' +
      'Combinada con Vbat da la potencia: P = V × I.',
  },
  {
    key: 'Tbat', label: 'Temperatura batería', unit: '°C',
    category: 'estado', source: 'metrum',
    description:
      'Temperatura del módulo de batería (la celda más caliente generalmente). ' +
      'Rango operativo típico: 0-50°C. Fuera de eso el BMS limita corriente para proteger las celdas. ' +
      'Sobre 55°C es riesgo serio — revisar ventilación / disposición.',
  },
  {
    key: 'BattCycles', label: 'Ciclos de batería', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Número total de ciclos carga-descarga acumulados desde que la batería es nueva. ' +
      'Indicador de vida útil. ' +
      'LiFePO4 (típico residencial): ~6000 ciclos antes de bajar a 80% de capacidad original. ' +
      'A 1 ciclo/día son ~16 años nominales; en uso real con ciclos parciales esto se extiende.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  FLUJOS DE ENERGÍA (DEYE Hybrid)
  //  El DEYE expone explícitamente cada flujo del nodo central del inversor.
  //  En Livoltek estos flujos se infieren de Pac, Pbat y medidores externos.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'gridPower', label: 'Potencia a/desde red (DEYE)', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Flujo neto con la red eléctrica medido por el inversor DEYE en su pinza de red. ' +
      'Positivo = importando de Promigas. Negativo = exportando excedente. ' +
      'Específico de inversores DEYE Hybrid con CT clamps; Livoltek no expone esto directamente.',
  },
  {
    key: 'loadPower', label: 'Potencia a cargas (DEYE)', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia que está entregando el inversor a las cargas conectadas al puerto Load/Backup. ' +
      'Esta es la demanda real de la casa en ese instante (lo que efectivamente consume el usuario, sin importar de dónde venga). ' +
      'Específico de inversores DEYE Hybrid.',
  },
  {
    key: 'genPower', label: 'Potencia generador (DEYE)', unit: 'W',
    category: 'energia', source: 'metrum',
    description:
      'Potencia entregada por un generador diésel auxiliar (si está conectado al puerto Gen del DEYE). ' +
      'En instalaciones sin generador este valor es siempre 0. ' +
      'Específico de DEYE Hybrid.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  ATRIBUTOS DEL INVERSOR  (no son timeseries, son metadatos del equipo)
  //  Se cargan una vez del SERVER_SCOPE de Metrum y se persisten en devices.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'invbrand', label: 'Marca inversor', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Fabricante del inversor. En el piloto Promigas hay dos marcas: ' +
      'LIVOLTEK (HP* — naming alfanumérico, ej. HP315K2HWC290023) y ' +
      'DEYE (numéricos de 8 dígitos que empiezan con 24 o 25 = año de fabricación).',
  },
  {
    key: 'invmodel', label: 'Modelo inversor', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Modelo específico del inversor. ' +
      'Ej. Livoltek: HP3-10KL2 (10 kW trifásico), HP3-15KH2 (15 kW). ' +
      'Ej. DEYE: SUN-15K-SG01HP3 (15 kW trifásico hybrid HV), SUN-6K-SG04LP3 (6 kW LV).',
  },
  {
    key: 'invcap', label: 'Capacidad inversor', unit: 'kW',
    category: 'energia', source: 'metrum',
    description:
      'Potencia nominal del inversor en kW. Es el valor de placa, no la generación real. ' +
      'Se usa para calcular yield (= generación / capacidad) y para dimensionar reservas de paneles.',
  },
  {
    key: 'invarray', label: 'Paneles del inversor', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Número de paneles solares conectados a este inversor (configuración inicial registrada en Metrum).',
  },
  {
    key: 'invtype', label: 'Tipo inversor', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Topología del inversor: ' +
      'Hibrido = puede manejar batería y red (los del piloto) · ' +
      'On-Grid = solo inyecta a red sin batería · ' +
      'Off-Grid = solo opera en isla sin red.',
  },
  {
    key: 'BattSn', label: 'Serial batería', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Número de serie de la batería conectada al inversor. Útil para trazabilidad de garantías y eventos de servicio.',
  },
  {
    key: 'TLinvstate', label: 'Estado inversor (DEYE)', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Estado on/off del inversor DEYE. ' +
      '"on" = generando o disponible. "off" = apagado (por usuario, por falla o por programación). ' +
      'Si está "off" durante horas de sol, hay alerta — algo lo detuvo y no está generando.',
  },
  {
    key: 'TLBattSOC', label: 'Estado de carga batería (SOC)', unit: '%',
    category: 'estado', source: 'metrum',
    description:
      'State of Charge — porcentaje de carga actual de la batería. ' +
      '0% = vacía, 100% = llena. ' +
      'Operación recomendada: ciclar entre ~20% y ~90% para maximizar vida útil. ' +
      'Si nunca pasa de 50% o nunca baja de 70%, la batería no está ciclando bien (problema de configuración o de uso).',
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  ATRIBUTOS GENERALES  (ubicación, identificación, organización)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'spcus', label: 'Casa / Cliente', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Nombre del cliente o casa donde está instalado el equipo, como se lo asignó en Metrum. ' +
      'Ej: "Casa 2", "Casa 23p" (la "p" suele indicar piso o variante), "Piloto Promigas".',
  },
  {
    key: 'gateway', label: 'Gateway padre', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Nombre del gateway Pulsar (IN*) al que está conectado el dispositivo. ' +
      'Cada casa tiene un Pulsar que recolecta data de sus inversores + medidores y la sube a Metrum. ' +
      'Si el Pulsar está offline, todos los dispositivos de esa casa se ven offline aunque estén funcionando.',
  },
  {
    key: 'mettype', label: 'Tipo medidor', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'Subtipo del medidor STAR DDSY23S/DTSY23S: ' +
      '"red" = mide intercambio con la red (importación/exportación), ' +
      '"solar" = mide la salida AC del sistema solar antes de mezclarse con la casa.',
  },
  {
    key: 'active', label: 'Activo', unit: '',
    category: 'estado', source: 'metrum',
    description:
      'true = Metrum recibió datos del dispositivo recientemente (está online). ' +
      'false = sin datos recientes (offline o desconectado). ' +
      'Si todos los dispositivos de una casa están false, probablemente es el Pulsar el que se cayó.',
  },
  {
    key: 'zone', label: 'Ubicación / Conjunto', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Conjunto residencial o ubicación física donde está la casa (ej. "RESERVAS DE PANCE", "BOSQUES DE PANCE").',
  },
  {
    key: 'city', label: 'Ciudad', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Ciudad donde está instalada la casa. En el piloto Promigas todas son Cali.',
  },
  {
    key: 'dept', label: 'Departamento', unit: '',
    category: 'estado', source: 'metrum',
    description: 'Departamento de Colombia. En el piloto Promigas todas son Valle del Cauca.',
  },
  {
    key: 'latDev', label: 'Latitud GPS', unit: '°',
    category: 'estado', source: 'metrum',
    description: 'Latitud del gateway Pulsar (no de cada inversor individual). Solo está presente en devices tipo pulsar (IN*).',
  },
  {
    key: 'lonDev', label: 'Longitud GPS', unit: '°',
    category: 'estado', source: 'metrum',
    description: 'Longitud del gateway Pulsar. Solo está presente en devices tipo pulsar (IN*).',
  },
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
