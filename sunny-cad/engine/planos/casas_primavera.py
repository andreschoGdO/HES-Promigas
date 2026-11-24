"""Planos de obra de las casas de Prado Verde Primavera (cajetín Promigas, A3).

Hojas por casa:
1. Localización y distribución de módulos, con el detalle de la estructura lastrada.
2. Ruta de cableado DC y su detalle.
3. Ubicación de equipos, ruta AC y detalle hasta el punto de conexión.

La geometría de la vivienda sale del plano tipo del usuario (PL-EL-DM-FV-PRADO_VERDE_PRIMAVERA-
CASA60, lote pequeño; casa 18 para lote grande), calibrado con las medidas del módulo (2278 × 1134
mm) y puesto en espejo según el lado de la manzana. Los módulos van hacia el sur en estructura
lastrada a 10° (usuario). Supuestos marcados en `SUPUESTOS`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

from shapely import affinity
from shapely.geometry import Point, Polygon, box

from engine import validar
from engine.planos import cajetin
from engine.planos.lamina import Lamina, a_pdf
from engine.planos.unifilar_casas import (
    SALIDA,
    _disenador,
    _f,
    _slug,
    codigo_plano,
    datos_cajetin,
    datos_casa,
)
from engine.simulacion import pvsyst

INSUMOS = SALIDA / "insumos"
S = 7.4  # mm por píxel del plano tipo de la casa 60 (calibrado con el módulo)

SUPUESTOS = [
    "Geometría de la vivienda tomada del plano tipo de la casa 60 (lote pequeño), en espejo "
    "según el lado de la manzana.",
    "Norte del mapa del conjunto girado 10° (comparado con la vista satelital de los planos "
    "tipo): por confirmar.",
]

# Plano tipo casa 60 (lote pequeño), en píxeles del plano de referencia (x a la derecha, y abajo).
_C60 = {
    "lote": [(15, 65), (1760, 92), (1760, 480), (1862, 485), (1952, 975), (485, 935), (15, 935)],
    "cubierta": [(497, 338), (660, 338), (1862, 485), (1952, 975), (485, 935)],
    "cubierta_alta": [(740, 72), (1760, 92), (1760, 470), (740, 350)],
    "balcon": [(497, 70), (740, 70), (740, 338), (497, 338)],
    "patio": [(15, 65), (485, 65), (485, 935), (15, 935)],
    "tanque": ((1012, 276), 77),
    "aa": [((692, 788), (795, 832)), ((1533, 797), (1636, 841)), ((1762, 880), (1865, 925))],
    "baterias": ((500, 70), (615, 97)),
    "inversor": ((637, 70), (690, 110)),
    "tablero": ((698, 135), (737, 187)),
    "bajante_dc": (630, 338),  # llegada de la coraza DC al balcón
    "bajante_ac": (497, 338),  # esquina del balcón: bajante por fachada al 1° piso
}

# Casas de Primavera: manzana, lado (espejo si el frente da a la izquierda del mapa), tipo de lote
# y posición en la foto del mapa del conjunto (píxeles de primavera_mapa.png).
CASAS = {
    "434": {"manzana": "A", "espejo": True, "lote": "pequeno", "mapa": (78, 238)},
}
ROT_MAPA_DEG = -10.0  # el "arriba" del mapa apunta al azimut 10° (supuesto)


# ------------------------------------------------------------------------------- geometría
def _a_mm(p, espejo: bool) -> tuple[float, float]:
    x, y = p
    largo = 1952 * S
    u = x * S
    return ((largo - u) if espejo else u, -y * S)


def geometria(casa: str) -> dict[str, Any]:
    """Polígonos de la vivienda en mm, en un marco con el norte arriba."""
    info = CASAS[casa]
    e = info["espejo"]

    def pol(pts):
        p = Polygon([_a_mm(q, e) for q in pts])
        return affinity.rotate(p, ROT_MAPA_DEG, origin=(0, 0))

    def pt(q):
        x, y = _a_mm(q, e)
        r = math.radians(ROT_MAPA_DEG)
        return (x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r))

    def rect(a, b):
        return pol([a, (b[0], a[1]), b, (a[0], b[1])])

    g = {k: pol(_C60[k]) for k in ("lote", "cubierta", "cubierta_alta", "balcon", "patio")}
    c, r = _C60["tanque"]
    g["tanque"] = Point(pt(c)).buffer(r * S)
    g["aa"] = [rect(a, b) for a, b in _C60["aa"]]
    for k in ("baterias", "inversor", "tablero"):
        g[k] = rect(*_C60[k])
    g["bajante_dc"] = pt(_C60["bajante_dc"])
    g["bajante_ac"] = pt(_C60["bajante_ac"])
    return g


def colocar_modulos(cubierta: Polygon, obstaculos, n: int, retiro=400.0, sep=5.0):
    """Módulos verticales hacia el sur (filas este-oeste), estructura lastrada a 10°.

    Huella por módulo: 1134 (E-O) × 2278·cos10° (N-S). Se busca la fila (y la posición en ella)
    que aloja los n módulos lejos de los obstáculos; si no caben en una, dos filas a 3665 mm.
    """
    w, d = 1134.0, 2278.0 * math.cos(math.radians(10))
    util = cubierta.buffer(-retiro)
    for o in obstaculos:
        util = util.difference(o.buffer(300))
    minx, miny, maxx, maxy = util.bounds
    mejor = None
    for filas in (1, 2):
        por_fila = [n - n // 2, n // 2] if filas == 2 else [n]
        y = miny
        while y + d + (filas - 1) * 3665 <= maxy:
            x = minx
            while x + w * max(por_fila) <= maxx:
                mods = []
                for f, k in enumerate(por_fila):
                    for i in range(k):
                        mods.append(
                            box(
                                x + i * (w + sep),
                                y + f * 3665,
                                x + i * (w + sep) + w,
                                y + f * 3665 + d,
                            )
                        )
                if all(util.contains(m) for m in mods):
                    c = cubierta.centroid
                    costo = sum(m.centroid.distance(c) for m in mods)
                    if mejor is None or costo < mejor[0]:
                        mejor = (costo, mods)
                x += 50
            y += 50
        if mejor:
            return mejor[1]
    raise ValueError(f"no caben {n} módulos en la cubierta")


# ------------------------------------------------------------------------------- dibujo
class Marco:
    """mm del modelo → mm de papel (escala 1:N), centrado en un área."""

    def __init__(self, geom: Polygon, area, n_opciones=(50, 75, 100, 125, 150)):
        x0, y0, w, h = area
        minx, miny, maxx, maxy = geom.bounds
        self.n = next(
            n for n in n_opciones if (maxx - minx) / n <= w - 6 and (maxy - miny) / n <= h - 6
        )
        self.k = 1 / self.n
        self.cx, self.cy = (minx + maxx) / 2, (miny + maxy) / 2
        self.px, self.py = x0 + w / 2, y0 + h / 2

    def __call__(self, p):
        if hasattr(p, "x"):
            p = (p.x, p.y)
        return (self.px + (p[0] - self.cx) * self.k, self.py + (p[1] - self.cy) * self.k)

    def pol(self, lam, g, capa="CUBIERTA", relleno=None, trazo="continuo"):
        pts = [self(p) for p in list(g.exterior.coords)[:-1]]
        lam.polilinea(pts, capa, cerrada=True, relleno=relleno, trazo=trazo)


def _casa_base(lam, m: Marco, g, rotulos=True) -> None:
    m.pol(lam, g["lote"], "CUBIERTA", "#f4f1ea")
    m.pol(lam, g["patio"], "NOTA", "#eef5e8")
    m.pol(lam, g["cubierta_alta"], "CUBIERTA", "#e7e3dc")
    m.pol(lam, g["cubierta"], "CUBIERTA", "#ecebe6")
    m.pol(lam, g["balcon"], "CUBIERTA", "#f7efe2")
    m.pol(lam, g["tanque"], "NOTA")
    for a in g["aa"]:
        m.pol(lam, a, "NOTA", "#ffffff")
    if rotulos:
        for k, t in (("patio", "PATIO"), ("balcon", "BALCÓN 2° PISO"), ("cubierta", "CUBIERTA")):
            c = g[k].centroid
            if k == "cubierta" and g.get("_modulos"):
                libre = g[k].buffer(-600)
                for md in g["_modulos"]:
                    libre = libre.difference(md.buffer(500))
                c = libre.representative_point() if not libre.is_empty else c
            lam.texto(m((c.x, c.y)), t, 2.0 if k != "balcon" else 1.4, "NOTA", "centro")
        c = g["tanque"].centroid
        lam.texto(m((c.x, c.y)), "TANQUE AGUA", 1.1, "NOTA", "centro")
        for a in g["aa"]:
            lam.texto(m((a.centroid.x, a.centroid.y)), "AA", 1.0, "NOTA", "centro")


def _norte(lam, x, y) -> None:
    lam.polilinea(
        [(x, y), (x + 2.5, y - 7), (x, y - 5), (x - 2.5, y - 7)], "TEXTO", True, "#000000"
    )
    lam.texto((x, y + 2.5), "N", 3, "TEXTO", "centro", negrita=True)


def _escala(lam, x, y, n) -> None:
    paso = 1000 / n
    for i in range(4):
        lam.rect(x + i * paso, y, paso, 1.2, "TEXTO", relleno="#000000" if i % 2 == 0 else None)
    lam.texto((x, y + 2.5), "0", 1.6)
    lam.texto((x + 4 * paso, y + 2.5), "4 m", 1.6, alinear="der")
    lam.texto((x + 4 * paso + 3, y), f"ESCALA 1:{n}", 1.9)


def _titulo_vista(lam, x, y, num, texto, escala="") -> None:
    lam.circulo((x + 3, y), 3, "TEXTO")
    lam.texto((x + 3, y), str(num), 2.4, "TEXTO", "centro", negrita=True)
    lam.texto((x + 8, y + 0.6), texto, 2.2, "TEXTO", negrita=True)
    lam.linea((x + 8, y - 0.8), (x + 8 + len(texto) * 1.55, y - 0.8), "TEXTO")
    if escala:
        lam.texto((x + 8, y - 3.3), escala, 1.6, "NOTA")


def _modulos(lam, m: Marco, mods, etiquetas=True) -> None:
    for i, md in enumerate(mods, 1):
        m.pol(lam, md, "MODULO", "#b4e8b0")
        if etiquetas:
            c = md.centroid
            lam.texto(m((c.x, c.y + 250)), f"1.1.1.{i}", 1.5, "TEXTO", "centro", negrita=True)
            lam.texto(m((c.x, c.y - 450)), "595 Wp", 1.1, "TEXTO", "centro")


def _equipos(lam, m: Marco, g) -> None:
    m.pol(lam, g["baterias"], "EQUIPO", "#d873d8")
    m.pol(lam, g["inversor"], "AC", "#bfe3f7")
    m.pol(lam, g["tablero"], "EQUIPO", "#4a4a4a")


def _caja_texto(lam, p, lineas, capa="TEXTO", h=1.3, anchura=None, alinear="izq") -> None:
    ancho = anchura or max(len(t) for t in lineas) * h * 0.74 + 2.5
    alto = len(lineas) * (h + 0.7) + 1.2
    x = p[0] - (ancho if alinear == "der" else 0)
    lam.rect(x, p[1] - alto, ancho, alto, "CAJETIN", relleno="#ffffff")
    for i, t in enumerate(lineas):
        lam.texto((x + 1, p[1] - 1.2 - (i + 0.5) * (h + 0.7)), t, h, capa, "izq_medio")


def _guia(lam, a, b) -> None:
    lam.linea(a, b, "NOTA")
    lam.circulo(a, 0.5, "NOTA", relleno="#555555")


# ------------------------------------------------------------------------------- detalles
def detalle_estructura(lam, x, y, n_mod: int) -> None:
    """Estructura lastrada (detalle del usuario): cortes lateral, trasero y frontal."""
    k = 1 / 40
    # Corte lateral (10°, bloques de concreto, 3665)
    t = math.radians(10)
    x0, y0 = x + 4, y + 8
    a = (x0 + 18, y0 + 6)
    b = (a[0] + 2278 * math.cos(t) * k, a[1] + 2278 * math.sin(t) * k)
    lam.linea(a, b, "MODULO")
    lam.linea((a[0], a[1] - 0.6), (b[0], b[1] - 0.6), "MODULO")
    for bx in (x0 + 15, x0 + 15 + 3665 * k - 6):
        lam.rect(bx, y0, 7, 4, "CUBIERTA", relleno="#cfcfcf")
    lam.linea(a, (a[0], y0 + 4), "ESTRUCTURA")
    lam.linea(b, (b[0], y0 + 4), "ESTRUCTURA")
    lam.linea((x0 + 10, y0), (x0 + 15 + 3665 * k + 6, y0), "CUBIERTA")
    lam.linea((x0 + 15, y0 - 4), (x0 + 15 + 3665 * k + 1, y0 - 4), "COTA")
    lam.texto((x0 + 15 + 3665 * k / 2, y0 - 3.3), "3665", 1.5, "COTA", "centro")
    lam.texto(
        ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 2.5), "2278", 1.5, "COTA", "centro", rotacion=10
    )
    lam.texto((a[0] + 8, a[1] + 0.2), "10°", 1.5, "COTA")
    lam.texto((x0 + 12, y0 - 8), "Corte lateral", 1.9, "TEXTO", negrita=True)
    lam.texto((x0 + 47, y0 + 2), "BLOQUE DE CONCRETO", 1.1, "NOTA")
    lam.texto((b[0] - 6, b[1] + 3), "MÓDULO FV", 1.1, "NOTA")
    # Corte trasero (2278 de ancho, rieles a 1244, 542 a cada lado, 412 de alto)
    x1 = x + 80
    lam.rect(x1, y0 + 412 * k, 2278 * k, 1.0, "MODULO", relleno="#b4e8b0")
    for xr in (542, 542 + 1244):
        lam.linea((x1 + xr * k, y0), (x1 + xr * k, y0 + 412 * k), "ESTRUCTURA")
        lam.rect(x1 + xr * k - 1.5, y0 - 1, 3, 1, "CUBIERTA", relleno="#cfcfcf")
    lam.linea((x1, y0 + 412 * k + 4), (x1 + 2278 * k, y0 + 412 * k + 4), "COTA")
    lam.texto((x1 + 2278 * k / 2, y0 + 412 * k + 5), "2278", 1.5, "COTA", "centro")
    for xa, xb, t_ in ((0, 542, "542"), (542, 1786, "1244"), (1786, 2278, "542")):
        lam.texto((x1 + (xa + xb) / 2 * k, y0 - 3.5), t_, 1.3, "COTA", "centro")
    lam.texto((x1 + 2278 * k + 2, y0 + 4), "412", 1.3, "COTA")
    lam.texto((x1 + 10, y0 - 8), "Corte trasero", 1.9, "TEXTO", negrita=True)
    # Corte frontal: n módulos de 1134 con 5 mm de separación
    x2 = x + 150
    largo = n_mod * 1134 + (n_mod - 1) * 5
    kk = min(1 / 70, 95 / largo)
    for i in range(n_mod):
        lam.rect(x2 + i * 1139 * kk, y0, 1134 * kk, 2278 * kk, "MODULO", relleno="#b4e8b0")
    lam.rect(x2 - 2, y0 - 1.2, largo * kk + 4, 1.2, "CUBIERTA", relleno="#cfcfcf")
    lam.linea((x2, y0 + 2278 * kk + 3), (x2 + largo * kk, y0 + 2278 * kk + 3), "COTA")
    lam.texto((x2 + largo * kk / 2, y0 + 2278 * kk + 4), f"{largo:.0f}", 1.5, "COTA", "centro")
    lam.texto((x2 - 3, y0 + 2278 * kk / 2), "2278", 1.5, "COTA", "centro", rotacion=90)
    lam.texto((x2 + 10, y0 - 8), "Corte frontal", 1.9, "TEXTO", negrita=True)


def detalle_equipos(lam, x, y, d, fam_txt) -> None:
    """Alzado del balcón (pared lateral y frontal) con inversor, tablero FV y baterías."""
    b = d["bat"]
    lam.rect(x, y, 110, 62, "CUBIERTA", relleno="#fbf6ee")
    lam.linea((x + 52, y), (x + 52, y + 62), "CUBIERTA", trazo="discontinuo")
    lam.texto((x + 26, y + 58), "PARED LATERAL DE BALCÓN", 1.4, "NOTA", "centro")
    lam.texto((x + 81, y + 58), "PARED FRONTAL DE BALCÓN", 1.4, "NOTA", "centro")
    # Inversor
    lam.rect(x + 18, y + 30, 18, 11, "AC", relleno="#e9eef3")
    lam.texto((x + 27, y + 43), "INVERSOR", 1.5, "TEXTO", "centro", negrita=True)
    lam.texto((x + 27, y + 35.5), d["inversor_modelo"], 1.1, "TEXTO", "centro")
    # Tablero FV (T.A)
    lam.rect(x + 60, y + 26, 11, 18, "EQUIPO", relleno="#e6e6e6")
    lam.texto((x + 65.5, y + 46), "T.A", 1.5, "TEXTO", "centro", negrita=True)
    lam.texto((x + 65.5, y + 35), "TABLERO FV", 1.0, "TEXTO", "centro")
    # Baterías en el piso
    lam.rect(x + 4, y + 2, 26, 16, "EQUIPO", relleno="#f6e0f6")
    lam.texto((x + 17, y + 13), "BATERÍAS", 1.8, "TEXTO", "centro", negrita=True)
    lam.texto((x + 17, y + 7.5), f"{b['n']} MÓDULOS · {_f(b['kwh'])} kWh", 1.2, "TEXTO", "centro")
    # Canalizaciones
    lam.linea((x + 24, y + 30), (x + 24, y + 18), "DC")
    lam.linea((x + 28, y + 30), (x + 28, y + 18), "COMUNIC", trazo="discontinuo")
    lam.linea((x + 36, y + 35), (x + 60, y + 35), "AC")
    lam.linea((x + 20, y + 41), (x + 20, y + 62), "DC")
    lam.linea((x + 65.5, y + 44), (x + 65.5, y + 50), "AC")
    lam.linea((x + 65.5, y + 50), (x + 100, y + 50), "AC")
    lam.linea((x + 100, y + 50), (x + 100, y), "AC")
    _caja_texto(
        lam,
        (x - 2, y + 62),
        ['Coraza 1"', "Viene de fachada", "Cable FV 2x4 mm² +", "1N° 8 AWG Cu"],
        alinear="der",
    )
    _guia(lam, (x + 20, y + 55), (x - 2, y + 58))
    _caja_texto(
        lam,
        (x + 38, y + 25),
        ["2 x [3N° 6 AWG (F) Cu", "1N° 6 AWG (N) Cu", "1N° 6 AWG (T) Cu - verde", 'Tubería 1½" ]'],
    )
    _guia(lam, (x + 48, y + 35), (x + 48, y + 25))
    _caja_texto(
        lam, (x + 32, y + 15), ['Coraza 1" cable de baterías', 'Coraza ¾" comunicaciones'], h=1.15
    )
    _guia(lam, (x + 26, y + 24), (x + 32, y + 13))
    _caja_texto(
        lam,
        (x + 112, y + 46),
        ["Hacia P.C. primer nivel", 'Tubería IMC, coraza o SCH40 2"'],
        h=1.15,
    )
    _guia(lam, (x + 100, y + 40), (x + 112, y + 43))
    lam.texto((x + 55, y - 4), fam_txt, 1.2, "NOTA", "centro")


def detalle_punto_conexion(lam, x, y) -> None:
    """Corte: bajante desde el balcón, pase en la cubierta del patio y tablero P.C. 1° piso."""
    lam.rect(x, y + 40, 70, 2.2, "CUBIERTA", relleno="#9fb8d6")
    lam.texto((x + 2, y + 44), "Cubierta existente del patio", 1.3, "NOTA")
    lam.rect(x + 40, y, 3, 40, "CUBIERTA", relleno="#bdbdbd")
    lam.polilinea(
        [(x + 46, y + 62), (x + 46, y + 45), (x + 30, y + 45), (x + 30, y + 30), (x + 30, y + 18)],
        "AC",
    )
    lam.circulo((x + 30, y + 41), 1.0, "ROJO", relleno="#c00000")
    lam.rect(x + 26, y + 6, 8, 12, "EQUIPO", relleno="#ffffff")
    for k in range(4):
        lam.linea((x + 28, y + 9 + k * 2), (x + 32, y + 9 + k * 2), "NOTA")
    lam.texto((x + 30, y + 3.5), "TABLERO P.C. · 1° PISO", 1.4, "TEXTO", "centro", negrita=True)
    _caja_texto(
        lam,
        (x + 50, y + 66),
        ["Viene del tablero FV (balcón)", 'Tubería IMC, coraza o SCH40 2"'],
        h=1.2,
    )
    _caja_texto(lam, (x + 52, y + 38), ["Pase en cubierta", "existente del patio"], h=1.2)
    _guia(lam, (x + 31, y + 41), (x + 52, y + 36))
    _caja_texto(
        lam,
        (x - 2, y + 34),
        ["Por la misma tubería va el", "alimentador hacia el tablero", "agrupador y el que regresa",
         "al tablero de distribución"],
        capa="ROJO", h=1.2, alinear="der",
    )  # fmt: skip


# ------------------------------------------------------------------------------- láminas
def _nueva(d, numero, tipo, titulo, fecha, disenador, total, plantilla) -> Lamina:
    lam = Lamina(numero, codigo_plano(d, tipo, numero), titulo, disciplina="ELE", tipo=tipo,
                 escala="INDICADA", unidad="m")  # fmt: skip
    return lam


def laminas(d: dict[str, Any], fecha: str, disenador: str = "") -> list[Lamina]:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "cajetin.json")
    g = geometria(str(d["casa"]))
    obst = [g["tanque"], *g["aa"]]
    mods = colocar_modulos(g["cubierta"], obst, d["modulos"])
    g["_modulos"] = mods
    info = CASAS[str(d["casa"])]
    conj = json.loads((INSUMOS / "primavera.json").read_text(encoding="utf-8"))
    b = d["bat"]
    fam_txt = f"Inversor {d['inversor_modelo']} · baterías {b['texto']} ({_f(b['kwh'])} kWh)"
    notas_base = [
        f"Sistema de {d['modulos']} módulos JA Solar JAM72D40 de 595 Wp ({_f(d['kwp'])} kWp) y un "
        f"inversor {d['inversor_modelo']}.",
        "Estructura lastrada con bloques de concreto, módulos hacia el sur a 10°.",
        "Medidas en metros salvo indicación. Geometría según plano tipo: verificar en obra.",
        *SUPUESTOS,
    ]
    out: list[Lamina] = []
    total = 3

    def cerrar(lam, notas):
        lam.notas = notas
        cajetin.dibujar(
            lam, plantilla,
            datos_cajetin(d, lam, fecha, disenador, f"{lam.numero}/{total}", plantilla),
            validar.RAIZ,
        )  # fmt: skip
        out.append(lam)

    titulo_casa = f"CASA {d['casa']} - PRADO VERDE PRIMAVERA (MANZANA {info['manzana']})"
    todo = g["lote"]

    # --- Hoja 1: localización y distribución de módulos ------------------------------------
    lam = _nueva(
        d, 1, "DIS", "Localización y distribución de módulos", fecha, disenador, total, plantilla
    )
    lam.texto((14, 258), f"DISTRIBUCIÓN DE MÓDULOS · {titulo_casa}", 3.0, "TEXTO", negrita=True)
    mapa = INSUMOS / "primavera_mapa.png"
    mx, my, mw, mh = 14, 120, 100, 132
    lam.imagen(mapa, mx, my, mw, mh)
    lam.rect(mx, my, mw, mh, "CAJETIN")
    px, py = info["mapa"]
    cx, cy = mx + px / 414 * mw, my + mh - py / 550 * mh
    lam.circulo((cx, cy), 3.2, "ROJO")
    lam.circulo((cx, cy), 0.8, "ROJO", relleno="#c00000")
    lam.texto((cx + 4, cy + 2), f"CASA {d['casa']}", 1.6, "ROJO", negrita=True)
    _titulo_vista(lam, mx, my - 6, 1, "Localización en el conjunto")
    lam.texto((mx + 8, my - 10.5), f"Conjunto: {conj['lat']:.5f}, {conj['lon']:.5f}", 1.5, "NOTA")
    m = Marco(todo, (122, 118, 200, 132))
    _casa_base(lam, m, g)
    _modulos(lam, m, mods)
    _equipos(lam, m, g)
    _norte(lam, 318, 248)
    _escala(lam, 124, 112, m.n)
    _titulo_vista(lam, 124, 106, 2, "Distribución de módulos", f"ESC 1:{m.n}")
    _resumen(lam, 330, 245, d, mods)
    detalle_estructura(lam, 120, 62, d["modulos"])
    _titulo_vista(lam, 124, 86, 3, "Detalle estructura lastrada", "ESC 1:40 (cotas en mm)")
    cerrar(lam, notas_base)

    # --- Hoja 2: ruta DC y detalle --------------------------------------------------------
    lam = _nueva(d, 2, "RDC", "Ruta de cableado DC y detalle", fecha, disenador, total, plantilla)
    lam.texto((14, 258), f"RUTA DE CABLEADO DC · {titulo_casa}", 3.0, "TEXTO", negrita=True)
    m = Marco(todo, (14, 100, 250, 150))
    _casa_base(lam, m, g)
    _modulos(lam, m, mods)
    _equipos(lam, m, g)
    # Conexión en serie (salto entre módulos) y ruta al inversor
    cs = [md.centroid for md in mods]
    for a_, b_ in zip(cs[:-1], cs[1:], strict=True):
        lam.linea(m((a_.x + 300, a_.y - 500)), m((b_.x - 300, b_.y - 500)), "CONTROL")
    lleg = g["bajante_dc"]
    inv = g["inversor"].centroid
    primero = min(cs, key=lambda c: Point(lleg).distance(c))
    ruta = [
        (primero.x, primero.y + 700),
        (primero.x, lleg[1] - 300),
        (lleg[0], lleg[1] - 300),
        lleg,
        (inv.x, inv.y),
    ]
    lam.polilinea([m(p) for p in ruta], "DC")
    lam.circulo(m(lleg), 0.8, "DC", relleno="#c0392b")
    _caja_texto(
        lam,
        (m(lleg)[0] + 30, m(lleg)[1] + 18),
        ['Coraza 1" por cubierta', "Cable FV 2x4 mm² (+/-)", "+ 1N° 8 AWG Cu verde"],
        h=1.2,
    )
    _guia(lam, m(ruta[2]), (m(lleg)[0] + 30, m(lleg)[1] + 15))
    _caja_texto(
        lam,
        (m(inv)[0] + 6, m(inv)[1] + 14),
        ["Bajante hacia balcón 2° piso", "Llega al inversor (DC)"],
        h=1.2,
    )
    _guia(lam, m(lleg), (m(inv)[0] + 6, m(inv)[1] + 11))
    _norte(lam, 258, 248)
    _escala(lam, 16, 94, m.n)
    _titulo_vista(lam, 16, 88, 1, "Ruta de cableado DC", f"ESC 1:{m.n}")
    _detalle_dc(lam, 272, 112, d)
    cerrar(
        lam,
        notas_base + ["Cable tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc para conductores DC."],
    )

    # --- Hoja 3: ubicación de equipos, ruta AC y punto de conexión -------------------------
    lam = _nueva(
        d,
        3,
        "RAC",
        "Ubicación de equipos, ruta AC y punto de conexión",
        fecha,
        disenador,
        total,
        plantilla,
    )
    lam.texto(
        (14, 258), f"UBICACIÓN DE EQUIPOS Y RUTA AC · {titulo_casa}", 3.0, "TEXTO", negrita=True
    )
    m = Marco(todo, (14, 128, 190, 122))
    _casa_base(lam, m, g)
    _modulos(lam, m, mods, etiquetas=False)
    _equipos(lam, m, g)
    tab = g["tablero"].centroid
    pc = g["bajante_ac"]
    lam.polilinea([m((tab.x, tab.y)), m((tab.x, pc[1])), m(pc)], "AC")
    lam.circulo(m(pc), 1.0, "ROJO", relleno="#c00000")
    for k, (geo, txt) in enumerate(
        (
            (
                g["baterias"],
                [
                    f"BATERÍAS {d['bat']['texto']}",
                    f"{d['bat']['n']} MÓD. - {_f(d['bat']['kwh'])} kWh",
                ],
            ),
            (g["inversor"], ["INVERSOR", d["inversor_modelo"]]),
            (g["tablero"], ["TABLERO FV", "15 KVA - 220 V - 60 HZ - IP65"]),
        )
    ):
        c = geo.centroid
        p = (m((c.x, c.y))[0] - 60 + k * 2, m((c.x, c.y))[1] + 12 - k * 9)
        _caja_texto(lam, p, txt, capa="EQUIPO", h=1.2)
        _guia(lam, m((c.x, c.y)), (p[0] + 30, p[1] - 3))
    _caja_texto(
        lam,
        (m(pc)[0] + 4, m(pc)[1] - 6),
        [
            "Bajante por fachada hacia 1° piso",
            'Tubería IMC, coraza o SCH40 2"',
            "→ Punto de conexión (P.C.)",
        ],
        h=1.2,
    )
    _norte(lam, 198, 248)
    _escala(lam, 16, 122, m.n)
    _titulo_vista(lam, 16, 116, 1, "Ubicación de equipos y ruta AC", f"ESC 1:{m.n}")
    detalle_equipos(lam, 232, 175, d, fam_txt)
    _titulo_vista(lam, 232, 248, 2, "Detalle ubicación de equipos (balcón 2° piso)", "SIN ESCALA")
    detalle_punto_conexion(lam, 300, 62)
    _titulo_vista(lam, 232, 150, 3, "Detalle hasta el punto de conexión", "SIN ESCALA")
    cerrar(lam, notas_base + [
        "El cable AC se dimensiona con base al alimentador existente en calibre 6 AWG.",
        "Interruptores del inversor: corriente máx. de salida AC × 1,25.",
    ])  # fmt: skip
    return out


def _resumen(lam, x, y, d, mods) -> None:
    filas = [
        ("Módulos", f"{len(mods)} × JAM72D40-595/MB"),
        ("Potencia DC", f"{_f(d['kwp'])} kWp"),
        ("Inversor", d["inversor_modelo"]),
        ("Strings", " + ".join(f"1 × {n} mód." for n in d["strings"])),
        ("Baterías", f"{d['bat']['n']} × {d['bat']['modulo']}"),
        ("Orientación", "Sur (180°), 10°"),
        ("Estructura", "Lastrada, bloques"),
    ]
    lam.rect(x, y - 4 - len(filas) * 3.6, 74, 4 + len(filas) * 3.6, "CAJETIN")
    lam.texto((x + 37, y - 2), "RESUMEN DEL SISTEMA", 1.7, "TEXTO", "centro", negrita=True)
    for i, (k, v) in enumerate(filas):
        yy = y - 6 - i * 3.6
        lam.texto((x + 2, yy), k, 1.4, "NOTA")
        lam.texto((x + 26, yy), v, 1.4, "TEXTO")


def _detalle_dc(lam, x, y, d) -> None:
    """Detalle DC: cadena de módulos en serie, coraza, bajante y llegada al inversor."""
    n = d["modulos"]
    lam.texto((x, y + 130), "DETALLE CABLEADO DC", 2.2, "TEXTO", negrita=True)
    w = min(16, 110 / n)
    for i in range(n):
        xi = x + i * (w + 2)
        lam.rect(xi, y + 105, w, 16, "MODULO", relleno="#b4e8b0")
        lam.texto((xi + w / 2, y + 113), f"1.1.1.{i + 1}", 1.1, "TEXTO", "centro")
        if i:
            lam.linea((xi - 2, y + 107), (xi, y + 107), "CONTROL")
    lam.linea((x, y + 107), (x - 4, y + 107), "DC")
    lam.linea((x - 4, y + 107), (x - 4, y + 70), "DC")
    xe = x + n * (w + 2) - 2
    lam.linea((xe, y + 107), (xe + 4, y + 107), "DC")
    lam.linea((xe + 4, y + 107), (xe + 4, y + 96), "DC")
    lam.linea((xe + 4, y + 96), (x - 2, y + 96), "DC")
    lam.linea((x - 2, y + 96), (x - 2, y + 70), "DC")
    lam.texto((x, y + 100), f"String S1.1.1: {n} módulos en serie (salto de rana)", 1.3, "TEXTO")
    lam.rect(x - 8, y + 50, 22, 20, "AC", relleno="#e9eef3")
    lam.texto((x + 3, y + 62), "INVERSOR", 1.5, "TEXTO", "centro", negrita=True)
    lam.texto((x + 3, y + 58), d["inversor_modelo"], 1.0, "TEXTO", "centro")
    lam.texto((x + 3, y + 54), "MPPT 1", 1.1, "TEXTO", "centro")
    _caja_texto(
        lam,
        (x + 20, y + 90),
        [
            'Coraza 1" adosada a cubierta y fachada',
            "Cable FV 2x4 mm² (+/-) + 1N° 8 AWG Cu verde",
            "Bajante hacia balcón 2° piso",
        ],
        h=1.2,
    )
    _caja_texto(
        lam,
        (x + 20, y + 70),
        [
            "Toda la estructura se equipotencializa",
            "con el cable de tierra indicado",
            "Marcación S1.1.1+ / S1.1.1-",
        ],
        h=1.2,
    )
    voc = max(d["voc_tmin"])
    filas = [
        ("Strings", "S1.1.1"),
        ("Módulos por string", str(n)),
        ("Voc a T mín.", f"{_f(voc, 1)} V"),
        ("Isc", f"{_f(d['isc'])} A"),
        ("Imp", f"{_f(d['imp'])} A"),
    ]
    lam.rect(x - 8, y + 2, 110, 4 + len(filas) * 3.6, "CAJETIN")
    lam.texto(
        (x + 47, y + 4 + len(filas) * 3.6), "CONFIGURACIÓN DC", 1.6, "TEXTO", "centro", negrita=True
    )
    for i, (k_, v) in enumerate(filas):
        yy = y + 3 + (len(filas) - i - 0.5) * 3.6
        lam.texto((x - 6, yy), k_, 1.3, "NOTA", "izq_medio")
        lam.texto((x + 40, yy), v, 1.3, "TEXTO", "izq_medio")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m engine.planos.casas_primavera")
    p.add_argument("excel", type=Path)
    p.add_argument("--casa", required=True)
    p.add_argument("--fecha", default=dt.date.today().isoformat())
    args = p.parse_args(argv)
    bib = validar.cargar_biblioteca()
    casas = pvsyst.leer_casas(args.excel)
    modulo = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, _ = pvsyst.plan(casas, modulo)
    sel = [
        (c, f) for c, f in zip(casas, filas, strict=True)
        if "PRIMAVERA" in _slug(c["proyecto"]) and _slug(str(c["casa"])) == _slug(args.casa)
    ]  # fmt: skip
    if not sel:
        print("Casa no encontrada en Primavera.")
        return 1
    d = datos_casa(*sel[0], bib)
    lams = laminas(d, args.fecha, _disenador())
    ruta = a_pdf(lams, SALIDA / f"PRO-ELE-PRIMAVERA-C{_slug(args.casa)}-PLANOS.pdf")
    print(ruta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
