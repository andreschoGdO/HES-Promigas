# Simulaciones PVsyst 8.0.7 — casas del piloto Sunny

Plan generado con:

```bash
.venv/bin/python -m engine.simulacion.pvsyst simulaciones/pvsyst/privado/Seguimiento_entregables.xlsx
```

- `plan_casas.csv`: una fila por casa (52), con la configuración de strings que PVsyst acepta sin
  advertencias de tensión, la relación DC/AC y observaciones.
- `sitios_pvgis.csv`: 13 sitios (coordenadas a 2 decimales) para descargar el clima de PVGIS.
- Componentes en `library/pvsyst/`: `JAM72D40-595_LB.PAN`, `SUN-15K-SG01HP3-US-AM2.OND`,
  `Livoltek-HP3-10KD1.OND`, `Livoltek-HP3-15KD1.OND`, `Deye_GB-L.BTR`.

## Criterios de verificación de strings (los mismos de PVsyst)

| Verificación | Condición | Valor usado |
|---|---|---|
| Tensión absoluta | n × Voc(Tmin) ≤ VAbsMax del .OND | Tmin por ciudad: Cartagena 20 °C, Turbaco 18 °C, Cali 12 °C (**supuestos**) |
| Mínimo MPPT | n × Vmp(60 °C) ≥ VMppMin | 60 °C = valor por defecto de PVsyst |
| Máximo MPPT | n × Vmp(20 °C) ≤ VMPPMax | 20 °C = valor por defecto de PVsyst |
| Strings | uno por MPPT; desiguales en subconjuntos distintos | — |

## Pasos en PVsyst (por sitio)

1. **Componentes**: importar los .PAN/.OND/.BTR a la base de datos del usuario (o copiarlos en
   las carpetas `ComposPV` del espacio de trabajo de PVsyst). El Huawei SUN2000-10K-LC0 se toma
   de la base de datos de PVsyst.
2. **Clima (PVGIS)**: crear el sitio con las coordenadas de `sitios_pvgis.csv` e importar el año
   meteorológico típico (TMY) de PVGIS desde PVsyst.
3. **Proyecto** (uno por sitio, conectado a red): sitio y clima del paso 2. En los parámetros del
   proyecto, fijar la temperatura mínima para la tensión absoluta con el `tmin_c` del sitio (si no,
   PVsyst usa −10 °C y marcará strings largos como fuera de rango).
4. **Variantes** (una por casa, nombre = columna `variante`):
   - Orientación: **pendiente** (inclinación y azimut de cada casa).
   - Sistema: módulo JA JAM72D40-595/LB, inversor según `archivo_ond`, subconjuntos según
     `configuracion_pvsyst`.
   - Pérdidas (propuesta a confirmar): térmicas Uc = 20 W/m²K (coplanar con poca ventilación),
     óhmicas DC 1,5 % a STC, suciedad 2 %, LID según el .PAN, desajuste (mismatch) por defecto.
5. **Simular** y exportar el informe PDF con el nombre de la variante.

## Pendientes antes de simular

- Inclinación y azimut de cada casa (no están en el Excel).
- Objetivo: solo producción (sistema conectado a red) o autoconsumo con batería (requiere perfil
  de consumo por casa y archivos de batería Livoltek BHF y Huawei LUNA2000).
- Confirmar el módulo: el .PAN es la versión **LB**; el diseño de sunny-cad usa la **MB**.
- Confirmar las temperaturas mínimas de diseño por ciudad.
