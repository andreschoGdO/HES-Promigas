"""Preparación de simulaciones en PVsyst (8.x) para las casas del piloto Sunny.

Lee el seguimiento de entregables (Excel) y los archivos de componentes de PVsyst (.PAN, .OND)
de ``library/pvsyst/``, y propone para cada casa la configuración de strings que PVsyst acepta
sin advertencias de tensión, con las mismas convenciones que usa PVsyst al verificar el diseño:

- Tensión máxima absoluta: Voc a la temperatura mínima del sitio (``Tmin``, se fija en PVsyst en
  Proyecto → Parámetros del proyecto → "Temperatura mínima para la tensión absoluta").
- Ventana MPPT: Vmp a 60 °C (verano, por defecto en PVsyst) ≥ VMppMin y Vmp a 20 °C (invierno)
  ≤ VMPPMax.
- Un string por MPPT; strings desiguales van en subconjuntos (sub-arrays) distintos.

Las temperaturas mínimas por ciudad son SUPUESTOS a confirmar (ver ``TMIN_C``).
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parents[2]
DIR_PVSYST = RAIZ / "library" / "pvsyst"

# SUPUESTOS: mínima ambiente de diseño (°C) para la tensión absoluta. Confirmar con datos del sitio.
TMIN_C = {"CARTAGENA": 20.0, "TURBACO": 18.0, "CALI": 12.0}
T_VERANO_C = 60.0  # temperatura de celda para Vmp mínima (valor por defecto de PVsyst)
T_INVIERNO_C = 20.0  # temperatura de celda para Vmp máxima (valor por defecto de PVsyst)


# ----------------------------------------------------------------------------- lectura PVsyst
def leer_pvsyst(ruta: Path) -> dict[str, str]:
    """Lee un archivo de PVsyst (.PAN/.OND/.BTR) como clave=valor (claves de todos los niveles;
    si una clave se repite, gana la primera)."""
    datos: dict[str, str] = {}
    texto = ruta.read_bytes().decode("utf-8-sig", errors="replace")
    for linea in texto.splitlines():
        m = re.match(r"\s*([A-Za-z_][\w ]*?)\s*=(.*)$", linea)
        if m and m.group(1) not in datos:
            datos[m.group(1)] = m.group(2).strip()
    return datos


@dataclass
class Modulo:
    archivo: str
    modelo: str
    pnom_w: float
    voc: float
    vmp: float
    isc: float
    imp: float
    mu_voc_v: float  # V/°C
    mu_pmp_pct: float  # %/°C
    mu_isc_a: float  # A/°C
    bifacial: float

    @classmethod
    def desde_pan(cls, ruta: Path) -> Modulo:
        d = leer_pvsyst(ruta)
        return cls(
            ruta.name,
            d["Model"],
            float(d["PNom"]),
            float(d["Voc"]),
            float(d["Vmp"]),
            float(d["Isc"]),
            float(d["Imp"]),
            float(d["muVocSpec"]) / 1000,
            float(d["muPmpReq"]),
            float(d["muISC"]) / 1000,
            float(d.get("BifacialityFactor", 0) or 0),
        )

    def voc_a(self, t: float) -> float:
        return self.voc + self.mu_voc_v * (t - 25)

    def vmp_a(self, t: float) -> float:
        # Coef. de Vmp ≈ coef. de Pmp − coef. de Imp (≈ coef. de Isc relativo)
        mu_vmp = self.mu_pmp_pct / 100 - self.mu_isc_a / self.isc
        return self.vmp * (1 + mu_vmp * (t - 25))


@dataclass
class Inversor:
    nombre: str
    archivo: str | None  # None: no hay .OND (se usa la base de datos de PVsyst)
    pnom_ac_w: float
    vmpp_min: float
    vmpp_max: float
    vabs_max: float
    n_mppt: int
    imax_mppt_a: float | None  # corriente máx. de entrada por MPPT (si se conoce)
    fases: str
    notas: list[str] = field(default_factory=list)

    @classmethod
    def desde_ond(cls, nombre: str, ruta: Path, notas: list[str] | None = None) -> Inversor:
        d = leer_pvsyst(ruta)
        n = int(d.get("NbMPPT") or d.get("NbInputs") or 1)
        return cls(
            nombre,
            ruta.name,
            float(d["PNomConv"]) * 1000,
            float(d["VMppMin"]),
            float(d["VMPPMax"]),
            float(d["VAbsMax"]),
            n,
            float(d["IMaxDC"]) / n if float(d.get("IMaxDC") or 0) else None,
            "trifasica" if d.get("MonoTri") == "Tri" else "monofasica",
            notas or [],
        )


def inversores() -> dict[str, Inversor]:
    """Inversores del Excel → datos para dimensionar. Claves en minúsculas sin espacios."""
    inv = {
        "deye15kw": Inversor.desde_ond(
            "DEYE SUN-15K-SG01HP3-US-AM2", DIR_PVSYST / "SUN-15K-SG01HP3-US-AM2.OND"
        ),
        "livoltek10kw": Inversor.desde_ond(
            "Livoltek HP3-10K",
            DIR_PVSYST / "Livoltek-HP3-10KD1.OND",
            ["El .OND es la variante D1 (230/400 V); en obra va la L2 (127/220 V): mismo lado DC"],
        ),
        "livoltek15kw": Inversor.desde_ond(
            "Livoltek HP3-15K",
            DIR_PVSYST / "Livoltek-HP3-15KD1.OND",
            ["El .OND es la variante D1 (230/400 V); en obra va la L2 (127/220 V): mismo lado DC"],
        ),
        # Sin .OND: datos de la ficha (library/inversores/huawei-sun2000-10k-lc0.json)
        "huawei10kw": Inversor(
            "Huawei SUN2000-10K-LC0",
            None,
            10000,
            40,
            560,
            600,
            3,
            16,
            "monofasica",
            ["Sin .OND adjunto: buscar SUN2000-10K-LC0 en la base de datos de PVsyst"],
        ),
    }
    return inv


# ----------------------------------------------------------------------------- dimensionamiento
@dataclass
class Opcion:
    strings: list[int]
    voc_max_v: float
    vmp_min_v: float
    vmp_max_v: float
    advertencias: list[str]


def verificar(longitudes: list[int], m: Modulo, inv: Inversor, tmin: float) -> Opcion | None:
    if len(longitudes) > inv.n_mppt:
        return None
    voc = max(longitudes) * m.voc_a(tmin)
    vmp_min = min(longitudes) * m.vmp_a(T_VERANO_C)
    vmp_max = max(longitudes) * m.vmp_a(T_INVIERNO_C)
    if voc > inv.vabs_max or vmp_min < inv.vmpp_min or vmp_max > inv.vmpp_max:
        return None
    adv = []
    if vmp_min < inv.vmpp_min * 1.05:
        adv.append(
            f"Vmp 60 °C ({vmp_min:.0f} V) solo {vmp_min / inv.vmpp_min - 1:.0%} sobre el mín. MPPT"
        )
    if inv.imax_mppt_a and m.imp > inv.imax_mppt_a:
        adv.append(f"Imp {m.imp} A > {inv.imax_mppt_a:.0f} A por MPPT: recorte por corriente")
    return Opcion(longitudes, round(voc, 1), round(vmp_min, 1), round(vmp_max, 1), adv)


# Más de este número de módulos se reparten en varios strings aunque la tensión lo permita
# (usuario: los strings de 14 y 16 módulos de Livoltek se dividen en dos).
MAX_SERIE_PREFERIDA = 10


def proponer_strings(n: int, m: Modulo, inv: Inversor, tmin: float) -> Opcion | None:
    """Menor número de strings (uno por MPPT) que cumple, con longitudes lo más parejas posible
    y sin pasar de MAX_SERIE_PREFERIDA módulos por string cuando hay MPPT libres."""
    k_min = min(inv.n_mppt, -(-n // MAX_SERIE_PREFERIDA))
    for k in range(k_min, inv.n_mppt + 1):
        op = proponer_strings_k(n, k, m, inv, tmin)
        if op:
            return op
    return None


def proponer_strings_k(n: int, k: int, m: Modulo, inv: Inversor, tmin: float) -> Opcion | None:
    base, resto = divmod(n, k)
    return verificar([base + 1] * resto + [base] * (k - resto), m, inv, tmin) if base else None


# ----------------------------------------------------------------------------- Excel
def _clave_inversor(texto: str) -> str:
    return re.sub(r"\s+", "", str(texto)).lower()


def leer_casas(ruta_excel: Path) -> list[dict[str, Any]]:
    import openpyxl

    ws = openpyxl.load_workbook(ruta_excel, data_only=True).worksheets[0]
    filas = list(ws.iter_rows(values_only=True))
    enc = [str(x).strip() if x else "" for x in filas[0]]
    casas = []
    for f in filas[1:]:
        d = dict(zip(enc, f, strict=False))
        if not d.get("Coordenadas") or not d.get("PANELES"):
            continue
        lat, lon = (float(x) for x in str(d["Coordenadas"]).split(","))
        casas.append(
            {
                "ciudad": str(d["Ciudad"]).strip().upper(),
                "proyecto": str(d["PROYECTO"]).strip(),
                "casa": str(d["CASA"]).strip(),
                "inversor": str(d["EQUIPO INVERSOR"]).strip(),
                "tipo": str(d["Tipo"]).strip(),
                "modulos": int(d["PANELES"]),
                "baterias": d.get("BATERÍAS"),
                "bms": d.get("BMS"),
                "smartguard": d.get("SmartGuard"),
                "kwp_excel": float(str(d["POTENCIA kWp"]).replace(",", ".")),
                "lat": lat,
                "lon": lon,
            }
        )
    return casas


def plan(casas: list[dict[str, Any]], modulo: Modulo) -> tuple[list[dict], list[dict]]:
    """Devuelve (filas del plan por casa, sitios únicos para PVGIS)."""
    invs = inversores()
    sitios: dict[tuple[float, float], dict] = {}
    filas = []
    for c in casas:
        lat2, lon2 = round(c["lat"], 2), round(c["lon"], 2)
        sitio = sitios.setdefault(
            (lat2, lon2),
            {
                "sitio": f"S{len(sitios) + 1:02d}",
                "ciudad": c["ciudad"],
                "proyecto": c["proyecto"],
                "lat": lat2,
                "lon": lon2,
                "tmin_c": TMIN_C.get(c["ciudad"]),
            },
        )
        inv = invs.get(_clave_inversor(c["inversor"]))
        obs: list[str] = []
        kwp = c["modulos"] * modulo.pnom_w / 1000
        if abs(kwp - c["kwp_excel"]) > 0.02:
            obs.append(f"kWp del Excel {c['kwp_excel']} ≠ {kwp:.2f} calculado")
        op = None
        if inv is None:
            obs.append(f"inversor desconocido: {c['inversor']}")
        else:
            op = proponer_strings(c["modulos"], modulo, inv, sitio["tmin_c"] or 10.0)
            if op is None:
                obs.append("ninguna configuración de strings cumple")
            else:
                obs += op.advertencias
            obs += inv.notas
        subconj = ""
        if op:
            if len(set(op.strings)) == 1:
                subconj = f"1 subconjunto: {op.strings[0]} en serie × {len(op.strings)} string(s)"
            else:
                subconj = " + ".join(
                    f"subconj. {i + 1}: {n} en serie × 1 string (MPPT {i + 1})"
                    for i, n in enumerate(op.strings)
                )
        filas.append(
            {
                "sitio": sitio["sitio"],
                "ciudad": c["ciudad"],
                "proyecto": c["proyecto"],
                "casa": c["casa"],
                "variante": f"{c['proyecto'][:12]}-{c['casa']}".replace(" ", "_"),
                "inversor": inv.nombre if inv else c["inversor"],
                "archivo_ond": (inv.archivo if inv else None) or "base de datos PVsyst",
                "fases": c["tipo"],
                "modulos": c["modulos"],
                "kwp": round(kwp, 2),
                "dc_ac": round(kwp * 1000 / inv.pnom_ac_w, 2) if inv else None,
                "strings": "+".join(map(str, op.strings)) if op else "",
                "configuracion_pvsyst": subconj,
                "voc_max_v": op.voc_max_v if op else None,
                "vmp_min_60c_v": op.vmp_min_v if op else None,
                "vmp_max_20c_v": op.vmp_max_v if op else None,
                "baterias": c["baterias"],
                "bms": c["bms"],
                "observaciones": "; ".join(obs),
            }
        )
    return filas, list(sitios.values())


def escribir_csv(filas: list[dict], ruta: Path) -> Path:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with ruta.open("w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel abre bien las tildes
        w = csv.DictWriter(f, fieldnames=list(filas[0]), delimiter=";")
        w.writeheader()
        w.writerows(filas)
    return ruta


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="python -m engine.simulacion.pvsyst")
    p.add_argument("excel", type=Path, help="Seguimiento de entregables (.xlsx)")
    p.add_argument("--salida", type=Path, default=RAIZ / "simulaciones" / "pvsyst")
    args = p.parse_args(argv)
    modulo = Modulo.desde_pan(DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, sitios = plan(leer_casas(args.excel), modulo)
    escribir_csv(filas, args.salida / "plan_casas.csv")
    escribir_csv(sitios, args.salida / "sitios_pvgis.csv")
    print(f"Módulo: {modulo.modelo} ({modulo.archivo})")
    print(f"{len(filas)} casas en {len(sitios)} sitios → {args.salida}")
    for f in filas:
        if f["observaciones"]:
            print(f"  {f['proyecto']} {f['casa']}: {f['observaciones']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
