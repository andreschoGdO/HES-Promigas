# Reporte de calidad – Gene por Recurso 2021-01-01 a 2025-12-31

Generado: 2026-11-16 17:13

- Filas recurso-día descargadas: 444,345; duplicadas eliminadas: 0
- Días esperados: 1826; días con datos en Gene/Recurso: 1826
- Recurso-días con alguna hora vacía (la API omite las horas sin generación; se suman como 0): 186,509 (sin ninguna hora: 0)
- Días sin dato para hidraulica: 0
- Días sin dato para eolica: 7 -> ['2021-07-21', '2022-04-27', '2022-06-11', '2024-08-14', '2025-08-17', '2025-08-18', '2025-08-19']
- Días sin dato para solar: 0
- Recursos clasificados manualmente (clasificacion_manual.csv): 8 -> 3KL4 TERMICA=48.10 GWh, 3KOD SOLAR=0.78 GWh, 3PKH SOLAR=3.44 GWh, 3PKN SOLAR=1.79 GWh, 3RKN SOLAR=0.78 GWh, 3RKP TERMICA=9.84 GWh, ILC1 TERMICA=7.83 GWh, JPR1 EOLICA=134.01 GWh
- Recursos sin clasificar (ni en ListadoRecursos actual ni en la tabla manual): 9 recursos, 61.385 GWh en todo el periodo
  - Principales (GWh): RUB1=24.06, JAG1=23.57, 3IRI=8.63, 4SNT=2.85, 3AL6=0.79, 2Y2T=0.46, 3AL8=0.43, 3IJF=0.35, 3E98=0.24
- Suma de recursos vs Gene/Sistema (diferencia % diaria): media 0.0000, mín -0.0000, máx 0.0000

## Total anual por fuente (GWh)

|   anio |   eolica |   hidraulica |   solar |
|-------:|---------:|-------------:|--------:|
|   2021 |     60.5 |      60496   |   323   |
|   2022 |     74.3 |      64337.3 |   502.5 |
|   2023 |    203.3 |      59824.7 |  1205.2 |
|   2024 |    148.8 |      54494.3 |  3303.3 |
|   2025 |    154.9 |      68099.4 |  4474.5 |

## Total anual por tipo, todas las fuentes (GWh)

|   anio |   COGENERADOR |   EOLICA |   HIDRAULICA |   SIN_CLASIFICAR |   SOLAR |   TERMICA |   TOTAL |
|-------:|--------------:|---------:|-------------:|-----------------:|--------:|----------:|--------:|
|   2021 |         781.4 |     60.5 |      60496   |              1.2 |   323   |   12271.4 | 73933.5 |
|   2022 |         760.4 |     74.3 |      64337.3 |              1   |   502.5 |   11232.9 | 76908.4 |
|   2023 |         784.3 |    203.3 |      59824.7 |             56.2 |  1205.2 |   18610.5 | 80684.2 |
|   2024 |         835.6 |    148.8 |      54494.3 |              0.2 |  3303.3 |   24480.8 | 83262.9 |
|   2025 |         847.5 |    154.9 |      68099.4 |              2.8 |  4474.5 |   10832.8 | 84411.9 |

## Gene/Sistema anual (GWh)

|   fecha |     GWh |
|--------:|--------:|
|    2021 | 73933.5 |
|    2022 | 76908.4 |
|    2023 | 80684.2 |
|    2024 | 83262.9 |
|    2025 | 84411.9 |
