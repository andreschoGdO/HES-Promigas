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
| DC-S1.1.1 | string S1.1.1 → inversor (MPPT 1) | 18.89 | 23.61 | 10 | 14.1 | 0.45 (máx 2.0) | sin fusible de string (≤ 2 strings por MPPT; fusible máximo del módulo 30 A) |
| DC-S1.2.1 | string S1.2.1 → inversor (MPPT 2) | 18.89 | 23.61 | 10 | 16.7 | 0.61 (máx 2.0) | sin fusible de string (≤ 2 strings por MPPT; fusible máximo del módulo 30 A) |
| DC-BAT | batería BHF-S10/S15/S20/S25/S30-G2 (s15) → inversor | 48 | 60.0 | 4 | 4.7 | 0.15 (máx 2.0) | interruptor DC 60 A (verificar si el fabricante lo integra) |
| AC-RED | inversor (puerto red) → tablero FV (contactor / ATS) | 39.4 | 49.25 | 6 | 2.8 | 0.14 (máx 3.0) | interruptor 50 A tripolar |
| AC-CARGA | inversor (puerto respaldo) → tablero FV | 39.4 | 49.25 | 6 | 2.8 | 0.14 (máx 3.0) | interruptor 50 A tripolar |
| AC-EXISTENTE | tablero FV → tablero existente de la vivienda | 39.4 | 49.25 | 6 | 16.8 | 0.82 (máx 3.0) | interruptor 50 A tripolar |

## Resultado

- ✅ Sin errores con los criterios actuales.

## Información faltante

- zona-02/altura_estructura_mm: altura del borde bajo de los módulos sobre la cubierta (mm)
- equipos: capacidad del totalizador y demanda de la vivienda (en serie toda la carga pasa por el inversor: máx. 23 kW de entrada AC)
- equipos: altura de piso y recorrido horizontal hasta el tablero existente (supuestos 3,0 m y 3 m)
- equipos: ancho del buitrón (supuesto 40 cm) y fondo del piso frente a los equipos (supuesto 1,6 m)
