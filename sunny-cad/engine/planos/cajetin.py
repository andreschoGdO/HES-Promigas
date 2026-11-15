"""Marco y cajetín de las láminas (formato Promigas), desde templates/cajetin.json.

Disposición tomada del plano de referencia PRO-ELE-SPEC-DIS-001: marco con zonas (8…1, F…A),
tabla de revisiones arriba a la derecha y franja inferior con lista de materiales, nota de
confidencialidad, notas, datos de dibujo y bloque del logo con proyecto, contenido, tamaño,
código del plano, revisión, escala, unidad y hoja.
"""

from __future__ import annotations

import textwrap
from pathlib import Path
from typing import Any

from engine.planos.lamina import Lamina

BORDE = 4  # marco exterior
MARGEN = 10  # marco interior (las zonas van en la banda entre ambos)


def area_dibujo(lamina: Lamina, plantilla: dict[str, Any]) -> tuple[float, float, float, float]:
    """(x, y, ancho, alto) libre para el dibujo: sobre la franja y bajo la tabla de revisiones."""
    w, h = lamina.tamano
    f = plantilla["franja_mm"]
    rev = plantilla["revisiones_mm"]
    y0 = MARGEN + f["alto"] + (7 if plantilla.get("leyenda_borrador") else 0)  # leyenda opcional
    top = h - MARGEN - rev["fila"] * 5 - 2
    return (MARGEN + 2, y0 + 2, w - 2 * MARGEN - 4, top - y0 - 4)


def _envolver(
    lam, x, y_top, texto, ancho_mm, altura=1.9, interlinea=2.9, max_lineas=20, capa="TEXTO"
):
    chars = max(10, int(ancho_mm / (altura * 0.86)))
    y = y_top
    for parrafo in str(texto).split("\n"):
        for linea in textwrap.wrap(parrafo, chars)[:max_lineas] or [""]:
            lam.texto((x, y), linea, altura, capa)
            y -= interlinea
    return y


def _zonas(lam: Lamina, plantilla) -> None:
    w, h = lam.tamano
    lam.rect(BORDE, BORDE, w - 2 * BORDE, h - 2 * BORDE, "CAJETIN")
    lam.rect(MARGEN, MARGEN, w - 2 * MARGEN, h - 2 * MARGEN, "MARCO")
    ncol = plantilla["zonas"]["columnas"]
    filas = plantilla["zonas"]["filas"]
    paso_x = (w - 2 * MARGEN) / ncol
    for i in range(ncol):
        x = MARGEN + i * paso_x
        for y_banda in ((BORDE + MARGEN) / 2, h - (BORDE + MARGEN) / 2):
            lam.texto((x + paso_x / 2, y_banda), str(ncol - i), 2.6, "TEXTO", "centro")
        if i:
            lam.linea((x, BORDE), (x, MARGEN), "CAJETIN")
            lam.linea((x, h - MARGEN), (x, h - BORDE), "CAJETIN")
    paso_y = (h - 2 * MARGEN) / len(filas)
    for j, letra in enumerate(filas):
        y = h - MARGEN - (j + 0.5) * paso_y
        for x_banda in ((BORDE + MARGEN) / 2, w - (BORDE + MARGEN) / 2):
            lam.texto((x_banda, y), letra, 2.6, "TEXTO", "centro")
        if j:
            yy = h - MARGEN - j * paso_y
            lam.linea((BORDE, yy), (MARGEN, yy), "CAJETIN")
            lam.linea((w - MARGEN, yy), (w - BORDE, yy), "CAJETIN")


def _revisiones(lam: Lamina, plantilla, revisiones: list[dict[str, str]]) -> None:
    w, h = lam.tamano
    r = plantilla["revisiones_mm"]
    x0, ancho, fila = w - MARGEN - r["ancho"], r["ancho"], r["fila"]
    cols = [
        ("ZONA", 0.07),
        ("REV", 0.06),
        ("DESCRIPCIÓN", 0.42),
        ("FECHA DE REV.", 0.15),
        ("REVISADO POR", 0.15),
        ("APROBADO POR", 0.15),
    ]
    y_top = h - MARGEN
    lam.rect(x0, y_top - fila, ancho, fila, "CAJETIN")
    lam.texto((x0 + ancho / 2, y_top - fila / 2), "REVISIONES", 2.0, "TEXTO", "centro")
    filas = [{c: c for c, _ in cols}] + [
        {
            "ZONA": rv.get("zona", ""),
            "REV": rv["revision"],
            "DESCRIPCIÓN": rv["descripcion"],
            "FECHA DE REV.": rv["fecha"],
            "REVISADO POR": rv.get("revisado", ""),
            "APROBADO POR": rv.get("aprobado", ""),
        }
        for rv in revisiones[-3:]
    ]
    for k, datos in enumerate(filas):
        y = y_top - fila * (k + 2)
        x = x0
        for c, frac in cols:
            cw = ancho * frac
            lam.rect(x, y, cw, fila, "CAJETIN")
            lam.texto(
                (x + cw / 2, y + fila / 2),
                str(datos.get(c, ""))[: int(cw / 1.05)],
                1.6 if k else 1.7,
                "TEXTO" if k else "NOTA",
                "centro",
            )
            x += cw


def dibujar(lam: Lamina, plantilla: dict[str, Any], datos: dict[str, Any], raiz: Path) -> None:
    w, _ = lam.tamano
    _zonas(lam, plantilla)
    _revisiones(lam, plantilla, datos["revisiones"])
    f = plantilla["franja_mm"]
    alto = f["alto"]
    y0 = MARGEN
    lam.linea((MARGEN, y0 + alto), (w - MARGEN, y0 + alto), "MARCO")
    if plantilla.get("leyenda_borrador"):
        lam.texto(
            (w / 2, y0 + alto + 3.2),
            plantilla["leyenda_borrador"],
            2.4,
            "EQUIPO",
            "centro",
            negrita=True,
        )
        lam.linea((MARGEN, y0 + alto + 6.5), (w - MARGEN, y0 + alto + 6.5), "CAJETIN")

    # 1. Lista de materiales (como en el plano de referencia: encabezado abajo, filas hacia arriba)
    x = MARGEN
    fila = 4.2
    anchos = [0.08, 0.5, 0.1, 0.12, 0.2]
    lam.rect(x, y0, f["materiales"], alto, "CAJETIN")
    lam.texto((x + f["materiales"] / 2, y0 + 2.5), "LISTA DE MATERIALES", 1.9, "TEXTO", "centro")
    lam.linea((x, y0 + 5), (x + f["materiales"], y0 + 5), "CAJETIN")
    capacidad = int((alto - 5) / fila) - 1
    materiales = datos["materiales"][:capacidad]
    filas = [["ITEM", "DESCRIPCIÓN", "CANT", "UNIDAD", "MATERIAL"]] + [
        [m["item"], m["descripcion"], m["cantidad"], m["unidad"], m["material"]] for m in materiales
    ]
    for k, valores in enumerate(filas):
        yy = y0 + 5 + k * fila
        xx = x
        for frac, v in zip(anchos, valores, strict=True):
            cw = f["materiales"] * frac
            lam.rect(xx, yy, cw, fila, "CAJETIN")
            texto = str(v)[: int((cw - 1) / (1.45 * 0.86))]
            lam.texto(
                (xx + 0.8, yy + fila / 2),
                texto,
                1.45 if k else 1.55,
                "TEXTO" if k else "NOTA",
                "izq_medio",
            )
            xx += cw
    x += f["materiales"]

    # 2. Nota de confidencialidad
    lam.rect(x, y0, f["confidencialidad"], alto, "CAJETIN")
    _envolver(
        lam,
        x + 3,
        y0 + alto - 11,
        plantilla["confidencialidad"],
        f["confidencialidad"] - 6,
        1.75,
        2.7,
    )
    x += f["confidencialidad"]

    # 3. Notas
    lam.rect(x, y0, f["notas"], alto, "CAJETIN")
    lam.texto((x + 1.5, y0 + alto - 3), "NOTAS:", 1.8, "NOTA")
    yy = y0 + alto - 6.5
    for i, nota in enumerate(datos["notas"], 1):
        if yy < y0 + 3:
            break
        yy = _envolver(lam, x + 2, yy, f"{i}. {nota}", f["notas"] - 4, 1.55, 2.3, 4) - 0.6
    x += f["notas"]

    # 4. Datos de dibujo
    campos = [
        ("DIBUJADO POR:", datos["dibujado_por"]),
        ("DISEÑADO POR:", datos["disenado_por"]),
        ("LOCALIZACIÓN:", datos["localizacion"]),
        ("NOMBRE DEL ARCHIVO MAGNÉTICO:", datos["archivo"]),
        ("DIMENSIONAMIENTO Y TOLERANCIA:", datos["tolerancia"]),
    ]
    hc = alto / len(campos)
    for k, (et, v) in enumerate(campos):
        yy = y0 + alto - (k + 1) * hc
        lam.rect(x, yy, f["datos"], hc, "CAJETIN")
        lam.texto((x + 1, yy + hc - 2.4), et, 1.3, "NOTA")
        alto_txt = 1.45 if len(str(v)) <= (f["datos"] - 2) / (1.45 * 0.86) else 1.15
        lam.texto(
            (x + 1, yy + 1.2),
            str(v)[: int((f["datos"] - 2) / (alto_txt * 0.86))],
            alto_txt,
            "TEXTO",
        )
    x += f["datos"]

    # 5. Bloque del logo: logo, proyecto, contenido, tamaño / código / rev, escala / unidad / hoja
    lw = f["logo"]
    h_logo = alto * 0.34
    lam.rect(x, y0 + alto - h_logo, lw, h_logo, "CAJETIN")
    logo = plantilla.get("logo")
    if logo and (raiz / logo).is_file():
        alto_img = h_logo - 2
        ancho_img = alto_img * 409 / 210
        lam.imagen(
            raiz / logo, x + (lw - ancho_img) / 2, y0 + alto - h_logo + 1, ancho_img, alto_img
        )
    else:
        lam.texto(
            (x + lw / 2, y0 + alto - h_logo / 2),
            plantilla["empresa"],
            4,
            "TEXTO",
            "centro",
            negrita=True,
        )
    h_pc = alto * 0.36
    for k, (et, v) in enumerate(
        (("PROYECTO:", datos["proyecto"]), ("CONTENIDO:", datos["contenido"]))
    ):
        yy = y0 + alto - h_logo - (k + 1) * h_pc / 2
        lam.rect(x, yy, lw, h_pc / 2, "CAJETIN")
        lam.texto((x + 1, yy + h_pc / 4), et, 1.35, "NOTA", "izq_medio")
        _envolver(lam, x + 14, yy + h_pc / 2 - 2.4, v, lw - 15, 1.55, 2.2, 2)
    h_rest = alto - h_logo - h_pc
    yy = y0 + h_rest / 2
    xx = x
    for et, v, frac in (
        ("TAMAÑO:", datos["tamano"], 0.16),
        ("CÓDIGO PLANO:", datos["codigo"], 0.7),
        ("REV.", datos["rev"], 0.14),
    ):
        cw = lw * frac
        lam.rect(xx, yy, cw, h_rest / 2, "CAJETIN")
        lam.texto((xx + 1, yy + h_rest / 2 - 2.0), et, 1.3, "NOTA")
        lam.texto((xx + 1.2, yy + 0.9), v, 1.75, "TEXTO", negrita=et == "CÓDIGO PLANO:")
        xx += cw
    xx = x
    for et, v, frac in (
        ("ESCALA:", datos["escala"], 0.4),
        ("UNIDAD:", datos["unidad"], 0.3),
        ("HOJA:", datos["hoja"], 0.3),
    ):
        cw = lw * frac
        lam.rect(xx, y0, cw, h_rest / 2, "CAJETIN")
        lam.texto((xx + 1, y0 + h_rest / 4), et, 1.3, "NOTA", "izq_medio")
        lam.texto((xx + cw - 1.2, y0 + h_rest / 4 - 0.8), v, 1.7, "TEXTO", "der")
        xx += cw
