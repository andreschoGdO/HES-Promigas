"""Conductores, protecciones y caída de tensión (Paso 5).

Las tablas y factores vienen de ``templates/criterios_electricos.json`` (por confirmar por el
ingeniero). Aquí solo se aplican.
"""

from __future__ import annotations

import math
from typing import Any

from engine.distribucion.colocacion import direccion


def factor_temperatura(criterios: dict[str, Any], ambiente_c: float) -> float:
    for tramo in criterios["correccion_temperatura_75c"]["tramos"]:
        if ambiente_c <= tramo["hasta_c"]:
            return tramo["factor"]
    raise ValueError(f"temperatura ambiente {ambiente_c} °C fuera de la tabla de corrección")


def calibre_por_ampacidad(
    corriente_requerida_a: float, criterios: dict[str, Any], ambiente_c: float, minimo: str
) -> str:
    """Menor calibre de cobre (75 °C) cuya ampacidad corregida ≥ la corriente requerida."""
    f = factor_temperatura(criterios, ambiente_c)
    calibres = list(criterios["ampacidad_cu_75c_a"]["valores"].items())
    inicio = [c for c, _ in calibres].index(minimo)
    for calibre, amp in calibres[inicio:]:
        if amp * f >= corriente_requerida_a:
            return calibre
    raise ValueError(f"ningún calibre de la tabla soporta {corriente_requerida_a:.1f} A")


def interruptor(corriente_a: float, criterios: dict[str, Any]) -> int:
    """Menor valor estándar ≥ la corriente."""
    for valor in criterios["interruptores_estandar_a"]:
        if valor >= corriente_a - 1e-9:
            return valor
    raise ValueError(f"no hay interruptor estándar para {corriente_a:.1f} A")


def caida_dc_pct(
    longitud_m: float, corriente_a: float, tension_v: float, calibre: str, criterios
) -> float:
    """Ida y vuelta: ΔV = 2 · L · I · ρ / S."""
    rho = criterios["resistividad_cu_75c_ohm_mm2_m"]["valor"]
    s = criterios["seccion_awg_mm2"]["valores"][calibre]
    return 2 * longitud_m * corriente_a * rho / s / tension_v * 100


def caida_ac3f_pct(
    longitud_m: float, corriente_a: float, tension_linea_v: float, calibre: str, criterios
) -> float:
    """Trifásico, solo resistencia: ΔV = √3 · L · I · ρ / S."""
    rho = criterios["resistividad_cu_75c_ohm_mm2_m"]["valor"]
    s = criterios["seccion_awg_mm2"]["valores"][calibre]
    return math.sqrt(3) * longitud_m * corriente_a * rho / s / tension_linea_v * 100


def longitud_ruta_m(
    a_mm: tuple[float, float],
    za_mm: float,
    b_mm: tuple[float, float],
    zb_mm: float,
    rumbo_edificio_deg: float,
    criterios: dict[str, Any],
) -> float:
    """Ruta en L siguiendo los ejes del edificio + desnivel + reserva (estimación)."""
    ux, uy = direccion(rumbo_edificio_deg)
    vx, vy = direccion(rumbo_edificio_deg + 90)
    dx, dy = b_mm[0] - a_mm[0], b_mm[1] - a_mm[1]
    plano = abs(dx * ux + dy * uy) + abs(dx * vx + dy * vy)
    total_m = (plano + abs(zb_mm - za_mm)) / 1000
    r = criterios["longitud_ruta"]
    return total_m * (1 + r["reserva_pct"] / 100) + r["reserva_m"]
