# Biblioteca de componentes

Un JSON por equipo, validado contra `engine/esquemas/componente.schema.json`. Cada dato viene de
la ficha citada en `fuente`; la copia de la ficha está en `fichas/`.

| Tipo | id | Equipo | Ficha |
|---|---|---|---|
| Inversor | `huawei-sun2000-10k-lc0` | Huawei SUN2000-10K-LC0 (monofásico, usado en T1 entre dos fases) | 01-202402 |
| Inversor | `deye-sun-15k-sg01hp3-us-am2` | DEYE SUN-15K-SG01HP3-US-AM2 (trifásico 120/208 V) | sin revisión |
| Batería | `huawei-luna2000-s1` | Huawei LUNA2000-7/14/21-S1 (1–3 módulos de 6,9 kWh) | 01-202401 |
| Batería | `deye-gb-l` | DEYE GB-L (2–6 módulos de 4,09 kWh) | sin revisión |
| Conmutación | `huawei-smartguard-63a-s0` | Huawei SmartGuard-63A-S0 | 04-202311 **preliminar** |
| Módulo FV | `ja-solar-jam72d40-595-mb` | JA Solar JAM72D40-595/MB bifacial | Global-EN-20240326A |
| Inversor | `livoltek-hp3-10kl2` | Livoltek HP3-10KL2 (trifásico 127/220 V) — serie L2 "Upcoming" | sin revisión |
| Inversor | `livoltek-hp3-15kl2` | Livoltek HP3-15KL2 (trifásico 127/220 V) — serie L2 "Upcoming" | sin revisión |
| Batería | `livoltek-bhf` | Livoltek BHF-S10…S30 (2–6 módulos de 5,12 kWh) | sin revisión |
| Medidor | `star-dtsy23s` | STAR DTSY23S (Inelca), trifásico 3×120/208 V, riel DIN, bidireccional | FT-VS-0625 |
| Inversor | `ejemplo-inversor-hibrido-bifasico` | EJEMPLO, NO REAL (solo pruebas) | — |

Reglas de compatibilidad (confirmadas por el usuario):
- Cada batería solo con inversores de su marca (`marcas_inversor_compatibles`).
- DEYE GB-L: hasta 3 torres en paralelo de 4 módulos con el DEYE SUN-15K.
- LUNA2000 con SUN2000-LC0: 1 sistema por inversor.

Pendientes (sin ficha): protecciones, tableros, estructura de montaje.

Para agregar un equipo: copiar un JSON del mismo tipo, llenar los datos desde la ficha, guardar la
ficha en `fichas/<fabricante>/<id>.pdf` y correr `python -m engine.validar`.
