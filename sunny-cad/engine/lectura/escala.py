"""Escala de una imagen superior: milímetros por píxel."""

from __future__ import annotations

import math
from typing import Any

from shapely.geometry import Polygon

TOLERANCIA_PERIMETRO = 0.02  # 2 %: diferencia admitida entre el perímetro medido y el calculado

# Circunferencia ecuatorial WGS84 / 256 px por tesela: metros por píxel en el ecuador con zoom 0.
METROS_POR_PIXEL_ZOOM0 = 2 * math.pi * 6_378_137 / 256  # 156 543,03 m/px


def mm_por_pixel(escala: dict[str, Any]) -> float:
    """Milímetros reales que representa un píxel de la imagen."""
    if escala["metodo"] in ("barra_escala", "medida_conocida"):
        (x1, y1), (x2, y2) = escala["p1_px"], escala["p2_px"]
        distancia_px = math.hypot(x2 - x1, y2 - y1)
        if distancia_px == 0:
            raise ValueError("los dos puntos de la escala coinciden")
        return escala["longitud_m"] * 1000 / distancia_px
    if escala["metodo"] == "poligono_medido":
        area_px = Polygon(escala["contorno_px"]).area
        if area_px <= 0:
            raise ValueError("el polígono medido no tiene área")
        return math.sqrt(escala["area_m2"] / area_px) * 1000
    if escala["metodo"] == "web_mercator":
        m_px = (
            METROS_POR_PIXEL_ZOOM0
            * math.cos(math.radians(escala["latitud_deg"]))
            / 2 ** escala["zoom"]
            / escala["escala_pantalla"]
        )
        return m_px * 1000
    raise ValueError(f"método de escala desconocido: {escala['metodo']}")


def error_mm_por_pixeles(escala_mm_px: float, pixeles: float = 3) -> float:
    """Error de posición equivalente a marcar un punto con `pixeles` de desvío."""
    return escala_mm_px * pixeles


def avisos_escala(escala: dict[str, Any]) -> list[str]:
    """Comprobaciones de la escala. Con 'poligono_medido', el perímetro debe coincidir."""
    if escala["metodo"] != "poligono_medido" or "perimetro_m" not in escala:
        return []
    poligono = Polygon(escala["contorno_px"])
    if not poligono.is_valid:
        return ["escala: el polígono medido se cruza a sí mismo"]
    calculado = poligono.length * mm_por_pixel(escala) / 1000
    diferencia = (calculado - escala["perimetro_m"]) / escala["perimetro_m"]
    if abs(diferencia) > TOLERANCIA_PERIMETRO:
        return [
            f"escala: el perímetro calculado ({calculado:.2f} m) difiere {diferencia:+.1%} del "
            f"medido en Maps ({escala['perimetro_m']} m); revisar los vértices"
        ]
    return []


def resumen_escala(escala: dict[str, Any]) -> str:
    s = mm_por_pixel(escala)
    texto = f"{s:.1f} mm/px ({escala['metodo']})"
    if escala["metodo"] == "poligono_medido" and "perimetro_m" in escala:
        calculado = Polygon(escala["contorno_px"]).length * s / 1000
        texto += f"; perímetro calculado {calculado:.2f} m vs medido {escala['perimetro_m']} m"
    return texto
