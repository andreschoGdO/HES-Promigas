-- =========================================================================
-- SCRIPT DE BASE DE DATOS PARA SUPABASE (PostgreSQL)
-- Proyecto: HES Promigas Dashboard
-- =========================================================================

-- 1. Tabla de Dispositivos (Mapeo de jerarquía de Metrum)
-- Esta tabla actuará como caché para no usar entitiesQuery/find de Metrum
CREATE TABLE public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metrum_id VARCHAR(255) NOT NULL UNIQUE, -- ID devuelto por Metrum
    name VARCHAR(255) NOT NULL,             -- ej. Serial IN42420370
    type VARCHAR(50) NOT NULL,              -- 'meter' o 'inverter'
    model VARCHAR(255),                     -- ej. 'DEYE SUN-15K', 'starleg-3p'
    client VARCHAR(255),                    -- extraído del árbol de jerarquía (spcus)
    location VARCHAR(255),                  -- ciudad / sector
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para búsqueda rápida en el dashboard
CREATE INDEX idx_devices_client ON public.devices(client);
CREATE INDEX idx_devices_type ON public.devices(type);


-- 2. Tabla de Cierre Diario de Energía
-- Almacena los registros que provienen de CenergyAI, CenergyAE, CenergyRI, CenergyRE
CREATE TABLE public.daily_energy_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,              -- Fecha del registro a las 00:00
    
    -- Telemetría de Metrum
    energy_active_imported_wh NUMERIC,      -- CenergyAI
    energy_active_exported_wh NUMERIC,      -- CenergyAE
    energy_reactive_imported_varh NUMERIC,  -- CenergyRI
    energy_reactive_exported_varh NUMERIC,  -- CenergyRE
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Restricción para evitar duplicados en el mismo dispositivo para el mismo día
    UNIQUE(device_id, record_date)
);

-- Índices para graficar rápidamente por fecha
CREATE INDEX idx_daily_energy_date ON public.daily_energy_closures(record_date);


-- 3. (Opcional) Tabla de Configuración de la Integración API
-- En lugar de variables de entorno estáticas, podríamos guardar el Token aquí si queremos rotarlo en base de datos.
CREATE TABLE public.integration_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar parámetros iniciales vacíos o por defecto
INSERT INTO public.integration_config (key, value) VALUES 
('metrum_api_url', 'https://monitoreo-metrum.com'),
('metrum_api_user', 'davider@gdo.com.co'),
('last_sync_timestamp', '0');

-- =========================================================================
-- Políticas de Seguridad RLS (Row Level Security) - Supabase
-- Asegúrate de que las consultas desde tu backend Next.js tengan permisos.
-- Si usas la 'Service Role Key' en el servidor, no necesitas RLS estricto, 
-- pero es buena práctica.
-- =========================================================================

-- Habilitar RLS
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_energy_closures ENABLE ROW LEVEL SECURITY;

-- Crear políticas (Solo permitir lectura al anon/authenticated si quisieras, 
-- pero el Next.js Serverless Function usará Service Role Key, evadiendo esto. 
-- Dejamos acceso de lectura general para pruebas si fuera necesario).
CREATE POLICY "Permitir lectura publica de dispositivos" ON public.devices FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica de energía" ON public.daily_energy_closures FOR SELECT USING (true);
