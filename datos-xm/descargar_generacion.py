#!/usr/bin/env python3
"""Descarga la generación eléctrica de Colombia por fuente (eólica, hidráulica, solar)
desde la API pública de XM (servapibi.xm.com.co).

Métricas:
  - Gene / Recurso            -> generación horaria por recurso (kWh por hora).
  - Gene / Sistema            -> generación horaria total del SIN (kWh), usada solo como control.
  - ListadoRecursos / Sistema -> atributos de cada recurso (tipo de generación, fuente de energía...).

Uso:
  python datos-xm/descargar_generacion.py                    # 2021-01-01 .. 2025-12-31
  python datos-xm/descargar_generacion.py --inicio 2024-01-01 --fin 2024-12-31

Las respuestas crudas se guardan en datos-xm/cache/ (ignorado por git) para que una
ejecución interrumpida se pueda retomar sin volver a descargar todo.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import sys
import time
from pathlib import Path

import pandas as pd
import requests

URL_BASE = "https://servapibi.xm.com.co"
DIR = Path(__file__).resolve().parent
CACHE = DIR / "cache"
SALIDA = DIR / "salida"
HORAS = [f"Hour{h:02d}" for h in range(1, 25)]

# Tipo de generación de ListadoRecursos (Values_Type, normalizado) -> fuente de salida
FUENTES = {"HIDRAULICA": "hidraulica", "EOLICA": "eolica", "SOLAR": "solar"}


def post(endpoint: str, body: dict, intentos: int = 6, timeout: int = 120) -> dict:
    """POST a la API de XM con reintentos y espera exponencial."""
    for i in range(intentos):
        try:
            r = requests.post(f"{URL_BASE}/{endpoint}", json=body, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            espera = 5 * 2**i
            print(f"  ! {body['MetricId']} {body['StartDate']}..{body['EndDate']}: {e} "
                  f"(reintento {i + 1}/{intentos} en {espera}s)", file=sys.stderr)
            time.sleep(espera)
    raise RuntimeError(f"Falló la consulta {body}")


def bloques(inicio: dt.date, fin: dt.date, dias: int):
    """Divide [inicio, fin] en bloques de `dias` días (<= 31, límite de la API)."""
    a = inicio
    while a <= fin:
        b = min(a + dt.timedelta(days=dias - 1), fin)
        yield a, b
        a = b + dt.timedelta(days=1)


def horario(metric: str, entity: str, a: dt.date, b: dt.date) -> pd.DataFrame:
    """Consulta una métrica horaria y devuelve formato largo (fecha, codigo, kwh_dia, horas)."""
    CACHE.mkdir(exist_ok=True)
    f = CACHE / f"{metric}_{entity}_{a}_{b}.json.gz"
    if f.exists():
        data = json.loads(gzip.decompress(f.read_bytes()))
    else:
        body = {"MetricId": metric, "StartDate": str(a), "EndDate": str(b),
                "Entity": entity, "Filter": []}
        data = post("hourly", body)
        f.write_bytes(gzip.compress(json.dumps(data).encode()))
    filas = []
    for item in data.get("Items", []):
        for ent in item.get("HourlyEntities", []):
            v = ent["Values"]
            horas = [v.get(h) for h in HORAS]
            vals = [float(x) for x in horas if x not in (None, "")]
            filas.append({
                "fecha": item["Date"],
                "codigo": v.get("code", entity),
                "kwh": sum(vals) if vals else float("nan"),
                "horas_con_dato": len(vals),
            })
    return pd.DataFrame(filas, columns=["fecha", "codigo", "kwh", "horas_con_dato"])


def listado_recursos() -> pd.DataFrame:
    body = {"MetricId": "ListadoRecursos", "Entity": "Sistema",
            "StartDate": str(dt.date.today()), "EndDate": str(dt.date.today()), "Filter": []}
    data = post("lists", body)
    filas = [ent["Values"] for item in data["Items"] for ent in item["ListEntities"]]
    df = pd.DataFrame(filas)
    df.columns = [c[0].lower() + c[1:] for c in df.columns]
    df = df.rename(columns={"code": "codigo", "name": "nombre", "type": "tipo",
                            "enerSource": "fuente_energia", "disp": "despacho",
                            "recType": "clasificacion", "companyCode": "agente",
                            "operStartdate": "inicio_operacion", "state": "estado"})
    df["tipo"] = df["tipo"].str.upper().str.strip()
    df["origen_clasificacion"] = "ListadoRecursos"
    df = df.drop_duplicates("codigo")
    # ListadoRecursos es una foto actual: los recursos retirados no aparecen. Se completan
    # con clasificacion_manual.csv (solo casos con evidencia clara, ver README).
    man = pd.read_csv(DIR / "clasificacion_manual.csv")
    man = man[~man["codigo"].isin(df["codigo"])]
    man = man.assign(nombre=None, fuente_energia=None, origen_clasificacion="manual")
    df = pd.concat([df, man[["codigo", "tipo", "nombre", "fuente_energia",
                             "origen_clasificacion"]]], ignore_index=True)
    df["fuente"] = df["tipo"].map(FUENTES)
    return df


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--inicio", default="2021-01-01")
    p.add_argument("--fin", default="2025-12-31")
    p.add_argument("--dias-bloque", type=int, default=15, help="días por consulta (máx. 31)")
    args = p.parse_args()
    inicio, fin = dt.date.fromisoformat(args.inicio), dt.date.fromisoformat(args.fin)
    dias = min(max(args.dias_bloque, 1), 31)
    SALIDA.mkdir(exist_ok=True)

    print("Descargando ListadoRecursos…")
    rec = listado_recursos()
    rec.to_csv(SALIDA / "listado_recursos.csv", index=False)

    partes, sistema = [], []
    lista = list(bloques(inicio, fin, dias))
    for i, (a, b) in enumerate(lista, 1):
        print(f"[{i}/{len(lista)}] Gene {a}..{b}")
        partes.append(horario("Gene", "Recurso", a, b))
        sistema.append(horario("Gene", "Sistema", a, b))
    gen = pd.concat(partes, ignore_index=True)
    sis = pd.concat(sistema, ignore_index=True)
    gen["fecha"] = pd.to_datetime(gen["fecha"])
    sis["fecha"] = pd.to_datetime(sis["fecha"])
    # Si la API repitiera un recurso-día (no debería), conservar una sola fila.
    dup = gen.duplicated(["fecha", "codigo"]).sum()
    gen = gen.drop_duplicates(["fecha", "codigo"])

    gen = gen.merge(rec[["codigo", "nombre", "tipo", "fuente_energia", "fuente",
                         "origen_clasificacion"]],
                    on="codigo", how="left")
    gen["tipo"] = gen["tipo"].fillna("SIN_CLASIFICAR")
    gen["mwh"] = gen["kwh"] / 1000.0

    # ---------- Detalle por recurso (solo eólica, hidráulica, solar) ----------
    sel = gen[gen["fuente"].notna()].copy()
    det = sel[["fecha", "codigo", "nombre", "fuente", "fuente_energia", "origen_clasificacion",
           "mwh", "horas_con_dato"]]
    det = det.sort_values(["fecha", "fuente", "codigo"])
    det.assign(fecha=det["fecha"].dt.date).rename(columns={"mwh": "generacion_mwh"}).to_csv(
        SALIDA / "generacion_diaria_por_recurso.csv.gz", index=False, float_format="%.4f",
        compression="gzip")

    # ---------- Diario por fuente ----------
    fechas = pd.date_range(inicio, fin, freq="D")
    idx = pd.MultiIndex.from_product([fechas, sorted(FUENTES.values())], names=["fecha", "fuente"])
    diario = (sel.groupby(["fecha", "fuente"])
              .agg(generacion_mwh=("mwh", "sum"), n_recursos=("codigo", "nunique"))
              .reindex(idx).reset_index())
    diario["generacion_gwh"] = diario["generacion_mwh"] / 1000.0
    diario["n_recursos"] = diario["n_recursos"].fillna(0).astype(int)
    diario = diario[["fecha", "fuente", "generacion_mwh", "generacion_gwh", "n_recursos"]]
    diario.assign(fecha=diario["fecha"].dt.date).to_csv(
        SALIDA / "generacion_diaria_por_fuente.csv", index=False, float_format="%.4f")

    # ---------- Mensual y anual por fuente ----------
    d = diario.assign(mes=diario["fecha"].dt.to_period("M"), anio=diario["fecha"].dt.year)
    mensual = (d.groupby(["mes", "fuente"])
               .agg(generacion_gwh=("generacion_gwh", "sum"),
                    dias_con_dato=("generacion_mwh", "count"),
                    dias_calendario=("fecha", "count"),
                    n_recursos_max=("n_recursos", "max"))
               .reset_index())
    mensual["mes"] = mensual["mes"].astype(str)
    mensual.to_csv(SALIDA / "generacion_mensual_por_fuente.csv", index=False, float_format="%.4f")
    anual = d.groupby(["anio", "fuente"])["generacion_gwh"].sum().unstack()

    # ---------- Control de calidad ----------
    tot_rec = gen.groupby("fecha")["mwh"].sum()
    tot_sis = sis.groupby("fecha")["kwh"].sum() / 1000.0
    comp = pd.DataFrame({"suma_recursos_mwh": tot_rec, "gene_sistema_mwh": tot_sis})
    comp["dif_pct"] = 100 * (comp["suma_recursos_mwh"] / comp["gene_sistema_mwh"] - 1)
    anual_todas = gen.assign(anio=gen["fecha"].dt.year).groupby(["anio", "tipo"])["mwh"].sum() \
        .unstack().fillna(0) / 1e3
    sin_clas = gen[gen["tipo"] == "SIN_CLASIFICAR"]
    dias_falt = {f: [str(x.date()) for x in diario[(diario.fuente == f) &
                                                    diario.generacion_mwh.isna()]["fecha"]]
                 for f in FUENTES.values()}
    rep = []
    rep.append(f"# Reporte de calidad – Gene por Recurso {inicio} a {fin}\n")
    rep.append(f"Generado: {dt.datetime.now():%Y-%m-%d %H:%M}\n")
    rep.append(f"- Filas recurso-día descargadas: {len(gen):,}; duplicadas eliminadas: {dup}")
    rep.append(f"- Días esperados: {len(fechas)}; días con datos en Gene/Recurso: "
               f"{gen['fecha'].nunique()}")
    rep.append(f"- Recurso-días con alguna hora vacía (la API omite las horas sin generación; "
               f"se suman como 0): {(gen.horas_con_dato < 24).sum():,} "
               f"(sin ninguna hora: {(gen.horas_con_dato == 0).sum():,})")
    for f, lst in dias_falt.items():
        rep.append(f"- Días sin dato para {f}: {len(lst)}" + (f" -> {lst[:20]}" if lst else ""))
    man = gen[gen["origen_clasificacion"] == "manual"]
    rep.append(f"- Recursos clasificados manualmente (clasificacion_manual.csv): "
               f"{man.codigo.nunique()} -> " + ", ".join(
                   f"{c} {t}={v / 1e3:,.2f} GWh" for (c, t), v in
                   man.groupby(["codigo", "tipo"])["mwh"].sum().items()))
    rep.append(f"- Recursos sin clasificar (ni en ListadoRecursos actual ni en la tabla manual): "
               f"{sin_clas.codigo.nunique()} recursos, "
               f"{sin_clas.mwh.sum() / 1e3:,.3f} GWh en todo el periodo")
    if len(sin_clas):
        top = sin_clas.groupby("codigo")["mwh"].sum().sort_values(ascending=False).head(15) / 1e3
        rep.append("  - Principales (GWh): " + ", ".join(f"{k}={v:,.2f}" for k, v in top.items()))
    rep.append(f"- Suma de recursos vs Gene/Sistema (diferencia % diaria): "
               f"media {comp.dif_pct.mean():.4f}, mín {comp.dif_pct.min():.4f}, "
               f"máx {comp.dif_pct.max():.4f}")
    rep.append("\n## Total anual por fuente (GWh)\n")
    rep.append(anual.round(1).to_markdown())
    rep.append("\n## Total anual por tipo, todas las fuentes (GWh)\n")
    anual_todas["TOTAL"] = anual_todas.sum(axis=1)
    rep.append(anual_todas.round(1).to_markdown())
    rep.append("\n## Gene/Sistema anual (GWh)\n")
    rep.append((tot_sis.groupby(tot_sis.index.year).sum() / 1e3).round(1).to_frame("GWh").to_markdown())
    (SALIDA / "reporte_calidad.md").write_text("\n".join(rep) + "\n", encoding="utf-8")
    print("\n".join(rep))


if __name__ == "__main__":
    main()
