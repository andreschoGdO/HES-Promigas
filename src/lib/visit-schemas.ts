/**
 * Catálogo de campos por tipo de visita.
 * Cada tipo se descompone en SECCIONES → cada sección tiene FIELDS.
 * Los valores se guardan en `field_visits.form_data` como JSON keyed por field.key.
 *
 * El schema de "previa" sigue la plantilla oficial PROMIGAS:
 * "Acta de Visita Previa y Prefactibilidad" — FO:Prefactibilidad
 */

export type VisitType = 'previa' | 'instalacion' | 'emergencia' | 'normalizacion';
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'date' | 'time' | 'checkbox' | 'radio' | 'tel' | 'email' | 'serial_list';

export interface VisitField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  unit?: string;
  inputMode?: 'numeric' | 'decimal' | 'tel' | 'email';
  help?: string;
  /** Solo `serial_list`: nombre de otro field cuya value indica cuántos inputs
   *  renderizar. Ej: qtyKey='panel_cantidad' → renderiza tantos inputs como
   *  panel_cantidad indique. Si el campo qty está vacío/0, usa qtyFallback. */
  qtyKey?: string;
  /** Solo `serial_list`: cantidad por default si qtyKey no está definido o su
   *  value no es un número > 0. Ej: 1 para inversor. */
  qtyFallback?: number;
  /** Solo `serial_list`: categoría de inventario asociada a este grupo. Se usa
   *  al transicionar a Operativo para mapear seriales al category_id correcto.
   *  Valores: 'inverter' | 'battery' | 'panel'. */
  serialFamily?: 'inverter' | 'battery' | 'panel';
}

export interface VisitSection {
  title: string;
  fields: VisitField[];
}

export interface VisitTypeSchema {
  type: VisitType;
  label: string;
  shortLabel: string;
  description: string;
  color: string;          // acento de marca (sin emoji)
  formCode: string;       // ej. FO:Prefactibilidad
  casaIsFreeText: boolean;  // si true, no se selecciona casa existente (es la primera visita)
  photoCategories: string[];  // categorías sugeridas para clasificar cada foto
  sections: VisitSection[];
}

export const VISIT_SCHEMAS: VisitTypeSchema[] = [
  // ───────── VISITA PREVIA Y PREFACTIBILIDAD ─────────
  {
    type: 'previa',
    label: 'Acta de Visita Previa y Prefactibilidad',
    shortLabel: 'Visita Previa',
    description: 'Inspección y diagnóstico del sitio previo a la instalación.',
    color: '#07c5a8',
    formCode: 'FO:Prefactibilidad',
    casaIsFreeText: true,
    photoCategories: ['Fachada de la casa', 'Medidor eléctrico', 'Tablero de distribución', 'Proyección ubicación de equipos', 'Tipo de cubierta', 'Cerchas identificadas', 'Vistas aéreas', 'Otro'],
    sections: [
      {
        title: 'I. Información general',
        fields: [
          { key: 'nombre_conjunto', label: 'Nombre del conjunto', type: 'text', required: true },
          { key: 'quien_recibe_visita', label: 'Quién recibe la visita', type: 'text', required: true },
          { key: 'ciudad', label: 'Ciudad', type: 'text', required: true },
          { key: 'direccion', label: 'Dirección', type: 'textarea', required: true },
          { key: 'coordenadas', label: 'Coordenadas (lat, lng)', type: 'text', placeholder: '3.3197, -76.5443' },
          { key: 'tipo_vivienda', label: 'Tipo de vivienda', type: 'select', options: ['Casa unifamiliar', 'Apartamento', 'Casa en conjunto cerrado', 'Local comercial', 'No tipo', 'Tipo', 'Otro'] },
          { key: 'estrato_socioeconomico', label: 'Estrato socioeconómico', type: 'select', options: ['1', '2', '3', '4', '5', '6'] },
        ],
      },
      {
        title: 'II. Demanda de consumos del cliente e información técnica',
        fields: [
          { key: 'consumo_mes_1', label: 'Consumo Mes 1', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'consumo_mes_2', label: 'Consumo Mes 2', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'consumo_mes_3', label: 'Consumo Mes 3', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'consumo_mes_4', label: 'Consumo Mes 4', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'consumo_mes_5', label: 'Consumo Mes 5', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'consumo_mes_6', label: 'Consumo Mes 6', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'operador_red', label: 'Operador de Red (OR)', type: 'select', options: ['EMCALI', 'CELSIA', 'ENEL Codensa', 'AIR-E', 'Afinia', 'Electricaribe', 'EPM', 'Otro'] },
          { key: 'numero_contrato_or', label: 'Número de contrato (OR)', type: 'text' },
          { key: 'capacidad_transformador_kva', label: 'Capacidad del transformador', type: 'number', inputMode: 'decimal', unit: 'kVA' },
          { key: 'nivel_tension_v', label: 'Nivel de tensión', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'numero_medidor', label: 'Número del medidor', type: 'text' },
          { key: 'tipo_medidor', label: 'Tipo de medidor', type: 'radio', options: ['Monofásico', 'Bifásico', 'Trifásico'], required: true },
        ],
      },
      {
        title: 'III. Información general de la vivienda',
        fields: [
          { key: 'tipo_cubierta', label: 'Tipo de cubierta', type: 'select', options: ['Teja barro', 'Teja eternit/asbesto', 'Teja metálica', 'Losa concreto', 'Membrana asfáltica', 'Otro'] },
          { key: 'medio_acceso_cubierta', label: 'Medio de acceso a cubierta', type: 'select', options: ['Escalera fija', 'Escalera externa', 'Andamio', 'Acceso por interior', 'Otro'] },
          { key: 'tipo_cerchas', label: 'Tipo de cerchas', type: 'text' },
          { key: 'puntos_anclaje', label: 'Puntos de anclaje', type: 'radio', options: ['Sí', 'No'] },
          { key: 'area_propuesta_cubierta_m2', label: 'Área propuesta en cubierta', type: 'number', inputMode: 'decimal', unit: 'm²' },
          { key: 'presencia_sombras', label: 'Presencia de sombras', type: 'radio', options: ['Sí', 'No'] },
          { key: 'orientacion_cardinal_cubierta', label: 'Orientación cardinal de la cubierta', type: 'select', options: ['Norte', 'Sur', 'Este', 'Oeste', 'NE', 'NO', 'SE', 'SO'] },
          { key: 'vehiculo_electrico', label: 'Vehículo eléctrico', type: 'radio', options: ['Sí', 'No'] },
          { key: 'distancia_cubierta_inversor', label: 'Distancia de cubierta al inversor', type: 'number', inputMode: 'decimal', unit: 'm' },
          { key: 'sistema_puesta_tierra', label: 'Sistema de puesta a tierra', type: 'radio', options: ['Sí', 'No'] },
          { key: 'distancia_tablero_inversor', label: 'Distancia tablero al inversor', type: 'number', inputMode: 'decimal', unit: 'm' },
          { key: 'proyectan_aumentar_consumos', label: 'Proyectan aumentar consumos', type: 'radio', options: ['Sí', 'No'] },
          { key: 'estado_tablero_principal', label: 'Estado del tablero principal', type: 'select', options: ['Excelente', 'Bueno', 'Regular', 'Malo'] },
          { key: 'interconexion_tablero', label: 'Interconexión en tablero', type: 'radio', options: ['Sí', 'No'] },
          { key: 'instalacion_equipos_ubicacion', label: 'Instalación de equipos: piso o cubierta', type: 'select', options: ['Piso', 'Cubierta', 'Mixto'] },
          { key: 'operador_telefonia_mejor_senal', label: 'Operador de telefonía con mejor señal', type: 'select', options: ['Claro', 'Movistar', 'Tigo', 'WOM', 'Otro'] },
        ],
      },
      {
        title: 'IV. Mediciones eléctricas',
        fields: [
          { key: 'tension_l1_n_v', label: 'Tensión L1–N', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'corriente_i1', label: 'Corriente I1', type: 'number', inputMode: 'decimal', unit: 'A' },
          { key: 'corriente_neutro', label: 'Corriente de neutro', type: 'number', inputMode: 'decimal', unit: 'A' },
          { key: 'tension_l2_n_v', label: 'Tensión L2–N', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'corriente_i2', label: 'Corriente I2', type: 'number', inputMode: 'decimal', unit: 'A' },
          { key: 'corriente_tierra', label: 'Corriente de tierra', type: 'number', inputMode: 'decimal', unit: 'A' },
          { key: 'tension_l3_n_v', label: 'Tensión L3–N', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'corriente_i3', label: 'Corriente I3', type: 'number', inputMode: 'decimal', unit: 'A' },
          { key: 'tension_n_pe_v', label: 'Tensión N–PE', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'tension_l1_l2_v', label: 'Tensión L1–L2', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'tension_l2_l3_v', label: 'Tensión L2–L3', type: 'number', inputMode: 'decimal', unit: 'V' },
          { key: 'tension_l3_l1_v', label: 'Tensión L3–L1', type: 'number', inputMode: 'decimal', unit: 'V' },
        ],
      },
      {
        title: 'VI. Observaciones',
        fields: [
          { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
        ],
      },
      {
        title: 'Aprobación',
        fields: [
          { key: 'aprobado', label: 'Resultado', type: 'radio', options: ['Aprobado', 'No aprobado'], required: true },
          { key: 'motivo_no_aprobado', label: 'Motivo (si no aprobado)', type: 'textarea' },
          { key: 'quien_realiza_visita', label: 'Quien realiza la visita', type: 'text', required: true, help: 'Nombre del técnico que firma el acta.' },
        ],
      },
    ],
  },

  // ───────── VISITA DE INSTALACIÓN ─────────
  {
    type: 'instalacion',
    label: 'Acta de Visita de Instalación',
    shortLabel: 'Instalación',
    description: 'Registro de la instalación física del sistema solar.',
    color: '#10b981',
    formCode: 'FO:Instalacion',
    casaIsFreeText: false,
    photoCategories: ['Inversor instalado', 'Paneles instalados', 'Tablero conectado', 'Gateway Pulsar', 'Medidor solar', 'Medidor red', 'Batería', 'Otro'],
    sections: [
      {
        title: 'I. Identificación de la instalación',
        fields: [
          { key: 'fecha_instalacion', label: 'Fecha de instalación', type: 'date', required: true },
          { key: 'cliente_presente', label: 'Cliente presente', type: 'radio', options: ['Sí', 'No'] },
        ],
      },
      {
        title: 'II. Inversor instalado',
        fields: [
          { key: 'inv_marca', label: 'Marca del inversor', type: 'select', options: ['LIVOLTEK', 'DEYE', 'Huawei', 'Sungrow', 'Otra'], required: true },
          { key: 'inv_modelo', label: 'Modelo', type: 'text', required: true },
          { key: 'inv_cantidad', label: 'Cantidad de inversores', type: 'number', inputMode: 'numeric', required: true, help: 'Normalmente 1. Si hay varios en paralelo, ajustar.' },
          { key: 'inv_serials', label: 'Seriales de inversor', type: 'serial_list', required: true, qtyKey: 'inv_cantidad', qtyFallback: 1, serialFamily: 'inverter', help: 'Un input por unidad. Escaneá el QR o transcribí el serial impreso.' },
          { key: 'inv_potencia_kw', label: 'Potencia nominal', type: 'number', inputMode: 'decimal', unit: 'kW', required: true },
          { key: 'inv_ubicacion', label: 'Ubicación física', type: 'text' },
        ],
      },
      {
        title: 'III. Paneles solares',
        fields: [
          { key: 'panel_marca', label: 'Marca de paneles', type: 'text' },
          { key: 'panel_modelo', label: 'Modelo', type: 'text' },
          { key: 'panel_cantidad', label: 'Cantidad instalada', type: 'number', inputMode: 'numeric', required: true },
          { key: 'panel_serials', label: 'Seriales de paneles', type: 'serial_list', required: true, qtyKey: 'panel_cantidad', serialFamily: 'panel', help: 'Un input por panel. Debe coincidir con "Cantidad instalada".' },
          { key: 'panel_potencia_wp', label: 'Potencia c/u', type: 'number', inputMode: 'numeric', unit: 'Wp' },
          { key: 'panel_total_kwp', label: 'Total kWp instalados', type: 'number', inputMode: 'decimal', unit: 'kWp' },
          { key: 'configuracion_strings', label: 'Configuración de strings', type: 'text' },
        ],
      },
      {
        title: 'IV. Batería (si aplica)',
        fields: [
          { key: 'batt_presente', label: 'Lleva batería', type: 'radio', options: ['Sí', 'No'] },
          { key: 'batt_marca', label: 'Marca batería', type: 'text' },
          { key: 'batt_modelo', label: 'Modelo', type: 'text' },
          { key: 'batt_capacidad_kwh', label: 'Capacidad por batería', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'batt_cantidad', label: 'Cantidad de baterías', type: 'number', inputMode: 'numeric' },
          { key: 'batt_serials', label: 'Seriales de baterías', type: 'serial_list', qtyKey: 'batt_cantidad', serialFamily: 'battery', help: 'Un input por batería. Debe coincidir con "Cantidad de baterías".' },
          { key: 'bms_marca', label: 'Marca del BMS', type: 'text' },
          { key: 'bms_serial', label: 'Serial del BMS', type: 'text', help: 'Battery Management System — normalmente uno solo por banco de baterías.' },
        ],
      },
      {
        title: 'V. Gateway Pulsar y medidores',
        fields: [
          { key: 'gateway_serial', label: 'Serial(es) del Pulsar', type: 'textarea', required: true, help: 'Uno por línea si hay redundancia.' },
          { key: 'gateway_simcard', label: 'Número SIM card 4G', type: 'text' },
          { key: 'meter_solar_serial', label: 'Serial(es) medidor solar', type: 'textarea', required: true, help: 'Uno por línea.' },
          { key: 'meter_red_serial', label: 'Serial(es) medidor de red', type: 'textarea', required: true, help: 'Uno por línea.' },
        ],
      },
      {
        title: 'VI. Pruebas y puesta en marcha',
        fields: [
          { key: 'cierre_electrico_ok', label: 'Cierre eléctrico verificado', type: 'checkbox' },
          { key: 'polaridad_dc_ok', label: 'Polaridad DC correcta', type: 'checkbox' },
          { key: 'aterrizaje_ok', label: 'Aterrizaje verificado', type: 'checkbox' },
          { key: 'inversor_arranca', label: 'Inversor arranca correctamente', type: 'checkbox' },
          { key: 'gateway_online', label: 'Gateway conectado a Metrum', type: 'checkbox' },
          { key: 'app_cliente_configurada', label: 'App del cliente configurada', type: 'checkbox' },
          { key: 'lectura_inicial_kwh', label: 'Lectura inicial generación', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'observaciones_pruebas', label: 'Observaciones', type: 'textarea' },
        ],
      },
      {
        title: 'VII. Conformidad',
        fields: [
          { key: 'cliente_recibio', label: 'Cliente recibió a satisfacción', type: 'radio', options: ['Sí', 'No', 'Con observaciones'], required: true },
          { key: 'observaciones_cliente', label: 'Observaciones del cliente', type: 'textarea' },
          { key: 'pendientes', label: 'Pendientes a cerrar', type: 'textarea' },
          { key: 'quien_realiza_visita', label: 'Quien realiza la visita', type: 'text', required: true },
        ],
      },
    ],
  },

  // ───────── VISITA DE EMERGENCIA ─────────
  {
    type: 'emergencia',
    label: 'Acta de Visita de Emergencia',
    shortLabel: 'Emergencia',
    description: 'Atención a fallas, paradas o requerimientos urgentes.',
    color: '#ef4444',
    formCode: 'FO:Emergencia',
    casaIsFreeText: false,
    photoCategories: ['Equipo afectado', 'Daño visible', 'Antes de intervención', 'Durante intervención', 'Después de intervención', 'Repuestos usados', 'Otro'],
    sections: [
      {
        title: 'I. Motivo del llamado',
        fields: [
          { key: 'reportado_por', label: 'Reportado por', type: 'text' },
          { key: 'fecha_reporte', label: 'Fecha del reporte', type: 'date' },
          { key: 'hora_reporte', label: 'Hora del reporte', type: 'time' },
          { key: 'urgencia', label: 'Nivel de urgencia', type: 'select', options: ['Alta - sistema fuera', 'Media - operativo con falla', 'Baja - consulta'] },
          { key: 'descripcion_falla', label: 'Descripción del problema reportado', type: 'textarea', required: true },
        ],
      },
      {
        title: 'II. Estado encontrado',
        fields: [
          { key: 'equipo_afectado', label: 'Equipo afectado', type: 'select', options: ['Inversor', 'Paneles', 'Medidor solar', 'Medidor red', 'Gateway Pulsar', 'Batería', 'Cableado', 'Breaker', 'Otro'] },
          { key: 'codigo_falla', label: 'Código de falla', type: 'text' },
          { key: 'led_estado', label: 'Estado de LEDs / pantalla', type: 'text' },
          { key: 'diagnostico_inicial', label: 'Diagnóstico inicial', type: 'textarea', required: true },
        ],
      },
      {
        title: 'III. Acciones realizadas',
        fields: [
          { key: 'acciones', label: 'Acciones tomadas en sitio', type: 'textarea', required: true },
          { key: 'repuestos_usados', label: 'Repuestos y consumibles usados', type: 'textarea' },
          { key: 'duracion_min', label: 'Tiempo total de intervención', type: 'number', inputMode: 'numeric', unit: 'min' },
        ],
      },
      {
        title: 'IV. Resultado',
        fields: [
          { key: 'resuelto', label: 'Quedó resuelto', type: 'radio', options: ['Sí, totalmente', 'Parcial - requiere seguimiento', 'No - escala a fábrica'], required: true },
          { key: 'requiere_repuesto', label: 'Requiere repuesto o RMA', type: 'radio', options: ['Sí', 'No'] },
          { key: 'descripcion_repuesto', label: 'Detalle del repuesto necesario', type: 'textarea' },
          { key: 'fecha_seguimiento', label: 'Fecha próximo seguimiento', type: 'date' },
          { key: 'lectura_post_intervencion', label: 'Lectura o estado post-intervención', type: 'textarea' },
          { key: 'firma_cliente', label: 'Cliente firmó conformidad', type: 'checkbox' },
          { key: 'quien_realiza_visita', label: 'Quien realiza la visita', type: 'text', required: true },
        ],
      },
    ],
  },

  // ───────── VISITA DE NORMALIZACIÓN ─────────
  {
    type: 'normalizacion',
    label: 'Acta de Visita de Normalización',
    shortLabel: 'Normalización',
    description: 'Revisión y ajustes para dejar el sistema en condiciones óptimas según norma.',
    color: '#f59e0b',
    formCode: 'FO:Normalizacion',
    casaIsFreeText: false,
    photoCategories: ['Estado inicial', 'Estado final', 'Cambios aplicados', 'Rotulación', 'Documentación entregada', 'Lectura medidor solar', 'Lectura medidor red', 'Otro'],
    sections: [
      {
        title: 'I. Razón de la normalización',
        fields: [
          { key: 'motivo', label: 'Motivo principal', type: 'select', options: ['Auditoría de calidad', 'Cumplimiento norma RETIE', 'Resolución CREG penalización', 'Cambio comercializador', 'Solicitud cliente', 'Otro'], required: true },
          { key: 'motivo_detalle', label: 'Detalle del motivo', type: 'textarea' },
          { key: 'documento_referencia', label: 'Documento de referencia (oficio, OC, etc.)', type: 'text' },
        ],
      },
      {
        title: 'II. Estado encontrado',
        fields: [
          { key: 'estado_general', label: 'Estado general del sistema', type: 'select', options: ['Excelente', 'Bueno', 'Regular', 'Malo'] },
          { key: 'factor_potencia_medido', label: 'Factor de potencia medido', type: 'number', inputMode: 'decimal' },
          { key: 'temperatura_inversor_c', label: 'Temperatura inversor', type: 'number', inputMode: 'decimal', unit: '°C' },
          { key: 'apriete_borneras_ok', label: 'Apriete de borneras revisado', type: 'checkbox' },
          { key: 'limpieza_paneles_ok', label: 'Limpieza de paneles ejecutada', type: 'checkbox' },
          { key: 'aterrizaje_ok', label: 'Aterrizaje verificado', type: 'checkbox' },
          { key: 'rotulado_ok', label: 'Rotulación según norma RETIE', type: 'checkbox' },
          { key: 'observaciones_estado', label: 'Observaciones del estado', type: 'textarea' },
        ],
      },
      {
        title: 'III. Cambios aplicados',
        fields: [
          { key: 'config_inversor_modificada', label: 'Configuración del inversor modificada', type: 'checkbox' },
          { key: 'detalle_config', label: 'Detalle de cambios de configuración', type: 'textarea' },
          { key: 'firmware_actualizado', label: 'Firmware actualizado', type: 'checkbox' },
          { key: 'cambio_equipos', label: 'Equipos reemplazados', type: 'textarea' },
          { key: 'rotulado_aplicado', label: 'Rotulación añadida', type: 'textarea' },
        ],
      },
      {
        title: 'IV. Pruebas finales',
        fields: [
          { key: 'prueba_generacion_kw', label: 'Potencia de generación medida', type: 'number', inputMode: 'decimal', unit: 'kW' },
          { key: 'fp_final', label: 'Factor de potencia final', type: 'number', inputMode: 'decimal' },
          { key: 'lectura_final_solar', label: 'Lectura medidor solar', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'lectura_final_red', label: 'Lectura medidor red', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'pruebas_ok', label: 'Todas las pruebas pasaron', type: 'checkbox' },
          { key: 'observaciones_pruebas', label: 'Observaciones', type: 'textarea' },
        ],
      },
      {
        title: 'V. Documentación',
        fields: [
          { key: 'acta_entregada', label: 'Acta entregada al cliente', type: 'checkbox' },
          { key: 'manual_entregado', label: 'Manual de operación entregado', type: 'checkbox' },
          { key: 'capacitacion_cliente', label: 'Capacitación al cliente realizada', type: 'checkbox' },
          { key: 'pendientes', label: 'Pendientes', type: 'textarea' },
          { key: 'quien_realiza_visita', label: 'Quien realiza la visita', type: 'text', required: true },
        ],
      },
    ],
  },
];

export const findSchema = (type: VisitType): VisitTypeSchema | undefined =>
  VISIT_SCHEMAS.find((s) => s.type === type);
