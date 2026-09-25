/**
 * Catálogo de campos por tipo de visita.
 * Cada tipo se descompone en SECCIONES → cada sección tiene FIELDS.
 * Los valores se guardan en `field_visits.form_data` como JSON keyed por field.key.
 *
 * El schema de "previa" sigue la plantilla oficial PROMIGAS:
 * "Acta de Visita Previa y Prefactibilidad" — FO:Prefactibilidad
 */

export type VisitType = 'previa' | 'instalacion' | 'emergencia' | 'normalizacion' | 'abastecimiento' | 'comisionamiento';
/** `signature`: firma dibujada en pantalla; se guarda como data-URL PNG en form_data[key]. */
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'date' | 'time' | 'checkbox' | 'radio' | 'tel' | 'email' | 'serial_list' | 'signature';

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
  /** Solo `signature`: key del field de texto hermano que trae el nombre del
   *  firmante — el sello de certificación (nombre + fecha/hora + GPS) lo lee
   *  de ahí. Ej: nameKey='firma_tecnico_nombre' para el field firma_tecnico. */
  nameKey?: string;
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

/** Punto de verificación SI / NO — usado por el checklist de abastecimiento. */
const siNo = (key: string, label: string): VisitField => ({ key, label, type: 'radio', options: ['SI', 'NO'] });

/** Par nombre+firma certificada para una sección "Firmas" — mismo patrón en
 *  todas las actas. `roleKey` es el sufijo de key (ej. 'tecnico' → campos
 *  firma_tecnico_nombre / firma_tecnico), `roleLabel` es lo que se muestra. */
const firmaFields = (roleKey: string, roleLabel: string, nombreRequired = false): VisitField[] => [
  { key: `firma_${roleKey}_nombre`, label: `${roleLabel} — Nombre`, type: 'text', required: nombreRequired },
  { key: `firma_${roleKey}`, label: `${roleLabel} — Firma`, type: 'signature', nameKey: `firma_${roleKey}_nombre` },
];

/**
 * Un punto de verificación del Formato de Comisionamiento: 5 campos por
 * ítem (Cumple/No cumple/No aplica, resultado, valor medido, evidencia,
 * observaciones) — fiel a las 7 columnas del Excel original, salvo
 * "Responsable" y "Fecha de verificación" que NO se repiten por ítem: se
 * usa el técnico y la fecha que ya captura toda acta de Visitas arriba
 * del formulario (decisión explícita, evita pedir el mismo dato 45 veces).
 * id ej. 'A1' → keys item_A1_cumple / item_A1_resultado / item_A1_valor /
 * item_A1_evidencia / item_A1_obs.
 */
const comisionamientoItem = (id: string, punto: string, criterio: string): VisitField[] => [
  { key: `item_${id}_cumple`, label: `${id}. ${punto}`, type: 'radio', options: ['Cumple', 'No cumple', 'No aplica'], required: true, help: criterio },
  { key: `item_${id}_resultado`, label: `${id} — Resultado de la inspección`, type: 'text' },
  { key: `item_${id}_valor`, label: `${id} — Valor medido`, type: 'text' },
  { key: `item_${id}_evidencia`, label: `${id} — Evidencia o soporte`, type: 'text' },
  { key: `item_${id}_obs`, label: `${id} — Observaciones`, type: 'textarea' },
];

/** Fila de la sección "IV. Evidencias asociadas" del comisionamiento: tipo
 *  de evidencia + si se adjuntó + referencia/archivo/enlace. */
const evidenciaItem = (key: string, label: string): VisitField[] => [
  { key: `evid_${key}_adjunta`, label: `${label} — Adjunta`, type: 'radio', options: ['Sí', 'No'] },
  { key: `evid_${key}_ref`, label: `${label} — Referencia / archivo / enlace`, type: 'text' },
];

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
      {
        // El PDF (visit-pdf.ts) dibuja esta sección como recuadros de firma.
        title: 'Firmas',
        fields: [
          ...firmaFields('tecnico', 'Técnico', true),
          ...firmaFields('cliente', 'Cliente / Responsable en sitio'),
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
          { key: 'fecha_inicio_obra', label: 'Fecha inicio de obra', type: 'date', required: true },
          { key: 'fecha_fin_obra', label: 'Fecha fin de obra', type: 'date', required: true },
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
          { key: 'bms_cantidad', label: 'Cantidad de BMS', type: 'number', inputMode: 'numeric' },
          { key: 'bms_serials', label: 'Seriales de BMS', type: 'serial_list', qtyKey: 'bms_cantidad', qtyFallback: 1, help: 'Un input por BMS. Normalmente 1 por banco de baterías.' },
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
      {
        // El PDF (visit-pdf.ts) dibuja esta sección como recuadros de firma.
        title: 'Firmas',
        fields: [
          ...firmaFields('tecnico', 'Técnico instalador', true),
          ...firmaFields('cliente', 'Cliente / Responsable'),
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
      {
        // El PDF (visit-pdf.ts) dibuja esta sección como recuadros de firma.
        // Rol 'responsable' (no 'cliente') para no chocar con el checkbox
        // firma_cliente de la sección "IV. Resultado" de arriba.
        title: 'Firmas',
        fields: [
          ...firmaFields('tecnico', 'Técnico', true),
          ...firmaFields('responsable', 'Responsable en sitio'),
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
      {
        // El PDF (visit-pdf.ts) dibuja esta sección como recuadros de firma.
        title: 'Firmas',
        fields: [
          ...firmaFields('tecnico', 'Técnico', true),
          ...firmaFields('contratista', 'Contratista'),
        ],
      },
    ],
  },

  // ───────── CHECKLIST DE ABASTECIMIENTO Y HERRAMIENTAS ─────────
  // Digitalización del formato "Chek List_Abastecimiento y herramientas.xlsx".
  // Los ítems se declaran de a pares (izquierda | derecha) en el mismo orden
  // que el papel — FieldsGrid y la tabla del PDF los pintan en 2 columnas.
  {
    type: 'abastecimiento',
    label: 'Checklist de Abastecimiento y Herramientas',
    shortLabel: 'Abastecimiento',
    description: 'Verificación de materiales, equipos y herramientas en sitio antes de arrancar la obra.',
    color: '#8b5cf6',
    formCode: 'FO:Abastecimiento',
    casaIsFreeText: true,
    photoCategories: ['Materiales y equipos entregados', 'Inversor', 'Baterías y BMS', 'Estructura y accesorios', 'Tablero SSFV', 'Herramientas y equipo de altura', 'Sitio / cubierta', 'Otro'],
    sections: [
      {
        title: 'I. Información general del proyecto',
        fields: [
          { key: 'nombre_proyecto', label: 'Nombre del proyecto / conjunto', type: 'text' },
          { key: 'fecha_inspeccion', label: 'Fecha de inspección', type: 'date' },
          { key: 'nombre_cliente', label: 'Nombre cliente / usuario', type: 'text' },
          { key: 'operador_red', label: 'Operador de Red (OR)', type: 'select', options: ['EMCALI', 'CELSIA', 'ENEL Codensa', 'AIR-E', 'Afinia', 'Electricaribe', 'EPM', 'Otro'] },
          { key: 'ciudad', label: 'Ciudad', type: 'text' },
          { key: 'cantidad_bms', label: 'Cantidad de BMS', type: 'number', inputMode: 'numeric' },
          { key: 'direccion', label: 'Dirección', type: 'text' },
          { key: 'cantidad_baterias', label: 'Cantidad de baterías', type: 'number', inputMode: 'numeric' },
          { key: 'inversor_marca_modelo', label: 'Marca y modelo del inversor', type: 'text' },
          { key: 'tipo_estructura', label: 'Tipo de estructura a instalar', type: 'text' },
          { key: 'cantidad_paneles', label: 'Cantidad de paneles a instalar', type: 'number', inputMode: 'numeric' },
          { key: 'altura_cubierta', label: 'Altura de cubierta', type: 'text', placeholder: 'Ej: 6 m / 2 pisos' },
        ],
      },
      {
        title: 'II. Comisionamiento · 1. Equipos y materiales',
        fields: [
          siNo('chk_1_01', '1.1 Inversor entregado'),
          siNo('chk_1_02', '1.2 Paneles entregados'),
          siNo('chk_1_03', '1.3 Baterías y BMS entregados'),
          siNo('chk_1_04', '1.4 Tablero SSFV en sitio'),
          siNo('chk_1_05', '1.5 Cable AC acorde a cantidad de diseño'),
          siNo('chk_1_06', '1.6 Cable DC acorde a cantidad de diseño'),
          siNo('chk_1_07', '1.7 Cajas plásticas 4x4'),
          siNo('chk_1_08', '1.8 Empalmadores o borneras para interconexión acorde a diseño'),
          siNo('chk_1_09', '1.9 Cable solar y cantidad acorde a diseño'),
          siNo('chk_1_10', '1.10 Estructura solar completa acorde a diseño'),
          siNo('chk_1_11', '1.11 Ductos acorde a diseño'),
          siNo('chk_1_12', '1.12 Accesorios estructura solar (incluye contrapesos)'),
          siNo('chk_1_13', '1.13 Accesorios para ductos (curvas, conduletas, prensa stop, conductores para coraza, etc.)'),
          siNo('chk_1_14', '1.14 Material menor (abrazaderas, terminales para cable, amarras plásticas)'),
          siNo('chk_1_15', '1.15 Cable y accesorios para comunicaciones'),
          siNo('chk_1_16', '1.16 Conectores MC4'),
          siNo('chk_1_17', '1.17 Soportes para baterías'),
          siNo('chk_1_18', '1.18 Medidores y módem de comunicación'),
        ],
      },
      {
        title: 'II. Comisionamiento · 2. Herramientas y equipos de altura',
        fields: [
          siNo('chk_2_01', '2.1 Escalera acorde a la altura de cubierta'),
          siNo('chk_2_02', '2.2 Equipo de altura completo para 2 personas'),
          siNo('chk_2_03', '2.3 Línea de vida portátil'),
          siNo('chk_2_04', '2.4 Kit de rescate para altura'),
          siNo('chk_2_05', '2.5 Kit herramienta solar'),
          siNo('chk_2_06', '2.6 Pinza voltiamperimétrica'),
          siNo('chk_2_07', '2.7 Ratchet'),
          siNo('chk_2_08', '2.8 Torquímetro'),
          siNo('chk_2_09', '2.9 Juego de llaves hexagonales'),
          siNo('chk_2_10', '2.10 Juego de llaves de boca fija'),
          siNo('chk_2_11', '2.11 Taladro percutor'),
          siNo('chk_2_12', '2.12 Pulidora'),
          siNo('chk_2_13', '2.13 Juego de destornilladores'),
          siNo('chk_2_14', '2.14 Copa sierras'),
        ],
      },
      {
        // El PDF (visit-pdf.ts) trata este título aparte y lee la clave `observaciones`.
        title: '3. Observaciones',
        fields: [
          { key: 'observaciones', label: 'Observaciones', type: 'textarea' },
        ],
      },
      {
        // El PDF (visit-pdf.ts) dibuja esta sección como 2 recuadros de firma.
        title: 'Firmas',
        fields: [
          { key: 'firma_elaboro_nombre', label: 'Elaboró / Realizó verificación — Nombre', type: 'text', required: true },
          { key: 'firma_contratista_nombre', label: 'Responsable Contratista — Nombre', type: 'text' },
          { key: 'firma_elaboro', label: 'Elaboró / Realizó verificación — Firma', type: 'signature', nameKey: 'firma_elaboro_nombre' },
          { key: 'firma_contratista', label: 'Responsable Contratista — Firma', type: 'signature', nameKey: 'firma_contratista_nombre' },
        ],
      },
    ],
  },

  // ───────── FORMATO DE COMISIONAMIENTO ─────────
  // Digitalización de "Chek List_Comisionamiento.csv" — verificación
  // técnica, funcional y de seguridad previa a la puesta en operación.
  // 45 puntos en 8 secciones (A-H). "Responsable"/"Fecha de verificación"
  // del Excel NO se repiten por ítem (se usan technicianField/visit_date
  // de arriba, ver comisionamientoItem()). Los totales de la sección III
  // (conformes/no conformes/no aplica/% cumplimiento) se recalculan solos
  // al guardar (ver VisitForm.save() en visitas/page.tsx) a partir de los
  // 45 campos item_*_cumple — no hay que sumarlos a mano.
  {
    type: 'comisionamiento',
    label: 'Formato de Comisionamiento',
    shortLabel: 'Comisionamiento',
    description: 'Verificación técnica, funcional y de seguridad previa a la puesta en operación del sistema.',
    color: '#0891b2',
    formCode: 'FO:Comisionamiento',
    casaIsFreeText: true,
    photoCategories: [
      'Fotografías de la instalación', 'Pantallas de configuración del inversor', 'Lecturas de corriente y tensión',
      'Mediciones de batería (V y SOC)', 'Termografías', 'Pruebas de operación On-Grid / Off-Grid',
      'Pruebas de Zero Export / No Exportación', 'Pruebas de operación remota', 'Otro',
    ],
    sections: [
      {
        title: 'I. Información general del proyecto',
        fields: [
          { key: 'nombre_proyecto', label: 'Nombre del proyecto / conjunto', type: 'text' },
          { key: 'fecha_comisionamiento', label: 'Fecha de comisionamiento', type: 'date' },
          { key: 'cliente_usuario', label: 'Cliente / usuario', type: 'text' },
          { key: 'operador_red', label: 'Operador de Red (OR)', type: 'select', options: ['EMCALI', 'CELSIA', 'ENEL Codensa', 'AIR-E', 'Afinia', 'Electricaribe', 'EPM', 'Otro'] },
          { key: 'ciudad', label: 'Ciudad', type: 'text' },
          { key: 'contrato_or', label: 'N.° de contrato (OR)', type: 'text' },
          { key: 'direccion', label: 'Dirección', type: 'text' },
          { key: 'tipo_medidor', label: 'Tipo de medidor', type: 'text' },
          { key: 'inversor_marca_modelo', label: 'Marca y modelo del inversor', type: 'text' },
          { key: 'potencia_nominal_inversor_kw', label: 'Potencia nominal del inversor', type: 'number', inputMode: 'decimal', unit: 'kW' },
          { key: 'capacidad_fv_kwp', label: 'Capacidad instalada FV', type: 'number', inputMode: 'decimal', unit: 'kWp' },
          { key: 'capacidad_baterias_kwh', label: 'Capacidad banco de baterías', type: 'number', inputMode: 'decimal', unit: 'kWh' },
        ],
      },
      {
        title: 'A. Medición y configuración frente a la red',
        fields: [
          ...comisionamientoItem('A1', 'Identificar el tipo de medidor instalado en la vivienda.', 'Medidor identificado y registrado (bidireccional/unidireccional, marca y modelo).'),
          ...comisionamientoItem('A2', 'Verificar si el medidor registra energía reactiva.', 'Se determina y documenta si el medidor mide energía reactiva.'),
          ...comisionamientoItem('A3', 'Validar la configuración para gestión/compensación de energía reactiva según la marca del inversor.', 'Configuración conforme al Manual de Ingeniería y a las instrucciones del fabricante del inversor.'),
          ...comisionamientoItem('A4', 'Verificar la configuración del modo No Exportación / Zero Export.', 'Modo Zero Export configurado y verificado según marca del inversor y Manual de Ingeniería.'),
          ...comisionamientoItem('A5', 'Validar la configuración del inversor frente a desbalances entre fases de la carga del cliente.', 'Inversor operando con los desbalances de fase previstos, sin disparos ni alarmas.'),
          ...comisionamientoItem('A6', 'Validar la configuración del inversor para tolerar las variaciones de tensión permitidas en la red.', 'Rangos de tensión configurados dentro de límites del OR / RETIE / fabricante.'),
        ],
      },
      {
        title: 'B. Baterías y BMS',
        fields: [
          ...comisionamientoItem('B1', 'Verificar configuración y calibración de baterías y BMS según el fabricante.', 'Parámetros del BMS y baterías conformes a las recomendaciones del fabricante.'),
          ...comisionamientoItem('B2', 'Verificar carga de baterías al 100 % antes de la instalación (cuando aplique).', 'SOC = 100 % previo a la instalación, si el fabricante lo establece.'),
          ...comisionamientoItem('B3', 'Verificar ausencia de diferencias anormales de tensión entre módulos (transporte/manipulación/almacenamiento).', 'Diferencia de tensión entre módulos dentro de la tolerancia del fabricante.'),
          ...comisionamientoItem('B4', 'Verificar ausencia de desbalances de tensión o SOC entre baterías de diferentes lotes.', 'Sin desbalances significativos de tensión / SOC entre lotes.'),
          ...comisionamientoItem('B5', 'Registrar voltaje y SOC de cada módulo o batería (cuando sea técnicamente aplicable).', 'Registro completo de V y SOC por módulo.'),
        ],
      },
      {
        title: 'C. Operación del sistema',
        fields: [
          ...comisionamientoItem('C1', 'Validar la transición a modo Off-Grid / respaldo ante interrupción de la red.', 'Transición automática y correcta a respaldo ante falla de red.'),
          ...comisionamientoItem('C2', 'Verificar que la transición no genere comportamientos anormales ni interrupciones no deseadas en cargas críticas.', 'Cargas críticas se mantienen sin interrupciones anómalas durante la transición.'),
          ...comisionamientoItem('C3', 'Validar el retorno correcto a modo On-Grid al restablecerse la red.', 'Retorno a On-Grid automático y estable.'),
          ...comisionamientoItem('C4', 'Verificar el aislamiento/suspensión remota del sistema (falta de pago o condición operativa definida).', 'El sistema puede aislarse/suspenderse remotamente de forma segura.'),
        ],
      },
      {
        title: 'D. Carga eléctrica de la vivienda',
        fields: [
          ...comisionamientoItem('D1', 'Verificar que el tablero de protecciones sea adecuado para la carga instalada y cumpla límites del OR.', 'Tablero conforme a la carga y a límites del Operador de Red / NTC 2050 / RETIE.'),
          ...comisionamientoItem('D2', 'Realizar la medición de la carga máxima de la vivienda (total y por fase).', 'Mediciones registradas de carga máxima total y por fase.'),
          ...comisionamientoItem('D3', 'Utilizar pinza voltiamperimétrica para las mediciones.', 'Mediciones realizadas con pinza voltiamperimétrica.'),
          ...comisionamientoItem('D4', 'Considerar cargas de uso eventual / alta demanda durante la prueba (aspiradora, plancha, horno, VE, etc.).', 'Prueba ejecutada incluyendo las cargas de alta demanda disponibles.'),
          ...comisionamientoItem('D5', 'Verificar compatibilidad de la demanda máxima con potencia del inversor, capacidad de batería, tablero y conductores.', 'Demanda máxima ≤ capacidad del inversor, batería, tablero y conductores instalados.'),
          ...comisionamientoItem('D6', 'Registrar los valores máximos de corriente y potencia por fase.', 'Registro de I y P máximas por fase (L1, L2, L3).'),
        ],
      },
      {
        title: 'E. Vehículo eléctrico (si la vivienda cuenta con VE o cargador)',
        fields: [
          ...comisionamientoItem('E1', 'Verificar la existencia del cargador de vehículo eléctrico.', 'Se confirma la presencia/ausencia de cargador de VE.'),
          ...comisionamientoItem('E2', 'Identificar la potencia nominal del cargador.', 'Potencia nominal del cargador documentada (kW).'),
          ...comisionamientoItem('E3', 'Verificar que el calibre y la capacidad de la conexión sean adecuados para la corriente requerida.', 'Calibre y protección del circuito adecuados a la corriente del cargador.'),
          ...comisionamientoItem('E4', 'Verificar el calibre mínimo requerido para la conexión del VE.', 'Calibre ≥ XX (por definir según ingeniería y normativa aplicable).'),
          ...comisionamientoItem('E5', 'Verificar que la conexión del VE no genere sobrecarga en el sistema residencial.', 'Con el VE en carga, la demanda total no supera la capacidad del sistema.'),
        ],
      },
      {
        title: 'F. Puesta a tierra y seguridad eléctrica',
        fields: [
          ...comisionamientoItem('F1', 'Verificar la continuidad del sistema de puesta a tierra.', 'Continuidad verificada; resistencia dentro de límites de RETIE / diseño (por definir si no está especificado).'),
          ...comisionamientoItem('F2', 'Verificar las conexiones de puesta a tierra de los principales equipos.', 'Equipos principales conectados a tierra según el diseño.'),
          ...comisionamientoItem('F3', 'Validar el cumplimiento de los criterios del diseño y del Manual de Ingeniería.', 'Instalación conforme al diseño eléctrico y al Manual de Ingeniería.'),
          ...comisionamientoItem('F4', 'Registrar los valores de las mediciones realizadas (cuando corresponda).', 'Valores de medición de puesta a tierra registrados.'),
        ],
      },
      {
        title: 'G. Inspección termográfica',
        fields: [
          // Nota del Excel: registrar temperatura en "Valor medido" y condición en "Observaciones".
          ...comisionamientoItem('G1', 'Inspección termográfica del tablero eléctrico.', 'Sin puntos calientes anómalos; ΔT dentro de límites (por definir).'),
          ...comisionamientoItem('G2', 'Inspección termográfica de las protecciones.', 'Sin puntos calientes anómalos en las protecciones.'),
          ...comisionamientoItem('G3', 'Inspección termográfica de las conexiones AC.', 'Conexiones AC sin sobrecalentamiento.'),
          ...comisionamientoItem('G4', 'Inspección termográfica de las conexiones DC.', 'Conexiones DC sin sobrecalentamiento.'),
          ...comisionamientoItem('G5', 'Inspección termográfica del inversor.', 'Inversor sin puntos calientes anómalos.'),
          ...comisionamientoItem('G6', 'Inspección termográfica de las baterías.', 'Baterías sin puntos calientes anómalos.'),
          ...comisionamientoItem('G7', 'Inspección termográfica de los puntos de conexión y terminales.', 'Terminales y puntos de conexión sin sobrecalentamiento.'),
        ],
      },
      {
        title: 'H. Recomendaciones adicionales — verificaciones críticas complementarias',
        fields: [
          ...comisionamientoItem('H1', 'Verificar polaridad y secuencia de fases (AC/DC).', 'Polaridad DC y secuencia de fases correctas.'),
          ...comisionamientoItem('H2', 'Probar los dispositivos de protección (interruptores, DPS/SPD, protección diferencial).', 'Protecciones operan/disparan correctamente según diseño y RETIE.'),
          ...comisionamientoItem('H3', 'Verificar la parada de emergencia / desconexión rápida (rapid shutdown) del sistema FV.', 'Función de desconexión rápida / parada de emergencia operativa.'),
          ...comisionamientoItem('H4', 'Verificar el etiquetado, la señalización y los rótulos de seguridad.', 'Rotulado y señalización conforme a RETIE.'),
          ...comisionamientoItem('H5', 'Verificar la comunicación y el monitoreo remoto (plataforma/portal) y el registro de datos.', 'Monitoreo remoto en línea y registrando datos correctamente.'),
          ...comisionamientoItem('H6', 'Verificar la versión de firmware del inversor.', 'Firmware actualizado a la versión recomendada por el fabricante.'),
          ...comisionamientoItem('H7', 'Verificar la generación FV y la producción frente a las condiciones de irradiancia.', 'Producción FV coherente con la irradiancia y la potencia esperada.'),
          ...comisionamientoItem('H8', 'Verificar el torque de conexiones y la entrega de documentación/capacitación al usuario.', 'Torques según fabricante; usuario capacitado y documentación entregada.'),
        ],
      },
      {
        title: 'III. Resumen y Resultado del Comisionamiento',
        fields: [
          { key: 'resumen_total_puntos', label: 'Total de puntos de verificación', type: 'text', help: 'Se calcula automáticamente al guardar.' },
          { key: 'resumen_conformes', label: 'Puntos conformes (Cumple)', type: 'text', help: 'Se calcula automáticamente al guardar.' },
          { key: 'resumen_no_conformes', label: 'Puntos no conformes (No cumple)', type: 'text', help: 'Se calcula automáticamente al guardar.' },
          { key: 'resumen_no_aplica', label: 'Puntos no aplicables (No aplica)', type: 'text', help: 'Se calcula automáticamente al guardar.' },
          { key: 'resumen_pct_cumplimiento', label: 'Porcentaje de cumplimiento', type: 'text', help: 'Se calcula automáticamente al guardar.' },
          { key: 'estado_final_comisionamiento', label: 'Estado final del comisionamiento', type: 'radio', options: ['Aprobado', 'No aprobado', 'Aprobado con observaciones'], required: true },
          { key: 'observaciones_criticas', label: 'Observaciones críticas', type: 'textarea' },
          { key: 'acciones_correctivas_pendientes', label: 'Acciones correctivas pendientes', type: 'textarea' },
          { key: 'responsable_cierre', label: 'Responsable de cierre', type: 'text' },
          { key: 'fecha_cierre', label: 'Fecha de cierre', type: 'date' },
        ],
      },
      {
        title: 'IV. Evidencias Asociadas',
        fields: [
          ...evidenciaItem('fotografias', 'Fotografías de la instalación'),
          ...evidenciaItem('pantallas_config', 'Pantallas de configuración del inversor'),
          ...evidenciaItem('lecturas', 'Lecturas de corriente y tensión'),
          ...evidenciaItem('mediciones_bateria', 'Mediciones de batería (V y SOC)'),
          ...evidenciaItem('termografias', 'Termografías'),
          ...evidenciaItem('pruebas_ongrid_offgrid', 'Pruebas de operación On-Grid / Off-Grid'),
          ...evidenciaItem('pruebas_zero_export', 'Pruebas de Zero Export / No Exportación'),
          ...evidenciaItem('pruebas_remota', 'Pruebas de operación remota'),
        ],
      },
      {
        // El PDF (visit-pdf.ts) trata este título aparte y lee la clave `observaciones`.
        title: 'V. Observaciones Generales',
        fields: [
          { key: 'observaciones', label: 'Observaciones generales', type: 'textarea' },
        ],
      },
      {
        // El PDF (visit-pdf.ts) dibuja esta sección como recuadros de firma.
        title: 'Firmas',
        fields: [
          ...firmaFields('elaboro', 'Elaboró / Realizó el comisionamiento', true),
          ...firmaFields('reviso', 'Revisó / Aprobó'),
          ...firmaFields('recibio', 'Recibió (usuario)'),
        ],
      },
    ],
  },
];

// NOTA: "Bitácora de Construcción" se intentó primero acá como un tipo de
// acta más (migración 69) — se revirtió (migración 70) porque el modelo real
// es un contenedor por casa con múltiples entradas adentro, que no encaja en
// "un evento = un registro" de field_visits. Ahora vive en tablas propias
// (construction_logs / construction_log_entries /
// construction_log_entry_photos) y en src/components/ConstructionLog.tsx,
// expuesta como una pestaña más de /visitas pero fuera de este catálogo.

export const findSchema = (type: VisitType): VisitTypeSchema | undefined =>
  VISIT_SCHEMAS.find((s) => s.type === type);

/**
 * Valor certificado de un field `type: 'signature'` — reemplaza el string
 * plano (data-URL) que se guardaba antes. Vive dentro de `form_data[key]`,
 * sin migración de BD (jsonb). El nombre del firmante sigue siendo un field
 * de texto aparte (ver `nameKey`), no vive dentro de este objeto.
 */
export interface SignatureValue {
  png: string;           // data-URL PNG del trazo
  ts: string;             // ISO 8601 — momento de la certificación
  lat: number | null;     // null si el GPS falló o se negó el permiso
  lng: number | null;
}

export type ParsedSignature =
  | { kind: 'empty' }
  | { kind: 'legacy'; png: string }
  | { kind: 'certified'; value: SignatureValue };

/** Acepta tanto el formato viejo (string data-URL) como el nuevo (objeto
 *  SignatureValue) — así las firmas ya guardadas antes de este cambio se
 *  siguen mostrando (sin sello de certificación) en vez de romperse. */
export function parseSignatureValue(raw: unknown): ParsedSignature {
  if (typeof raw === 'string' && raw.startsWith('data:image')) return { kind: 'legacy', png: raw };
  if (raw && typeof raw === 'object' && 'png' in raw && typeof (raw as { png?: unknown }).png === 'string') {
    const r = raw as Partial<SignatureValue>;
    return {
      kind: 'certified',
      value: {
        png: r.png as string,
        ts: typeof r.ts === 'string' ? r.ts : '',
        lat: typeof r.lat === 'number' ? r.lat : null,
        lng: typeof r.lng === 'number' ? r.lng : null,
      },
    };
  }
  return { kind: 'empty' };
}
