"""Dimensionamiento de strings FV (Paso 5).

Todo sale de las fichas (módulo e inversor) y de las temperaturas de diseño del sitio:

- Voc máxima: a la temperatura mínima, con el coeficiente de Voc de la ficha.
- Vmp mínima: a la temperatura máxima de celda (modelo NOCT), con el coeficiente de Pmax como
  aproximación conservadora del de Vmp (la ficha no da coeficiente de Vmp).
- Corrientes: Isc / Imp de la ficha (bifaciales si el criterio lo indica).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Temperaturas:
    minima_c: float
    max_ambiente_c: float
    max_celda_c: float


def temperaturas(
    cond: dict[str, Any], modulo: dict[str, Any], criterios: dict[str, Any]
) -> Temperaturas:
    g = criterios["temperatura_celda"]["irradiancia_w_m2"]
    noct = modulo["electrico"]["noct_c"]
    ta = cond["temperatura_max_ambiente_c"]
    return Temperaturas(cond["temperatura_min_c"], ta, ta + (noct - 20) * g / 800)


@dataclass(frozen=True)
class Limites:
    voc_frio_v: float  # por módulo
    vmp_caliente_v: float
    vmp_frio_v: float
    n_min: int
    n_max: int
    motivo_n_max: str


def limites_string(modulo: dict[str, Any], inversor: dict[str, Any], t: Temperaturas) -> Limites:
    m, inv = modulo["electrico"], inversor["electrico"]
    voc_frio = m["voc_v"] * (1 + m["coef_temp_voc_pct_c"] / 100 * (t.minima_c - 25))
    vmp_cal = m["vmp_v"] * (1 + m["coef_temp_pmax_pct_c"] / 100 * (t.max_celda_c - 25))
    vmp_frio = m["vmp_v"] * (1 + m["coef_temp_pmax_pct_c"] / 100 * (t.minima_c - 25))
    n_min = math.ceil(inv["rango_mppt"]["min_v"] / vmp_cal)
    topes = {
        "tensión máxima DC del inversor": math.floor(inv["tension_max_dc_v"] / voc_frio),
        "tensión máxima del sistema del módulo": math.floor(m["tension_max_sistema_v"] / voc_frio),
        "rango MPPT máximo": math.floor(inv["rango_mppt"]["max_v"] / vmp_frio),
    }
    motivo, n_max = min(topes.items(), key=lambda kv: kv[1])
    return Limites(voc_frio, vmp_cal, vmp_frio, n_min, n_max, motivo)


def corrientes_modulo(modulo: dict[str, Any], criterios: dict[str, Any]) -> tuple[float, float]:
    """(Isc, Imp) a usar en el diseño."""
    m = modulo["electrico"]
    if criterios["usar_isc_bifacial"]["valor"] and m.get("isc_bifacial_a"):
        return m["isc_bifacial_a"], m.get("imp_bifacial_a", m["imp_a"])
    return m["isc_a"], m["imp_a"]


def particion(n_total: int, k: int) -> list[int]:
    """n_total módulos en k strings lo más parejos posible (los más largos primero)."""
    base, resto = divmod(n_total, k)
    return [base + 1] * resto + [base] * (k - resto)


def opciones(n_total: int, lim: Limites, inversor: dict[str, Any]) -> list[list[int]]:
    """Particiones válidas en 1 string por MPPT (k = 1 … número de MPPT)."""
    validas = []
    for k in range(1, inversor["electrico"]["numero_mppt"] + 1):
        p = particion(n_total, k)
        if all(lim.n_min <= n <= lim.n_max for n in p):
            validas.append(p)
    return validas


def elegir(validas: list[list[int]], preferidos: int) -> list[int] | None:
    if not validas:
        return None
    return min(validas, key=lambda p: (abs(len(p) - preferidos), len(p)))


def verificar(
    strings: list[int],
    modulo: dict[str, Any],
    inversor: dict[str, Any],
    t: Temperaturas,
    criterios: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Valores de cada string (1 string por MPPT) y errores contra el inversor."""
    lim = limites_string(modulo, inversor, t)
    inv = inversor["electrico"]
    isc, imp = corrientes_modulo(modulo, criterios)
    i_max_mppt = inv.get(
        "corrientes_max_por_mppt_a", [inv["corriente_max_entrada_por_mppt_a"]] * inv["numero_mppt"]
    )
    i_cc_mppt = inv.get(
        "corrientes_cortocircuito_por_mppt_a",
        [inv.get("corriente_max_cortocircuito_por_mppt_a", math.inf)] * inv["numero_mppt"],
    )
    filas, errores = [], []
    if len(strings) > inv["numero_mppt"]:
        errores.append(f"{len(strings)} strings y el inversor tiene {inv['numero_mppt']} MPPT")
    for i, n in enumerate(strings):
        fila = {
            "string": f"S1.{i + 1}.1",
            "mppt": i + 1,
            "modulos": n,
            "voc_frio_v": round(n * lim.voc_frio_v, 1),
            "vmp_caliente_v": round(n * lim.vmp_caliente_v, 1),
            "vmp_frio_v": round(n * lim.vmp_frio_v, 1),
            "isc_a": isc,
            "imp_a": imp,
        }
        filas.append(fila)
        if fila["voc_frio_v"] > inv["tension_max_dc_v"]:
            errores.append(
                f"{fila['string']}: Voc en frío {fila['voc_frio_v']} V "
                f"> {inv['tension_max_dc_v']} V"
            )
        if fila["vmp_caliente_v"] < inv["rango_mppt"]["min_v"]:
            errores.append(
                f"{fila['string']}: Vmp en caliente {fila['vmp_caliente_v']} V < MPPT mínimo"
            )
        if fila["vmp_frio_v"] > inv["rango_mppt"]["max_v"]:
            errores.append(f"{fila['string']}: Vmp en frío {fila['vmp_frio_v']} V > MPPT máximo")
        if i < len(i_max_mppt) and imp > i_max_mppt[i]:
            errores.append(f"{fila['string']}: Imp {imp} A > {i_max_mppt[i]} A del MPPT {i + 1}")
        if i < len(i_cc_mppt) and isc > i_cc_mppt[i]:
            errores.append(f"{fila['string']}: Isc {isc} A > {i_cc_mppt[i]} A del MPPT {i + 1}")
    return filas, errores
