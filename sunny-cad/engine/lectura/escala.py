"""Escala de una imagen superior: milímetros por píxel."""

from __future__ import annotations

import math
from typing import Any

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
