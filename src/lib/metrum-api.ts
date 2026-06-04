// Cliente para la comunicación con la API de Metrum (ThingsBoard)
// IMPORTANTE: Este código debe ejecutarse ÚNICAMENTE en el servidor (Rutas API / Server Actions)
// para no exponer credenciales al frontend.

const METRUM_API_URL = 'https://monitoreo-metrum.com';

export async function loginToMetrum(username?: string, password?: string): Promise<string> {
  const user = username || process.env.METRUM_USERNAME;
  const pass = password || process.env.METRUM_PASSWORD;

  if (!user || !pass) {
    throw new Error('Faltan credenciales de Metrum: definir METRUM_USERNAME y METRUM_PASSWORD en .env.local');
  }

  const res = await fetch(`${METRUM_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });

  if (!res.ok) {
    throw new Error('Fallo la autenticación con Metrum API');
  }

  const data = await res.json();
  return data.token; // Retorna el JWT Token
}

export async function getDevices(token: string) {
  // Atributos REALES descubiertos en Metrum (SERVER_SCOPE)
  // - mettype: subtipo medidor (solar / red)
  // - spcus: nombre de la casa/cliente (ej: "Casa 2", "Casa 23p")
  // - gateway: nombre del Pulsar padre (ej: "IN42420370")
  // - dept/city/zone: ubicación
  // - invbrand/invmodel/invcap/invarray/invtype: datos del inversor Livoltek (HP*)
  // - TLinvstate/TLBattSOC: estado inversor DEYE
  // - latDev/lonDev/spdno/spcom: solo en gateways IN*
  // - active/inactivityAlarmTime/lastActivityTime: estado conexión
  // - model: modelo del medidor (ej: "dtsy23-3p")
  // - address: dirección modbus del medidor
  const allAttrs = [
    // Tipo / subtipo
    'mettype', 'type', 'deviceType', 'tipo',
    'subtype', 'subtipo', 'meter_type', 'subType',
    // Casa / cliente
    'spcus',
    'client', 'cliente', 'casa',
    'cliente_id', 'clienteId', 'customer_id', 'customerId', 'casa_id', 'casaId',
    // Gateway padre (link a Pulsar)
    'gateway', 'spgwserie',
    // Ubicación
    'location', 'ubicacion', 'zona', 'zone',
    'ciudad', 'city', 'dept', 'department', 'departamento',
    'latDev', 'lonDev', 'lat', 'lng',
    // Proveedor de servicio
    'spdno', 'spcom',
    // Estado conexión
    'active', 'inactivityAlarmTime', 'lastActivityTime',
    'lastConnectTime', 'lastDisconnectTime',
    // Datos inversor (Livoltek HP*)
    'invbrand', 'invmodel', 'invcap', 'invarray', 'invtype',
    'marca', 'brand', 'modelo', 'model',
    'potencia', 'potencia_kw', 'power', 'powerKw',
    'numero_paneles', 'numeroPaneles', 'panels',
    'BattSn', 'id_bateria', 'idBateria', 'batteryId',
    'tipo_inversor', 'tipoInversor', 'inverter_type',
    // Datos inversor DEYE (numéricos)
    'TLinvstate', 'TLBattSOC', 'TLpowerAE', 'TLenergyAE',
    // Otros
    'address', 'mapCategory',
    'numero_serie', 'numeroSerie', 'serial', 'serialNumber',
    'service_point', 'punto_servicio', 'puntoServicio',
    // Flags de alarma inversor (Livoltek + DEYE) — capturadas en devices.alarm_flags
    'flagFSVER', 'flagFSCER', 'flagFBVER',
    'flagFFT', 'flagETA',
    'flagFFDC',
    'flagFEM', 'flagFFB', 'flagFFCT', 'flagFAFER',
    'flagEMayor', 'flagEMenor', 'flagEAM', 'flagECEO', 'flagEPSR', 'flagESSI',
    'UIcolorRojo', 'UIcolorAmarillo', 'UIcolorNaranja',
  ];
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 20; // tope de seguridad: 20 × 1000 = 20k entidades máx
  const buildBody = (page: number) => ({
    entityFilter: { type: 'entityType', entityType: 'DEVICE' },
    entityFields: [
      { type: 'ENTITY_FIELD', key: 'name' },
      { type: 'ENTITY_FIELD', key: 'type' },
      { type: 'ENTITY_FIELD', key: 'label' },
      { type: 'ENTITY_FIELD', key: 'customerId' },
      { type: 'ENTITY_FIELD', key: 'customerTitle' },
    ],
    latestValues: allAttrs.map((key) => ({ type: 'ATTRIBUTE', key })),
    pageLink: {
      page,
      pageSize: PAGE_SIZE,
      sortOrder: { key: { key: 'name', type: 'ENTITY_FIELD' }, direction: 'ASC' },
    },
  });

  // Pagina hasta que no haya más entidades, en vez de tomar solo la primera página.
  // Antes esto era page=0 pageSize=500 — si Metrum acumulaba más de 500 entidades
  // (devices nuevos, viejos, deshabilitados) los excedentes se perdían silenciosamente.
  const allEntities: unknown[] = [];
  let totalElements: number | null = null;
  let totalPages: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${METRUM_API_URL}/api/entitiesQuery/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(buildBody(page)),
    });
    if (!res.ok) throw new Error(`Error buscando entidades en Metrum (page ${page}, status ${res.status})`);
    const json = await res.json();
    const data: unknown[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    allEntities.push(...data);
    // Capturar metadatos de paginación (primera vuelta)
    if (page === 0) {
      totalElements = typeof json?.totalElements === 'number' ? json.totalElements : null;
      totalPages = typeof json?.totalPages === 'number' ? json.totalPages : null;
    }
    const hasNext = typeof json?.hasNext === 'boolean' ? json.hasNext : data.length === PAGE_SIZE;
    if (!hasNext) break;
  }

  console.log(`[metrum-api] getDevices: trajo ${allEntities.length} entidades (totalElements=${totalElements}, totalPages=${totalPages})`);
  return { data: allEntities, totalElements, totalPages, fetchedCount: allEntities.length };
}

export async function getTimeseriesKeys(token: string, entityId: string): Promise<string[]> {
  const res = await fetch(`${METRUM_API_URL}/api/plugins/telemetry/DEVICE/${entityId}/keys/timeseries`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Error listando keys de telemetría (${res.status})`);
  return res.json();
}

export async function getTimeseries(
  token: string,
  entityId: string,
  keys: string[],
  startTs: number,
  endTs: number,
  options: { interval?: number; agg?: 'NONE' | 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT'; limit?: number } = {},
) {
  const params = new URLSearchParams({
    keys: keys.join(','),
    startTs: String(startTs),
    endTs: String(endTs),
    limit: String(options.limit ?? 5000),
    agg: options.agg ?? 'NONE',
    // useStrictDataTypes=false → ThingsBoard NO rechaza la query si hay keys
    // de tipo string mezcladas con numéricas. Útil cuando el usuario marca
    // BattStateOp_LV (string) y BattSOC (numérica) en la misma consulta con AVG.
    useStrictDataTypes: 'false',
  });
  if (options.interval && options.agg && options.agg !== 'NONE') {
    params.set('interval', String(options.interval));
  }
  const url = `${METRUM_API_URL}/api/plugins/telemetry/DEVICE/${entityId}/values/timeseries?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Error consultando timeseries (${res.status})`);
  return res.json();
}

export async function getDailyClosure(token: string, entityId: string, startTs: number, endTs: number) {
  // Consulta los parámetros de cierre diario para un dispositivo
  const keys = ['CenergyAI', 'CenergyAE', 'CenergyRI', 'CenergyRE'].join('%2C');
  const url = `${METRUM_API_URL}/api/plugins/telemetry/DEVICE/${entityId}/values/timeseries?keys=${keys}&startTs=${startTs}&endTs=${endTs}`;
  
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) throw new Error('Error al obtener el cierre diario');
  return res.json();
}
