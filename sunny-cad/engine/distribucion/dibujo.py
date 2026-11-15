"""Planta de verificación de la distribución (PNG). No es el plano final (eso es el Paso 7)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from engine.distribucion.colocacion import huella_poligono

FUENTE = ImageFont.load_default(size=13)
FUENTE_TITULO = ImageFont.load_default(size=18)
MARGEN = 70


def generar(
    proyecto: dict[str, Any],
    biblioteca: dict[str, dict[str, Any]],
    salida: Path,
    ancho_px: int = 1400,
    titulo: str = "",
) -> Path:
    cubiertas = proyecto["vivienda"]["cubiertas"]
    zonas = {z["id"]: z for z in proyecto["vivienda"].get("zonas_instalacion", [])}
    xs = [p[0] for c in cubiertas for p in c["contorno_mm"]]
    ys = [p[1] for c in cubiertas for p in c["contorno_mm"]]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    k = (ancho_px - 2 * MARGEN) / max(x1 - x0, 1)
    alto_px = int((y1 - y0) * k) + 2 * MARGEN + 40

    def px(p):  # mm → píxel (norte arriba)
        return (MARGEN + (p[0] - x0) * k, alto_px - MARGEN - (p[1] - y0) * k)

    im = Image.new("RGB", (ancho_px, alto_px), "white")
    d = ImageDraw.Draw(im)
    for c in cubiertas:
        pts = [px(p) for p in c["contorno_mm"]]
        d.polygon(pts, fill=(236, 236, 230), outline=(90, 90, 90))
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        d.text((cx - 30, cy), c["id"], fill=(120, 120, 120), font=FUENTE)
    for z in zonas.values():
        pts = [px(p) for p in z["contorno_mm"]]
        color = (220, 120, 0) if z["es_supuesto"] else (0, 120, 220)
        d.line(pts + [pts[0]], fill=color, width=3)
        d.text(
            (min(q[0] for q in pts), min(q[1] for q in pts) - 18),
            z["id"] + (" (supuesto)" if z["es_supuesto"] else ""),
            fill=color,
            font=FUENTE,
        )
    for e in proyecto["equipos"]:
        col = e.get("colocacion")
        if not col:
            continue
        huella = huella_poligono(
            tuple(col["centro_mm"]), zonas[col["zona_ref"]], biblioteca[e["componente_ref"]]
        )
        d.polygon([px(p) for p in huella], fill=(28, 52, 110), outline=(200, 210, 230))
        cx, cy = px(col["centro_mm"])
        d.text((cx - 10, cy - 6), e["id"][-3:], fill="white", font=FUENTE)

    # Norte y escala gráfica de 5 m.
    d.line([(ancho_px - 40, 70), (ancho_px - 40, 30)], fill="black", width=3)
    d.text((ancho_px - 46, 10), "N", fill="black", font=FUENTE_TITULO)
    yb = alto_px - 30
    d.line([(MARGEN, yb), (MARGEN + 5000 * k, yb)], fill="black", width=4)
    d.text((MARGEN, yb - 20), "5 m", fill="black", font=FUENTE)
    if titulo:
        d.text((MARGEN, 15), titulo, fill="black", font=FUENTE_TITULO)
    salida.parent.mkdir(parents=True, exist_ok=True)
    im.save(salida)
    return salida
