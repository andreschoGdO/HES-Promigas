/**
 * Catálogo de campos por tipo de visita.
 * Cada tipo se descompone en SECCIONES → cada sección tiene FIELDS.
 * Los valores se guardan en `field_visits.form_data` como JSON keyed por field.key.
 */

export type VisitType = 'previa' | 'instalacion' | 'emergencia' | 'normalizacion';
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'date' | 'time' | 'checkbox' | 'radio' | 'tel' | 'email';

export interface VisitField {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];               // para select y radio
  placeholder?: string;
  required?: boolean;
  unit?: string;                    // mostrar después del input (m², kW, etc.)
  inputMode?: 'numeric' | 'decimal' | 'tel' | 'email';
  help?: string;
}

export interface VisitSection {
  title: string;
  icon?: string;
  fields: VisitField[];
}

export interface VisitTypeSchema {
  type: VisitType;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  color: string;
  sections: VisitSection[];
}

export const VISIT_SCHEMAS: VisitTypeSchema[] = [
  // ───────── VISITA PREVIA ─────────
  {
    type: 'previa',
    label: 'Visita Previa',
    shortLabel: 'Previa',
    description: 'Inspección del sitio antes de la instalación del sistema solar.',
    icon: '🔍',
    color: '#3b82f6',
    sections: [
      {
        title: 'Datos de la casa',
        icon: '🏠',
        fields: [
          { key: 'propietario', label: 'Nombre del propietario', type: 'text', required: true, placeholder: 'Nombre completo' },
          { key: 'cedula', label: 'Cédula / documento', type: 'tel', inputMode: 'numeric', placeholder: '1.234.567.890' },
          { key: 'telefono', label: 'Teléfono de contacto', type: 'tel', inputMode: 'tel', placeholder: '300 123 4567' },
          { key: 'email', label: 'Email', type: 'email', inputMode: 'email', placeholder: 'correo@ejemplo.com' },
          { key: 'direccion', label: 'Dirección completa', type: 'textarea', required: true, placeholder: 'Carrera X #Y-Z, Conjunto, Apartamento/Casa' },
          { key: 'tipo_predio', label: 'Tipo de predio', type: 'select', options: ['Casa unifamiliar', 'Apartamento', 'Conjunto cerrado', 'Local comercial', 'Otro'] },
        ],
      },
      {
        title: 'Datos eléctricos',
        icon: '⚡',
        fields: [
          { key: 'comercializador', label: 'Comercializador actual', type: 'select', options: ['EMCALI', 'Energía Pacífico', 'CELSIA', 'ENEL Codensa', 'AIR-E', 'Afinia', 'Otro'] },
          { key: 'nic', label: 'NIC / # cuenta contrato', type: 'text', placeholder: 'Tomado del recibo' },
          { key: 'estrato', label: 'Estrato', type: 'select', options: ['1', '2', '3', '4', '5', '6'] },
          { key: 'tipo_servicio', label: 'Tipo de servicio', type: 'select', options: ['Monofásico bifilar', 'Monofásico trifilar', 'Trifásico tetrafilar'] },
          { key: 'tension_nominal', label: 'Tensión nominal', type: 'select', options: ['120V', '208V', '220V', '240V', '440V'] },
          { key: 'capacidad_breaker', label: 'Capacidad del breaker principal', type: 'number', inputMode: 'numeric', unit: 'A', placeholder: '80' },
          { key: 'medidor_actual', label: 'Tipo de medidor actual', type: 'select', options: ['Electromecánico', 'Electrónico simple', 'Bidireccional', 'Inteligente AMI', 'No identificado'] },
          { key: 'consumo_mensual_kwh', label: 'Consumo mensual promedio', type: 'number', inputMode: 'decimal', unit: 'kWh', placeholder: 'De factura' },
          { key: 'aire_acondicionados', label: '¿Cuántos aires acondicionados tiene?', type: 'number', inputMode: 'numeric', placeholder: '0' },
        ],
      },
      {
        title: 'Datos del techo / espacio FV',
        icon: '☀️',
        fields: [
          { key: 'tipo_techo', label: 'Tipo de cubierta', type: 'select', options: ['Teja barro', 'Teja eternit/asbesto', 'Teja metálica', 'Losa concreto', 'Membrana asfáltica', 'Otro'], required: true },
          { key: 'orientacion', label: 'Orientación principal', type: 'select', options: ['Norte', 'Sur', 'Este', 'Oeste', 'NE', 'NO', 'SE', 'SO'] },
          { key: 'pendiente_grados', label: 'Pendiente del techo', type: 'number', inputMode: 'decimal', unit: '°', placeholder: '15' },
          { key: 'area_disponible_m2', label: 'Área disponible aproximada', type: 'number', inputMode: 'decimal', unit: 'm²', placeholder: '60' },
          { key: 'sombras', label: 'Sombras detectadas', type: 'select', options: ['Sin sombras', 'Sombras de mañana', 'Sombras de tarde', 'Sombras parciales todo el día', 'Sombras significativas'] },
          { key: 'fuente_sombra', label: '¿Qué genera la sombra?', type: 'text', placeholder: 'Árbol, edificio vecino, tanque agua...' },
          { key: 'estado_techo', label: 'Estado estructural del techo', type: 'select', options: ['Excelente', 'Bueno', 'Regular (requiere refuerzo)', 'Malo (no apto)'] },
        ],
      },
      {
        title: 'Acceso y logística',
        icon: '🛠️',
        fields: [
          { key: 'acceso_techo', label: 'Acceso al techo', type: 'select', options: ['Fácil (escalera fija)', 'Medio (escalera externa)', 'Difícil (andamio requerido)'] },
          { key: 'distancia_panel_inversor_m', label: 'Distancia paneles → ubicación inversor', type: 'number', inputMode: 'decimal', unit: 'm', placeholder: '10' },
          { key: 'espacio_inversor', label: '¿Hay espacio adecuado para el inversor?', type: 'radio', options: ['Sí', 'No', 'Por confirmar'] },
          { key: 'requiere_hoa', label: '¿Requiere permiso de copropiedad/HOA?', type: 'radio', options: ['Sí', 'No', 'No aplica'] },
          { key: 'restricciones', label: 'Restricciones / comentarios', type: 'textarea', placeholder: 'Horarios permitidos, observaciones del administrador...' },
        ],
      },
      {
        title: 'Recomendación técnica',
        icon: '✅',
        fields: [
          { key: 'apto_para_instalacion', label: '¿Apto para instalación?', type: 'radio', options: ['Sí', 'Sí con ajustes', 'No'], required: true },
          { key: 'capacidad_recomendada_kw', label: 'Capacidad recomendada', type: 'number', inputMode: 'decimal', unit: 'kWp', placeholder: '10' },
          { key: 'numero_paneles_recomendado', label: 'N° paneles propuestos', type: 'number', inputMode: 'numeric', placeholder: '20' },
          { key: 'tipo_inversor_recomendado', label: 'Tipo de inversor', type: 'select', options: ['Livoltek HP3', 'DEYE Híbrido', 'On-Grid simple', 'A definir'] },
          { key: 'incluye_bateria', label: '¿Incluye batería?', type: 'radio', options: ['Sí', 'No', 'Opcional'] },
          { key: 'observaciones', label: 'Observaciones finales', type: 'textarea' },
        ],
      },
    ],
  },

  // ───────── VISITA DE INSTALACIÓN ─────────
  {
    type: 'instalacion',
    label: 'Visita de Instalación',
    shortLabel: 'Instalación',
    description: 'Acta de la instalación física del sistema solar.',
    icon: '🔧',
    color: '#10b981',
    sections: [
      {
        title: 'Identificación de la instalación',
        icon: '📋',
        fields: [
          { key: 'fecha_instalacion', label: 'Fecha de instalación', type: 'date', required: true },
          { key: 'hora_inicio', label: 'Hora inicio', type: 'time' },
          { key: 'hora_fin', label: 'Hora finalización', type: 'time' },
          { key: 'cuadrilla', label: 'Cuadrilla / equipo', type: 'text', placeholder: 'Nombres de los técnicos' },
          { key: 'cliente_presente', label: '¿Cliente presente?', type: 'radio', options: ['Sí', 'No'] },
        ],
      },
      {
        title: 'Inversor instalado',
        icon: '⚡',
        fields: [
          { key: 'inv_marca', label: 'Marca del inversor', type: 'select', options: ['LIVOLTEK', 'DEYE', 'Huawei', 'Sungrow', 'Otra'], required: true },
          { key: 'inv_modelo', label: 'Modelo', type: 'text', required: true, placeholder: 'HP3-10KL2 / SUN-15K-SG01HP3' },
          { key: 'inv_serial', label: 'Número de serie', type: 'text', required: true, placeholder: 'HP310K2HWC290002' },
          { key: 'inv_potencia_kw', label: 'Potencia nominal', type: 'number', inputMode: 'decimal', unit: 'kW', required: true },
          { key: 'inv_ubicacion', label: 'Ubicación física', type: 'text', placeholder: 'Cuarto técnico, pared norte, etc.' },
        ],
      },
      {
        title: 'Paneles solares',
        icon: '☀️',
        fields: [
          { key: 'panel_marca', label: 'Marca de paneles', type: 'text', placeholder: 'Jinko / Trina / Canadian Solar / etc.' },
          { key: 'panel_modelo', label: 'Modelo', type: 'text' },
          { key: 'panel_cantidad', label: 'Cantidad instalada', type: 'number', inputMode: 'numeric', required: true },
          { key: 'panel_potencia_wp', label: 'Potencia c/u', type: 'number', inputMode: 'numeric', unit: 'Wp', placeholder: '550' },
          { key: 'panel_total_kwp', label: 'Total kWp instalados', type: 'number', inputMode: 'decimal', unit: 'kWp' },
          { key: 'configuracion_strings', label: 'Configuración de strings', type: 'text', placeholder: '2 strings × 10 paneles' },
        ],
      },
      {
        title: 'Batería (si aplica)',
        icon: '🔋',
        fields: [
          { key: 'batt_presente', label: '¿Lleva batería?', type: 'radio', options: ['Sí', 'No'] },
          { key: 'batt_marca', label: 'Marca batería', type: 'text', placeholder: 'BYD / DEYE / Pylontech' },
          { key: 'batt_modelo', label: 'Modelo', type: 'text' },
          { key: 'batt_capacidad_kwh', label: 'Capacidad', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'batt_serial', label: 'Serial', type: 'text' },
        ],
      },
      {
        title: 'Gateway Pulsar + Medidores',
        icon: '📡',
        fields: [
          { key: 'gateway_serial', label: 'Serial del Pulsar', type: 'text', placeholder: 'IN42420XXX', required: true },
          { key: 'gateway_simcard', label: '# SIM card 4G', type: 'text' },
          { key: 'meter_solar_serial', label: 'Serial medidor solar', type: 'text', placeholder: '2223005XXX', required: true },
          { key: 'meter_red_serial', label: 'Serial medidor de red', type: 'text', placeholder: '2223005XXX', required: true },
        ],
      },
      {
        title: 'Pruebas y puesta en marcha',
        icon: '🧪',
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
        title: 'Conformidad',
        icon: '✍️',
        fields: [
          { key: 'cliente_recibio', label: 'Cliente recibió a satisfacción', type: 'radio', options: ['Sí', 'No', 'Con observaciones'], required: true },
          { key: 'observaciones_cliente', label: 'Observaciones del cliente', type: 'textarea' },
          { key: 'pendientes', label: 'Pendientes a cerrar', type: 'textarea' },
        ],
      },
    ],
  },

  // ───────── VISITA DE EMERGENCIA ─────────
  {
    type: 'emergencia',
    label: 'Visita de Emergencia',
    shortLabel: 'Emergencia',
    description: 'Atención a fallas, paradas, alarmas o requerimientos urgentes.',
    icon: '🚨',
    color: '#ef4444',
    sections: [
      {
        title: 'Motivo del llamado',
        icon: '📞',
        fields: [
          { key: 'reportado_por', label: 'Reportado por', type: 'text', placeholder: 'Cliente / SAC / Monitoreo' },
          { key: 'fecha_reporte', label: 'Fecha del reporte', type: 'date' },
          { key: 'hora_reporte', label: 'Hora del reporte', type: 'time' },
          { key: 'urgencia', label: 'Nivel de urgencia', type: 'select', options: ['Alta - sistema fuera', 'Media - operativo con falla', 'Baja - consulta'] },
          { key: 'descripcion_falla', label: 'Descripción del problema reportado', type: 'textarea', required: true },
        ],
      },
      {
        title: 'Estado encontrado',
        icon: '🔍',
        fields: [
          { key: 'equipo_afectado', label: 'Equipo afectado', type: 'select', options: ['Inversor', 'Paneles', 'Medidor solar', 'Medidor red', 'Gateway Pulsar', 'Batería', 'Cableado', 'Breaker', 'Otro'] },
          { key: 'codigo_falla', label: 'Código de falla (si aparece en pantalla/app)', type: 'text', placeholder: 'Ej: E040, ECEO, etc.' },
          { key: 'led_estado', label: 'Estado de LEDs/pantalla', type: 'text' },
          { key: 'diagnostico_inicial', label: 'Diagnóstico inicial', type: 'textarea', required: true },
        ],
      },
      {
        title: 'Acciones realizadas',
        icon: '🔧',
        fields: [
          { key: 'acciones', label: 'Acciones tomadas en sitio', type: 'textarea', required: true, placeholder: 'Reinicio, cambio de fusible, ajuste de torque, etc.' },
          { key: 'repuestos_usados', label: 'Repuestos / consumibles usados', type: 'textarea' },
          { key: 'duracion_min', label: 'Tiempo total de intervención', type: 'number', inputMode: 'numeric', unit: 'min' },
        ],
      },
      {
        title: 'Resultado',
        icon: '✅',
        fields: [
          { key: 'resuelto', label: '¿Quedó resuelto?', type: 'radio', options: ['Sí, totalmente', 'Parcial - requiere seguimiento', 'No - escala a fábrica'], required: true },
          { key: 'requiere_repuesto', label: '¿Requiere repuesto/RMA?', type: 'radio', options: ['Sí', 'No'] },
          { key: 'descripcion_repuesto', label: 'Detalle del repuesto necesario', type: 'textarea' },
          { key: 'fecha_seguimiento', label: 'Fecha próximo seguimiento', type: 'date' },
          { key: 'lectura_post_intervencion', label: 'Lectura/estado post-intervención', type: 'textarea' },
          { key: 'firma_cliente', label: 'Cliente firmó conformidad', type: 'checkbox' },
        ],
      },
    ],
  },

  // ───────── VISITA DE NORMALIZACIÓN ─────────
  {
    type: 'normalizacion',
    label: 'Visita de Normalización',
    shortLabel: 'Normalización',
    description: 'Revisión y ajustes para dejar el sistema en condiciones óptimas según norma.',
    icon: '📐',
    color: '#f59e0b',
    sections: [
      {
        title: 'Razón de la normalización',
        icon: '📋',
        fields: [
          { key: 'motivo', label: 'Motivo principal', type: 'select', options: ['Auditoría de calidad', 'Cumplimiento norma RETIE', 'Resolución CREG penalización', 'Cambio comercializador', 'Solicitud cliente', 'Otro'], required: true },
          { key: 'motivo_detalle', label: 'Detalle del motivo', type: 'textarea' },
          { key: 'documento_referencia', label: 'Documento de referencia (oficio, OC, etc.)', type: 'text' },
        ],
      },
      {
        title: 'Estado encontrado',
        icon: '🔎',
        fields: [
          { key: 'estado_general', label: 'Estado general del sistema', type: 'select', options: ['Excelente', 'Bueno', 'Regular', 'Malo'] },
          { key: 'factor_potencia_medido', label: 'Factor de potencia medido', type: 'number', inputMode: 'decimal', placeholder: '0.92' },
          { key: 'temperatura_inversor_c', label: 'Temperatura inversor', type: 'number', inputMode: 'decimal', unit: '°C' },
          { key: 'apriete_borneras_ok', label: 'Apriete de borneras revisado', type: 'checkbox' },
          { key: 'limpieza_paneles_ok', label: 'Limpieza de paneles ejecutada', type: 'checkbox' },
          { key: 'aterrizaje_ok', label: 'Aterrizaje verificado', type: 'checkbox' },
          { key: 'rotulado_ok', label: 'Rotulación según norma RETIE', type: 'checkbox' },
          { key: 'observaciones_estado', label: 'Observaciones del estado', type: 'textarea' },
        ],
      },
      {
        title: 'Cambios aplicados',
        icon: '🔧',
        fields: [
          { key: 'config_inversor_modificada', label: 'Configuración del inversor modificada', type: 'checkbox' },
          { key: 'detalle_config', label: 'Detalle de cambios de config', type: 'textarea', placeholder: 'Ej: cos φ ajustado de 1.0 a 0.95, modo Self-consumption habilitado' },
          { key: 'firmware_actualizado', label: 'Firmware actualizado', type: 'checkbox' },
          { key: 'cambio_equipos', label: 'Equipos reemplazados', type: 'textarea' },
          { key: 'rotulado_aplicado', label: 'Rotulación añadida', type: 'textarea' },
        ],
      },
      {
        title: 'Pruebas finales',
        icon: '🧪',
        fields: [
          { key: 'prueba_generacion_kw', label: 'Potencia de generación medida', type: 'number', inputMode: 'decimal', unit: 'kW' },
          { key: 'fp_final', label: 'Factor de potencia final', type: 'number', inputMode: 'decimal', placeholder: '0.96' },
          { key: 'lectura_final_solar', label: 'Lectura medidor solar', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'lectura_final_red', label: 'Lectura medidor red', type: 'number', inputMode: 'decimal', unit: 'kWh' },
          { key: 'pruebas_ok', label: 'Todas las pruebas pasaron', type: 'checkbox' },
          { key: 'observaciones_pruebas', label: 'Observaciones', type: 'textarea' },
        ],
      },
      {
        title: 'Documentación',
        icon: '📄',
        fields: [
          { key: 'acta_entregada', label: 'Acta entregada al cliente', type: 'checkbox' },
          { key: 'manual_entregado', label: 'Manual de operación entregado', type: 'checkbox' },
          { key: 'capacitacion_cliente', label: 'Capacitación al cliente realizada', type: 'checkbox' },
          { key: 'pendientes', label: 'Pendientes', type: 'textarea' },
        ],
      },
    ],
  },
];

export const findSchema = (type: VisitType): VisitTypeSchema | undefined =>
  VISIT_SCHEMAS.find((s) => s.type === type);
