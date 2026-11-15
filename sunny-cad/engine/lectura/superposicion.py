"""Imagen de verificación: el trazado dibujado sobre la imagen original, con las medidas.

Sirve para que el usuario confirme el trazado antes de aplicarlo al proyecto. Se guarda en
``privado/`` porque contiene la imagen satelital de la vivienda.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from engine.lectura.escala import mm_por_pixel

COLOR_CUBIERTA = (255, 196, 0)
COLOR_OBSTACULO = (230, 40, 40)
COLOR_ESCALA = (0, 200, 255)
FUENTE = ImageFont.load_default(size=15)
FUENTE_GRANDE = ImageFont.load_default(size=20)


def _texto(dibujo, xy, texto: str, color, fuente=FUENTE) -> None:
    dibujo.text(xy, texto, fill=color, font=fuente, stroke_width=3, stroke_fill=(0, 0, 0))


def _poligono(dibujo: ImageDraw.ImageDraw, puntos: list[list[float]], color, ancho: int) -> None:
    pts = [tuple(p) for p in puntos]
    dibujo.line(pts + [pts[0]], fill=color, width=ancho)


def _cotas(dibujo, puntos: list[list[float]], escala_mm_px: float, color) -> None:
    n = len(puntos)
    for i in range(n):
        (x1, y1), (x2, y2) = puntos[i], puntos[(i + 1) % n]
        metros = math.dist((x1, y1), (x2, y2)) * escala_mm_px / 1000
        texto = f"{metros:.2f} m"
        _texto(dibujo, ((x1 + x2) / 2 + 4, (y1 + y2) / 2 - 8), texto, color)


def generar(lectura: dict[str, Any], imagen: Path, salida: Path, ampliacion: int = 2) -> Path:
    s = mm_por_pixel(lectura["escala"])
    with Image.open(imagen) as original:
        base = original.convert("RGB")
    base = base.resize((base.width * ampliacion, base.height * ampliacion), Image.LANCZOS)
    dibujo = ImageDraw.Draw(base)
    k = ampliacion

    def esc(puntos):
        return [[x * k, y * k] for x, y in puntos]

    s_img = s / k
    for c in lectura["cubiertas"]:
        pts = esc(c["contorno_px"])
        _poligono(dibujo, pts, COLOR_CUBIERTA, 2)
        _cotas(dibujo, pts, s_img, COLOR_CUBIERTA)
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        _texto(dibujo, (cx - 40, cy), c["id"], COLOR_CUBIERTA, FUENTE_GRANDE)
        for o in c["obstaculos"]:
            _poligono(dibujo, esc(o["contorno_px"]), COLOR_OBSTACULO, 2)
            ox, oy = esc(o["contorno_px"])[0]
            _texto(dibujo, (ox + 2, oy + 2), o["id"], COLOR_OBSTACULO)

    e = lectura["escala"]
    if e["metodo"] == "poligono_medido":
        _poligono(dibujo, esc(e["contorno_px"]), COLOR_ESCALA, 1)
    if "p1_px" in e:
        p1, p2 = esc([e["p1_px"]])[0], esc([e["p2_px"]])[0]
        dibujo.line([tuple(p1), tuple(p2)], fill=COLOR_ESCALA, width=3)
        _texto(dibujo, (p1[0], p1[1] - 20), f"escala {e['longitud_m']} m", COLOR_ESCALA)

    # Flecha de norte en la esquina superior derecha.
    r = math.radians(lectura["imagen"]["rotacion_norte_deg"])
    cx, cy, largo = base.width - 40, 60, 36
    punta = (cx + largo * math.sin(r), cy - largo * math.cos(r))
    dibujo.line([(cx, cy), punta], fill=(255, 255, 255), width=3)
    _texto(dibujo, (punta[0] - 6, punta[1] - 26), "N", (255, 255, 255), FUENTE_GRANDE)
    _texto(dibujo, (8, 8), f"Escala: {s:.1f} mm/px  ({e['metodo']})", (255, 255, 255))

    salida.parent.mkdir(parents=True, exist_ok=True)
    base.save(salida)
    return salida
