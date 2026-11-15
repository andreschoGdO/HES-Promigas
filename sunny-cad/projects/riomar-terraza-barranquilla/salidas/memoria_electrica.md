# Memoria de cálculo eléctrico — Terraza Riomar - Barranquilla

> **Borrador técnico.** Los factores, tablas y límites vienen de `templates/criterios_electricos.json`, en estado **por_confirmar**: el ingeniero responsable debe confirmarlos contra NTC 2050 y RETIE.

## Equipos
- Inversor: Livoltek HP3-15KL2 (15 kW)
- Batería: Livoltek BHF-S10/S15/S20/S25/S30-G2, configuración s15: 307.2 V, 13.8 kWh útiles
- Generador FV: 8.93 kWp; relación DC/AC 0.595

## Temperaturas de diseño
- Mínima: 15 °C · Ambiente máxima: 40 °C · Celda máxima (NOCT): 71.25 °C

## Strings
- Por módulo: Voc en frío 53.95 V; Vmp en caliente 38.65 V
- Módulos por string: entre 4 y 18 (máximo por tensión máxima DC del inversor)
- Opciones válidas (1 string por MPPT): [[15], [8, 7], [5, 5, 5]]

| String | MPPT | Módulos | Voc frío (V) | Vmp caliente (V) | Isc (A) | Imp (A) |
|---|---|---|---|---|---|---|
| S1.1.1 | 1 | 8 | 431.6 | 309.2 | 15.11 | 14.4 |
| S1.2.1 | 2 | 7 | 377.6 | 270.6 | 15.11 | 14.4 |

## Circuitos

| Circuito | Tramo | I máx (A) | I conductor (A) | Calibre Cu (AWG) | Longitud est. (m) | Caída (%) | Protección |
|---|---|---|---|---|---|---|---|
| DC-S1.1.1 | string S1.1.1 → inversor (MPPT 1) | 18.89 | 23.61 | 10 | 13.0 | 0.42 (máx 2.0) | sin fusible de string (≤ 2 strings por MPPT; fusible máximo del módulo 30 A) |
| DC-S1.2.1 | string S1.2.1 → inversor (MPPT 2) | 18.89 | 23.61 | 10 | 8.9 | 0.33 (máx 2.0) | sin fusible de string (≤ 2 strings por MPPT; fusible máximo del módulo 30 A) |
| DC-BAT | batería BHF-S10/S15/S20/S25/S30-G2 (s15) → inversor | 48 | 60.0 | 4 | 5.1 | 0.16 (máx 2.0) | interruptor DC 60 A (verificar si el fabricante lo integra) |
| AC-RED | inversor (puerto red) → tablero / ATS | 39.4 | 49.25 | 6 | pendiente | pendiente | interruptor 50 A tripolar |
| AC-CARGA | inversor (puerto respaldo) → tablero de cargas | 39.4 | 49.25 | 6 | pendiente | pendiente | interruptor 50 A tripolar |

## Resultado

- ✅ Sin errores con los criterios actuales.

## Información faltante

- sistema/respaldo: alcance del respaldo (cargas críticas o respaldo total)
- zona-02/altura_estructura_mm: altura del borde bajo de los módulos sobre la cubierta (mm)
- equipos: ficha técnica del ATS (no está en la biblioteca)
- equipos: capacidad del totalizador y demanda de la vivienda (en serie toda la carga pasa por el inversor: máx. 23 kW de entrada AC)
- equipos: ubicación del tablero existente y longitud del circuito AC
- equipos: confirmar la ubicación del inversor, la batería y los tableros en el muro de la terraza alta
