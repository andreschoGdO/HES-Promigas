"""Marco y cajetín de las láminas, desde templates/cajetin.json."""

from __future__ import annotations

import textwrap
from pathlib import Path
from typing import Any

from engine.planos.lamina import Lamina

MARGEN = 10  # mm


def area_dibujo(lamina: Lamina, plantilla: dict[str, Any]) -> tuple[float, float, float, float]:
    """(x, y, ancho, alto) libre para el dibujo, sobre el cajetín."""
    w, h = lamina.tamano
    y0 = MARGEN + plantilla["alto_mm"] + 8  # 8 mm para la leyenda de borrador
    return (MARGEN + 2, y0 + 2, w - 2 * MARGEN - 4, h - MARGEN - y0 - 4)


def dibujar(lamina: Lamina, plantilla: dict[str, Any], datos: dict[str, str], raiz: Path) -> None:
    w, h = lamina.tamano
    lamina.rect(MARGEN, MARGEN, w - 2 * MARGEN, h - 2 * MARGEN, "MARCO")
    alto = plantilla["alto_mm"]
    lamina.linea((MARGEN, MARGEN + alto), (w - MARGEN, MARGEN + alto), "CAJETIN")
    lamina.texto(
        (w / 2, MARGEN + alto + 4),
        plantilla["leyenda_borrador"],
        2.6,
        "EQUIPO",
        "centro",
        negrita=True,
    )
    lamina.linea((MARGEN, MARGEN + alto + 8), (w - MARGEN, MARGEN + alto + 8), "CAJETIN")

    x = MARGEN
    for col in plantilla["columnas"]:
        y_top = MARGEN + alto
        for nombre, fraccion in col["campos"]:
            hc = alto * fraccion
            y = y_top - hc
            lamina.rect(x, y, col["ancho"], hc, "CAJETIN")
            if nombre == "logo":
                _logo(lamina, plantilla, x, y, col["ancho"], hc, raiz)
            else:
                lamina.texto((x + 1.5, y_top - 3), nombre + ":", 1.8, "NOTA")
                valor = datos.get(nombre, "")
                ancho_chars = max(8, int(col["ancho"] / 1.55))
                grande = nombre == "PLANO"
                lineas = (
                    valor.split(" ")
                    if grande
                    else textwrap.wrap(valor, ancho_chars)[: max(1, int((hc - 5) / 3.3))]
                )
                for i, linea in enumerate(lineas):
                    if grande:
                        lamina.texto(
                            (x + col["ancho"] / 2, y + hc / 2 + 3 - i * 7),
                            linea,
                            4.5 - i * 1.0,
                            "TEXTO",
                            "centro",
                            negrita=i == 0,
                        )
                    else:
                        lamina.texto((x + 1.5, y_top - 7 - i * 3.3), linea, 2.3, "TEXTO")
            y_top = y
        x += col["ancho"]


def _logo(lamina: Lamina, plantilla, x, y, w, h, raiz: Path) -> None:
    logo = plantilla.get("logo")
    if logo and (raiz / logo).is_file():
        lamina.imagen(raiz / logo, x + 2, y + 2, w - 4, h - 4)
    else:
        lamina.rect(x + 4, y + 8, w - 8, h - 16, "NOTA", trazo="discontinuo")
        lamina.texto((x + w / 2, y + h / 2), "LOGO", 4, "NOTA", "centro")
        lamina.texto((x + w / 2, y + 4), plantilla["empresa"], 2.2, "TEXTO", "centro", negrita=True)
