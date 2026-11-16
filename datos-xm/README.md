# Generación eléctrica de Colombia por fuente (XM), 2021–2025

Generación diaria y mensual de energía **hidráulica, eólica y solar** del Sistema
Interconectado Nacional (SIN) de Colombia, del **2021-01-01 al 2025-12-31**, descargada de
la API pública de XM.

## Fuente

- API de XM (operador del sistema y administrador del mercado): `https://servapibi.xm.com.co`
- Repositorio de referencia: <https://github.com/EquipoAnaliticaXM/API_XM> (librería `pydataxm`)
- Descarga realizada el 2026-11-16.

### Métricas usadas

| Métrica | Entidad | Uso |
|---|---|---|
| `Gene` | `Recurso` | Generación horaria por recurso (planta/unidad), **kWh por hora**. Es la base de todos los archivos. |
| `Gene` | `Sistema` | Generación horaria total del SIN. Solo se usa como control: la suma de los recursos debe coincidir con este total. |
| `ListadoRecursos` | `Sistema` | Atributos de cada recurso; se usa `Values_Type` (HIDRAULICA, EOLICA, SOLAR, TERMICA, COGENERADOR) para asignar la fuente. |

Para clasificar los recursos retirados se consultaron también `EmisionesCO2Eq/Recurso` y
`CapEfecNeta/Recurso` de forma manual (ver *Advertencias*).

## Cómo correr

```bash
pip install requests pandas tabulate
python datos-xm/descargar_generacion.py                              # periodo completo
python datos-xm/descargar_generacion.py --inicio 2024-01-01 --fin 2024-12-31 --dias-bloque 15
```

- Consulta la API en bloques de `--dias-bloque` días (15 por defecto; el máximo de la API
  es 31), con reintentos y espera exponencial.
- Usa `requests` directamente en vez de `pydataxm`: `pydataxm` lanza todos los bloques en
  paralelo y la API devolvía *timeout*, mientras que las consultas secuenciales responden en ~3 s.
- Las respuestas crudas se guardan en `datos-xm/cache/` (ignorada por git). Al volver a
  correr se reutilizan; si quieres datos frescos, borra esa carpeta. Descargar todo el
  periodo toma unos 15 minutos.
- Los archivos generados van a `datos-xm/salida/`.

## Archivos de salida (`salida/`)

### `generacion_diaria_por_fuente.csv`
Una fila por fecha × fuente (1.826 días × 3 fuentes).

| Columna | Descripción |
|---|---|
| `fecha` | Día (AAAA-MM-DD, hora local de Colombia) |
| `fuente` | `hidraulica`, `eolica` o `solar` |
| `generacion_mwh` | Generación del día en **MWh** (suma de las 24 horas de todos los recursos de esa fuente) |
| `generacion_gwh` | La misma generación en **GWh** |
| `n_recursos` | Número de recursos de esa fuente con dato ese día |

### `generacion_mensual_por_fuente.csv`
| Columna | Descripción |
|---|---|
| `mes` | AAAA-MM |
| `fuente` | `hidraulica`, `eolica` o `solar` |
| `generacion_gwh` | Generación del mes en **GWh** |
| `dias_con_dato` / `dias_calendario` | Días con dato vs días del mes |
| `n_recursos_max` | Máximo de recursos con dato en un día del mes |

### `generacion_diaria_por_recurso.csv.gz`
Detalle por recurso y día, solo de las tres fuentes (~2,9 MB comprimido).
Columnas: `fecha`, `codigo` (código SIC del recurso), `nombre`, `fuente`, `fuente_energia`
(AGUA, VIENTO, RAD SOLAR), `origen_clasificacion` (`ListadoRecursos` o `manual`),
`generacion_mwh` (MWh/día) y `horas_con_dato` (horas con valor, de 0 a 24).

### Otros
- `listado_recursos.csv`: copia de `ListadoRecursos` usada para clasificar, más las filas manuales.
- `reporte_calidad.md`: controles de calidad y totales anuales, generado en cada ejecución.
- `../clasificacion_manual.csv`: clasificación de recursos retirados, con la evidencia de cada uno.

## Totales anuales (GWh)

| Año | Hidráulica | Eólica | Solar | Total SIN (todas las fuentes) |
|---|---:|---:|---:|---:|
| 2021 | 60.496,0 | 60,5 | 323,0 | 73.933,5 |
| 2022 | 64.337,3 | 74,3 | 502,5 | 76.908,4 |
| 2023 | 59.824,7 | 203,3 | 1.205,2 | 80.684,2 |
| 2024 | 54.494,3 | 148,8 | 3.303,3 | 83.262,9 |
| 2025 | 68.099,4 | 154,9 | 4.474,5 | 84.411,9 |

## Control de calidad

- **Cobertura**: los 1.826 días del periodo tienen datos; no hay recurso-días duplicados.
- **Unidad**: `Gene` viene en kWh por hora. Se suman las 24 horas y se divide entre 1.000
  para obtener MWh/día. Esto se comprobó con el orden de magnitud: el total del SIN da
  74–84 TWh/año, en línea con la demanda anual de Colombia (~80 TWh). La hidráulica aporta
  65–82 %; baja en 2024 por El Niño, cuando la térmica sube a ~24 TWh.
- **Cierre**: la suma diaria de todos los recursos coincide con `Gene/Sistema` (diferencia de 0,0000 %).
- **Horas vacías**: unos 186 mil recurso-días tienen horas vacías. La API omite las horas
  sin generación (por ejemplo, las nocturnas de las plantas solares) y el script las suma
  como 0. Ningún recurso-día tiene las 24 horas vacías.
- **Días sin dato eólico**: 7 días (2021-07-21, 2022-04-27, 2022-06-11, 2024-08-14 y
  2025-08-17 a 2025-08-19) no tienen ningún registro de recurso eólico. Se dejaron vacíos
  (NaN) en el CSV diario. Lo más probable es que la generación eólica fuera 0 esos días
  (parques detenidos).

## Advertencias

1. **`ListadoRecursos` es una foto actual**: la API ignora la fecha y devuelve los recursos
   vigentes hoy. Los recursos retirados antes de la descarga no aparecen. El caso más
   importante es **JPR1, el parque eólico Jepírachi** (18,4 MW, retirado en 2023): sin
   corrección, la eólica de 2021–2022 saldría en 0. Por eso existe `clasificacion_manual.csv`,
   que solo incluye casos con evidencia clara:
   - JPR1 → eólica: nombre conocido, perfil eólico y sin emisiones.
   - 3KOD, 3PKN, 3PKH, 3RKN → solar: generación nocturna nula.
   - ILC1, 3RKP, 3KL4 → térmica: reportan emisiones de CO2.
2. **Quedan 9 recursos sin clasificar** (61 GWh en 5 años, <0,02 % del total), sobre todo
   RUB1 (24 GWh) y JAG1 (23,6 GWh) en 2022-12 a 2023-11, y 3IRI (8,6 GWh) en 2023-10. No
   se incluyeron en ninguna fuente porque la evidencia es ambigua: tienen perfil plano y no
   reportan emisiones. Si fueran hidráulicos, cambiarían la hidráulica en menos de 0,1 %.
3. La clasificación usa el `Values_Type` **actual** de cada recurso. Si un recurso cambió de
   tecnología durante el periodo, se le asigna el tipo de hoy.
4. `Gene` incluye generación despachada y no despachada centralmente que XM registra
   (menores, autogeneración y AGPE reportados). La generación detrás del medidor que no se
   reporta a XM no está incluida, así que la solar distribuida real puede ser mayor.
5. Los datos recientes de XM pueden ser ajustados en liquidaciones posteriores; volver a
   descargar sin caché puede dar diferencias pequeñas.
