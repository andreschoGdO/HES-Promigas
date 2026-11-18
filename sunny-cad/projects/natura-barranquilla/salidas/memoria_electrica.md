# Memoria de cálculo eléctrico — Conjunto Natura - Barranquilla

> **Borrador técnico.** Los factores, tablas y límites vienen de `templates/criterios_electricos.json`, en estado **por_confirmar**: el ingeniero responsable debe confirmarlos contra NTC 2050 y RETIE.

## Equipos
- Inversor: Ningbo Deye Inverter Technology Co., Ltd. SUN-15K-SG01HP3-US-AM2 (15 kW)
- Batería: Ningbo Deye ESS Technology Co., Ltd. GB-L, configuración m3: 307.2 V, 11.04 kWh útiles
- Generador FV: 4.76 kWp; relación DC/AC 0.317

## Temperaturas de diseño
- Mínima: 15 °C · Ambiente máxima: 40 °C · Celda máxima (NOCT): 71.25 °C

## Strings
- Por módulo: Voc en frío 53.95 V; Vmp en caliente 38.65 V
- Módulos por string: entre 4 y 10 (máximo por tensión máxima DC del inversor)
- Opciones válidas (1 string por MPPT): [[8], [4, 4]]

| String | MPPT | Módulos | Voc frío (V) | Vmp caliente (V) | Isc (A) | Imp (A) |
|---|---|---|---|---|---|---|
| S1.1.1 | 1 | 8 | 431.6 | 309.2 | 15.11 | 14.4 |

## Circuitos

| Circuito | Tramo | I máx (A) | I conductor (A) | Calibre Cu (AWG) | Longitud est. (m) | Caída (%) | Protección |
|---|---|---|---|---|---|---|---|
| DC-S1.1.1 | string S1.1.1 → inversor (MPPT 1) | 18.89 | 23.61 | 10 | 13.4 | 0.43 (máx 2.0) | sin fusible de string (≤ 2 strings por MPPT; fusible máximo del módulo 30 A) |
| DC-BAT | batería GB-L (m3) → inversor | 50 | 62.5 | 4 | 4.8 | 0.15 (máx 2.0) | interruptor DC 63 A (verificar si el fabricante lo integra) |
| AC-RED | inversor (puerto red) → tablero FV (contactor / ATS) | 41.7 | 52.12 | 6 | 2.9 | 0.16 (máx 3.0) | interruptor 60 A tripolar |
| AC-CARGA | inversor (puerto respaldo) → tablero FV | 41.7 | 52.12 | 6 | 2.9 | 0.16 (máx 3.0) | interruptor 60 A tripolar |
| AC-EXISTENTE | tablero FV → tablero existente de la vivienda | 41.7 | 52.12 | 6 | 19.2 | 1.05 (máx 3.0) | interruptor 60 A tripolar |

## Resultado

- ✅ Sin errores con los criterios actuales.

## Información faltante

- sistema: confirmar arquitectura en serie con ATS y respaldo total (tomado de Riomar)
- equipos: potencia del inversor DEYE (en la biblioteca solo está el SUN-15K; la ficha trae 8/10/12K)
- equipos: '3 baterías DEYE' = una torre GB-L de 3 módulos (supuesto)
- equipos: posición exacta de los equipos en la pared y del punto de conexión; altura del cuarto
- zona-01: inclinación, altura de la estructura y si queda sobre la claraboya
- equipos: capacidad del totalizador y demanda de la vivienda
