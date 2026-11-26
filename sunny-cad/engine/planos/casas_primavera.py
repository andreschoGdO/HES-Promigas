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
from engine.planos.lamina import CAPAS, Lamina, a_pdf
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
CAPAS.update({"BRILLO": (7, "#ffffff", 0.25), "SOMBRA": (8, "#333333", 0.35)})
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


def colocar_alineado(cubierta: Polygon, obstaculos, n: int):
    """Módulos en una sola hilera paralela a un borde de la cubierta (instalación más simple).

    Prueba los bordes de mayor a menor longitud y usa el primero en que cabe la hilera con el
    retiro normal. Devuelve (módulos, azimut al que miran).
    """
    pts = list(cubierta.exterior.coords)
    bordes = sorted(zip(pts[:-1], pts[1:], strict=True), key=lambda e: -math.dist(*e))
    for a, b in bordes:
        th = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        th = (th + 90) % 180 - 90  # entre -90° y 90°
        if abs(th) > 45:
            continue  # bordes norte-sur: la hilera quedaría mirando al este u oeste
        rot = [affinity.rotate(o, -th, origin=(0, 0)) for o in (cubierta, *obstaculos)]
        try:
            mods = colocar_modulos(rot[0], rot[1:], n)
        except ValueError:
            continue
        mods = [affinity.rotate(m, th, origin=(0, 0)) for m in mods]
        return mods, (180.0 - th) % 360
    return colocar_modulos(cubierta, obstaculos, n), 180.0


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
            h = min(1.5, 1134 * m.k / 6.2)  # el rótulo cabe en el ancho del módulo
            lam.texto(m((c.x, c.y + 250)), f"1.1.1.{i}", h, "TEXTO", "centro", negrita=True)
            lam.texto(m((c.x, c.y - 450)), "595 Wp", h * 0.75, "TEXTO", "centro")


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


# ------------------------------------------------------------------------------- tubería
def tubo(lam, pts, diam, capa="AC", relleno="#cfe0f5", abrazaderas=0.0, uniones=0.0) -> None:
    """Tubería dibujada con su diámetro (en mm de papel): contorno, relleno, eje, curvas
    redondeadas, uniones (marcas transversales) y abrazaderas (soportes a la pared)."""
    from shapely.geometry import LineString

    ls = LineString(pts)
    if ls.length <= 0:
        return
    cuerpo = ls.buffer(diam / 2, cap_style=2, join_style=1, quad_segs=6)
    lam.polilinea(list(cuerpo.exterior.coords), capa, cerrada=True, relleno=relleno)
    lam.polilinea(pts, "NOTA", trazo="discontinuo")
    for paso, ancho, largo in ((uniones, diam * 1.5, 0.5), (abrazaderas, diam * 2.2, 0.9)):
        if not paso:
            continue
        dist = paso
        while dist < ls.length - paso * 0.3:
            a, b = ls.interpolate(dist - 0.01), ls.interpolate(dist + 0.01)
            dx, dy = b.x - a.x, b.y - a.y
            n = math.hypot(dx, dy) or 1
            ux, uy, nx, ny = dx / n, dy / n, -dy / n, dx / n
            c = ls.interpolate(dist)
            h = ancho / 2
            pts_ = [
                (c.x + nx * h - ux * largo / 2, c.y + ny * h - uy * largo / 2),
                (c.x + nx * h + ux * largo / 2, c.y + ny * h + uy * largo / 2),
                (c.x - nx * h + ux * largo / 2, c.y - ny * h + uy * largo / 2),
                (c.x - nx * h - ux * largo / 2, c.y - ny * h - uy * largo / 2),
            ]
            lam.polilinea(pts_, capa, cerrada=True, relleno="#555555" if largo > 0.6 else None)
            dist += paso


def caja_paso(lam, c, lado=2.6, rotulo="") -> None:
    lam.rect(c[0] - lado / 2, c[1] - lado / 2, lado, lado, "UNIFILAR", relleno="#d9d9d9")
    lam.linea((c[0] - lado / 2, c[1] - lado / 2), (c[0] + lado / 2, c[1] + lado / 2), "NOTA")
    if rotulo:
        lam.texto((c[0] + lado / 2 + 1, c[1]), rotulo, 1.1, "TEXTO", "izq_medio")


def etiqueta_tramo(lam, a, b, texto, capa="TEXTO") -> None:
    """Rótulo de un tramo (número y longitud) en un círculo sobre su punto medio."""
    c = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    lam.rect(c[0] - 4.6, c[1] + 1.4, 9.2, 3, "CAJETIN", relleno="#ffffff")
    lam.texto((c[0], c[1] + 2.9), texto, 1.2, capa, "centro", negrita=True)


def ruta_planta(lam, m, pts_mm, capa, relleno, prefijo, diam=1.4) -> list[float]:
    """Ruta en planta como tubería, con cada tramo rotulado (prefijo-n: longitud en m)."""
    pts = [m(p) for p in pts_mm]
    tubo(lam, pts, diam, capa, relleno)
    largos = []
    for i, (a, b) in enumerate(zip(pts_mm[:-1], pts_mm[1:], strict=True), 1):
        largo = math.dist(a, b) / 1000
        largos.append(largo)
        if largo > 0.4:
            etiqueta_tramo(lam, m(a), m(b), f"{prefijo}{i}: {largo:.1f} m", capa)
    return largos


# ------------------------------------------------------------------------------- isométrico
Z_PISO, Z_CUB, Z_PATIO = 2800.0, 5600.0, 2600.0  # alturas supuestas (mm)


def _local(geom):
    """Del marco con el norte arriba al marco de la vivienda (deshace el giro del mapa)."""
    return affinity.rotate(geom, -ROT_MAPA_DEG, origin=(0, 0))


# --- Estructura lastrada (detalle tipo del usuario; bloques esquemáticos) -----------------------
SEN10, COS10 = math.sin(math.radians(10)), math.cos(math.radians(10))
LARGO_MOD, ANCHO_MOD = 2278.0, 1134.0
PROY_MOD = LARGO_MOD * COS10  # 2243 mm en planta
DESNIVEL = LARGO_MOD * SEN10  # 396 mm entre el borde bajo y el alto
RIEL_S = (542.0, LARGO_MOD - 542.0)  # rieles a 542 mm de cada borde (1244 entre rieles)
H_SOPORTE = 412.0  # soporte trasero, del bloque al riel (detalle tipo)
Z_BLOQUE = 150.0  # bloque de concreto: esquemático, dimensiones y peso según proveedor
BLOQUE_UV = (220.0, 400.0)  # esquemático: a lo largo de la fila × hacia atrás
PASO_FILAS = 3665.0  # distancia entre filas cuando hay más de una (detalle tipo)


def _z_modulo(z_techo):
    """Altura del borde bajo del módulo para que el soporte trasero mida H_SOPORTE."""
    return z_techo + Z_BLOQUE + H_SOPORTE - RIEL_S[1] * SEN10


def _filas(mods):
    """Agrupa los módulos en filas: u a lo largo de la fila, v hacia atrás (borde alto)."""
    datos = []
    for md in mods:
        v_ = list(md.exterior.coords)[:4]
        lados = sorted(((v_[i], v_[(i + 1) % 4]) for i in range(4)), key=lambda e: math.dist(*e))
        sur, norte = sorted(lados[:2], key=lambda e: e[0][1] + e[1][1])
        datos.append((sur, norte))
    (a, b), norte = datos[0]
    ln = math.dist(a, b)
    u = ((b[0] - a[0]) / ln, (b[1] - a[1]) / ln)
    if u[0] < 0:
        u = (-u[0], -u[1])
    v = (-u[1], u[0])
    ms = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    mn = ((norte[0][0] + norte[1][0]) / 2, (norte[0][1] + norte[1][1]) / 2)
    if (mn[0] - ms[0]) * v[0] + (mn[1] - ms[1]) * v[1] < 0:
        v = (-v[0], -v[1])
    filas: dict[int, dict] = {}
    for sur, _n in datos:
        t = sum((sur[0][i] + sur[1][i]) / 2 * v[i] for i in (0, 1))
        s = sorted(sur[j][0] * u[0] + sur[j][1] * u[1] for j in (0, 1))
        f = filas.setdefault(round(t / 200), {"u": u, "v": v, "t0": t, "mods": []})
        f["mods"].append(tuple(s))
    out = sorted(filas.values(), key=lambda f: f["t0"])
    for f in out:
        f["mods"].sort()
        _juntas(f)
    return out


def _juntas(f, hueco=100.0) -> None:
    """Grupos de módulos contiguos de una fila y las juntas (soportes) de cada grupo."""
    grupos = [[f["mods"][0]]]
    for q in f["mods"][1:]:
        if q[0] - grupos[-1][-1][1] > hueco:
            grupos.append([q])
        else:
            grupos[-1].append(q)
    f["grupos"] = grupos
    f["juntas"] = []
    for g_ in grupos:
        medias = [(p_[1] + q[0]) / 2 for p_, q in zip(g_, g_[1:], strict=False)]
        f["juntas"] += [g_[0][0], *medias, g_[-1][1]]


def cantidades_estructura(mods) -> dict[str, float]:
    """Bloques, rieles y grapas de la estructura tal como se dibuja (por tramo continuo)."""
    grupos = [g_ for f in _filas(mods) for g_ in f["grupos"]]
    return {
        "bloques": 2 * sum(len(g_) + 1 for g_ in grupos),  # delantero y trasero por soporte
        "riel_m": sum(2 * ((g_[-1][1] - g_[0][0]) + 120) / 1000 for g_ in grupos),
        "mid_clamp": sum(2 * (len(g_) - 1) for g_ in grupos),
        "end_clamp": 4 * len(grupos),
        "fila_m": sum((g_[-1][1] - g_[0][0]) / 1000 for g_ in grupos),
    }


def _estructura3d(lam, P, prof, filas, z_techo, color_mod="#2f4f7f", fantasma=()) -> None:
    """Fila(s) de módulos sobre la estructura lastrada: bloques, soportes, rieles y módulos."""
    zb = z_techo + Z_BLOQUE
    zm0 = _z_modulo(z_techo)
    ts = [s * COS10 for s in RIEL_S]
    zr = [zm0 + s * SEN10 for s in RIEL_S]
    prims = []  # (profundidad, tipo, puntos, capa, relleno)

    for f in filas:
        u, v, t0 = f["u"], f["v"], f["t0"]

        def X(s, t, z, u=u, v=v, t0=t0):
            return (u[0] * s + v[0] * (t0 + t), u[1] * s + v[1] * (t0 + t), z)

        def add(tipo, pts3, capa, relleno=None):
            c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
            prims.append((prof(*c), tipo, [P(*q) for q in pts3], capa, relleno))

        bu, bv = BLOQUE_UV
        for s in f["juntas"]:
            for t in ts:  # bloque bajo cada soporte (delantero y trasero)
                s0, s1, t_0, t_1 = s - bu / 2, s + bu / 2, t - bv / 2, t + bv / 2
                for cara in (
                    [(s0, t_0), (s1, t_0)], [(s1, t_0), (s1, t_1)],
                    [(s1, t_1), (s0, t_1)], [(s0, t_1), (s0, t_0)],
                ):  # fmt: skip
                    (sa, ta), (sb, tb) = cara
                    add("p", [X(sa, ta, z_techo), X(sb, tb, z_techo), X(sb, tb, zb),
                              X(sa, ta, zb)], "CUBIERTA", "#a9a9a9")  # fmt: skip
                add("p", [X(s0, t_0, zb), X(s1, t_0, zb), X(s1, t_1, zb), X(s0, t_1, zb)],
                    "CUBIERTA", "#cfcfcf")  # fmt: skip
            add("l", [X(s, ts[0], zb), X(s, ts[1], zb)], "ESTRUCTURA")  # base del soporte
            for t, z in zip(ts, zr, strict=True):
                add("l", [X(s, t, zb), X(s, t, z - 40)], "ESTRUCTURA")  # patas
            add("l", [X(s, ts[0], zb), X(s, ts[1], zr[1] - 40)], "ESTRUCTURA")  # diagonal
        for g_ in f["grupos"]:  # rieles a lo largo de cada tramo continuo de la fila
            s_ini, s_fin = g_[0][0] - 60, g_[-1][1] + 60
            for t, z in zip(ts, zr, strict=True):
                add("l", [X(s_ini, t, z - 20), X(s_fin, t, z - 20)], "ESTRUCTURA")
        for im, (sa, sb) in enumerate(f["mods"]):
            cara = [X(sa, 0, zm0 + 35), X(sb, 0, zm0 + 35), X(sb, PROY_MOD, zm0 + DESNIVEL + 35),
                    X(sa, PROY_MOD, zm0 + DESNIVEL + 35)]  # fmt: skip
            if (
                filas.index(f),
                im,
            ) in fantasma:  # módulo en corte: solo el contorno, deja ver la estructura
                add("f", cara, "MODULO")
                continue
            add("p", cara, "MODULO", color_mod)
            zc = zm0 + DESNIVEL / 2 + 36
            add("l", [X(sa + 5, PROY_MOD / 2, zc), X(sb - 5, PROY_MOD / 2, zc)], "SOMBRA")
            for s in (sa, sb):
                add("l", [X(s, 0, zm0 + 36), X(s, PROY_MOD, zm0 + DESNIVEL + 36)], "BRILLO")

    for _p, tipo, pts, capa, rel in sorted(prims, key=lambda q: -q[0]):
        if tipo == "p":
            lam.polilinea(pts, capa, cerrada=True, relleno=rel)
        elif tipo == "f":
            lam.polilinea(pts, capa, cerrada=True, trazo="discontinuo")
        else:
            lam.polilinea(pts, capa)


# --- Vistas 3D --------------------------------------------------------------------------------
def _vista(area, pts3d, desde="NE"):
    """Proyección isométrica ajustada a un área. Devuelve P (3D → papel) y la profundidad."""
    x0, y0, w, h = area
    c30, s30 = math.cos(math.radians(30)), math.sin(math.radians(30))

    def proy(x, y, z):
        if desde == "NE":  # observador al noreste (lado del patio y el balcón)
            x, y = -x, -y
            return ((x - y) * c30, (x + y) * s30 + z)
        if desde == "SO":  # observador al suroeste
            return ((x - y) * c30, (x + y) * s30 + z)
        return ((x + y) * c30, (y - x) * s30 + z)  # observador al sureste

    def prof(x, y, z):
        base = {"NE": -(x + y), "SO": x + y}.get(desde, y - x)
        return base - 2.5 * z

    us = [proy(*q) for q in pts3d]
    ux = [p_[0] for p_ in us]
    uy = [p_[1] for p_ in us]
    k = min(w / (max(ux) - min(ux)), h / (max(uy) - min(uy)))
    ox = x0 + (w - (max(ux) - min(ux)) * k) / 2 - min(ux) * k
    oy = y0 + (h - (max(uy) - min(uy)) * k) / 2 - min(uy) * k

    def P(x, y, z):
        u_, v_ = proy(x, y, z)
        return (ox + u_ * k, oy + v_ * k)

    return P, prof, k


class _Recorte:
    """Envuelve una lámina y recorta todo lo dibujado a un rectángulo (vistas de detalle)."""

    def __init__(self, lam, area):
        x, y, w, h = area
        self.lam, self.caja = lam, box(x, y, x + w, y + h)

    def polilinea(self, pts, capa="TEXTO", cerrada=False, relleno=None, trazo="continuo"):
        from shapely.geometry import LineString

        if len(pts) < 2:
            return
        g_ = Polygon(pts) if cerrada and len(pts) >= 3 else LineString(pts)
        if not g_.is_valid:
            g_ = g_.buffer(0)
        r = g_.intersection(self.caja)
        for parte in getattr(r, "geoms", [r]):
            if parte.is_empty:
                continue
            if parte.geom_type == "Polygon":
                self.lam.polilinea(list(parte.exterior.coords)[:-1], capa, True, relleno, trazo)
            elif parte.geom_type == "LineString":
                self.lam.polilinea(list(parte.coords), capa, trazo=trazo)

    def linea(self, a, b, capa="TEXTO", trazo="continuo"):
        self.polilinea([a, b], capa, trazo=trazo)

    def rect(self, x, y, w, h, capa="TEXTO", relleno=None, trazo="continuo"):
        self.polilinea([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], capa, True, relleno, trazo)

    def circulo(self, c, r, capa="TEXTO", relleno=None):
        if self.caja.contains(Point(c)):
            self.lam.circulo(c, r, capa, relleno=relleno)

    def texto(self, p, s, *a, **kw):
        if self.caja.contains(Point(p)):
            self.lam.texto(p, s, *a, **kw)


def _fusionar(pts):
    """Quita los vértices intermedios de tramos colineales."""
    out = [pts[0]]
    for q, r in zip(pts[1:-1], pts[2:], strict=True):
        a = out[-1]
        d1 = [q[i] - a[i] for i in range(3)]
        d2 = [r[i] - q[i] for i in range(3)]
        cruz = (d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2],
                d1[0] * d2[1] - d1[1] * d2[0])  # fmt: skip
        if math.hypot(*cruz) > 1e-6 * (math.hypot(*d1) * math.hypot(*d2) + 1):
            out.append(q)
    out.append(pts[-1])
    return out


def rutas3d(g, mods):
    """Rutas DC y AC en 3D (mm, marco de la vivienda), adosadas a cubierta, muros y piso."""
    loc_mods = [_local(m_) for m_ in mods]
    zp = Z_PISO
    lleg = _local(Point(g["bajante_dc"]))
    cerca = min(loc_mods, key=lambda m_: m_.distance(lleg))
    bx0, by0, bx1, by1 = cerca.bounds
    xs = min(max(lleg.x, bx0 + 200), bx1 - 200)  # salida alineada con la bajante si se puede
    norte = abs(by1 - lleg.y) < abs(by0 - lleg.y)
    ys = by1 + 150 if norte else by0 - 150
    z_sal = _z_modulo(Z_CUB) + (DESNIVEL if norte else 0)
    zr = Z_CUB + 80  # coraza apoyada sobre la cubierta
    xb = min(max(xs, 9300), 10500)  # bajante alineada con la salida del arreglo
    dc = _fusionar([
        (xb, ys, z_sal), (xb, ys, zr),
        (xb, -2440, zr),  # por la cubierta y cruza el pretil hacia el balcón
        (xb, -2440, zp + 2300), (9030, -2440, zp + 2300),  # baja por el muro frontal
        (9030, -680, zp + 2300), (9535, -680, zp + 2300), (9535, -680, zp + 1650),
    ])  # fmt: skip
    ac = _fusionar([
        (9075, -1950, zp + 800), (9075, -1950, zp + 150), (9075, -2440, zp + 150),
        (10930, -2440, zp + 150),  # por el piso del balcón hasta la fachada
        (10930, -2440, 1700),  # baja por fachada, atraviesa la cubierta del patio
    ])  # fmt: skip
    desc_dc = [
        "Salida del arreglo (caja de paso) a la cubierta",
        "Sobre la cubierta hasta el borde del balcón",
        "Baja por el muro frontal del balcón",
        "Horizontal, adosada al muro frontal",
        "Horizontal, adosada al muro lateral",
        "Horizontal hasta la vertical del inversor",
        "Baja a la entrada DC del inversor",
    ]
    desc_ac = [
        "Baja del tablero FV al piso del balcón",
        "Por el piso, junto al muro lateral",
        "Por el piso, junto al muro frontal, a la fachada",
        "Baja por fachada, pase en cubierta del patio, tablero P.C.",
    ]
    if len(desc_dc) != len(dc) - 1:
        desc_dc = [f"Tramo {i}" for i in range(1, len(dc))]
    if len(desc_ac) != len(ac) - 1:
        desc_ac = [f"Tramo {i}" for i in range(1, len(ac))]
    return {"dc": dc, "ac": ac, "desc_dc": desc_dc, "desc_ac": desc_ac}


def _largos(pts):
    return [math.dist(a, b) / 1000 for a, b in zip(pts[:-1], pts[1:], strict=True)]


def _escena3d(lam, P, prof, g, mods, R) -> None:
    """Vivienda, estructura, equipos y rutas en 3D (marco de la vivienda)."""
    loc = {k: _local(g[k]) for k in ("lote", "cubierta", "cubierta_alta", "balcon", "patio")}
    caras = []

    def prisma(pol, z0, z1, relleno, capa="CUBIERTA", lados=True):
        pts = list(pol.exterior.coords)[:-1]
        if lados:
            for a, b in zip(pts, pts[1:] + pts[:1], strict=True):
                pr = prof((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (z0 + z1) / 2)
                caras.append((pr, [P(*a, z0), P(*b, z0), P(*b, z1), P(*a, z1)], capa, relleno))
        c = pol.centroid
        caras.append((prof(c.x, c.y, z1), [P(x, y, z1) for x, y in pts], capa, relleno))

    lam.polilinea([P(x, y, 0) for x, y in list(loc["lote"].exterior.coords)[:-1]], "NOTA",
                  cerrada=True, relleno="#dfe8d6")  # fmt: skip
    prisma(loc["cubierta"].union(loc["cubierta_alta"]), 0, Z_CUB, "#ecebe6")
    prisma(loc["balcon"], 0, Z_PISO, "#f7efe2")
    prisma(loc["patio"], Z_PATIO - 100, Z_PATIO, "#c9d8ea", "NOTA")
    for _pr, pts, capa, rel in sorted(caras, key=lambda c_: -c_[0]):
        lam.polilinea(pts, capa, cerrada=True, relleno=rel)
    _estructura3d(lam, P, prof, _filas([_local(m_) for m_ in mods]), Z_CUB)
    zp = Z_PISO
    caja3d(lam, P, (9339, 9731, -800, -560, zp + 1100, zp + 1650), "#dbe9f6", "AC")  # inversor
    caja3d(lam, P, (9894, 10745, -760, -560, zp, zp + 900), "#e9c4ea", "EQUIPO")  # baterías
    caja3d(lam, P, (8975, 9175, -2150, -1750, zp + 800, zp + 1600), "#d9d9d9", "EQUIPO")  # tablero
    tubo3d(lam, P, R["dc"], 1.7 * R.get("f", 1), "#e74c3c", "DC", abrazadera_mm=1500)
    tubo3d(lam, P, R["ac"], 2.1 * R.get("f", 1), "#2e86de", "AC", abrazadera_mm=1500)
    x_, y_, _z = R["dc"][0]
    caja3d(lam, P, (x_ - 60, x_ + 60, y_ - 60, y_ + 60, _z - 60, _z + 60), "#f4f4f4", "EQUIPO")
    lam.circulo(P(10930, -2440, Z_PATIO), 1.5 * R.get("f", 1), "ROJO", relleno="#c00000")
    caja3d(lam, P, (10860, 10960, -2700, -2180, 900, 1700), "#ffffff", "EQUIPO")  # tablero P.C.


def isometrico(lam, area, g, mods, d) -> None:
    """Esquema isométrico de la vivienda con las rutas DC (rojo) y AC (azul) en 3D."""
    x0, y0, w, h = area
    R = rutas3d(g, mods)
    lote = _local(g["lote"])
    minx, miny, maxx, maxy = lote.bounds
    marco = [(x, y, z) for x in (minx, maxx) for y in (miny, maxy) for z in (0, Z_CUB + 600)]
    P, prof, _k = _vista((x0 + 5, y0 + 5, w - 10, h - 10), marco)
    _escena3d(lam, P, prof, g, mods, R)
    dc, ac = R["dc"], R["ac"]
    zp = Z_PISO
    rot = [
        (P(*dc[0]), "Arreglo FV · caja de paso, salida string S1.1.1", -1),
        (P(*dc[2]), 'DC: coraza 1" por cubierta y muro del balcón', -1),
        (P(9535, -680, zp + 1650), "Inversor (balcón 2° piso)", -1),
        (P(9075, -1950, zp + 1200), "Tablero FV", -1),
        (P(10300, -650, zp + 600), "Baterías", 1),
        (P(*ac[2]), 'AC: IMC 2" adosada al piso del balcón', 1),
        (P(10930, -2440, Z_PATIO), "Pase en cubierta del patio", 1),
        (P(10960, -2440, 1300), "Tablero P.C. · 1° piso (punto de conexión)", 1),
    ]
    for lado, xcol in ((-1, x0 + 52), (1, x0 + w - 62)):
        items = sorted(((p_, t) for p_, t, s in rot if s == lado), key=lambda it: -it[0][1])
        y_prev = None
        for p_, t in items:
            yq = p_[1] + 4 if y_prev is None else min(p_[1] + 4, y_prev - 6.5)
            y_prev = yq
            q = (xcol, yq)
            _guia(lam, p_, q)
            _caja_texto(lam, (q[0], q[1] + 1.6), [t], h=1.3, alinear="der" if lado < 0 else "izq")
    lam.texto((x0 + 2, y0 + 2), "Alturas supuestas: piso 2,8 m; cubierta 5,6 m; cubierta del patio "
              "2,6 m. Esquema sin escala. Detalles de estructura y rutas en la hoja 4.", 1.3,
              "NOTA")  # fmt: skip


# --- Detalles (hoja 4) ------------------------------------------------------------------------
def _cota(lam, a, b, texto, off=4.0, h=1.4, capa="COTA") -> None:
    """Cota alineada entre dos puntos del papel, desplazada `off` mm a la izquierda de a→b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1
    nx, ny = -dy / ln, dx / ln
    a2 = (a[0] + nx * off, a[1] + ny * off)
    b2 = (b[0] + nx * off, b[1] + ny * off)
    s = 1 if off >= 0 else -1
    lam.linea((a[0] + nx * s * 0.8, a[1] + ny * s * 0.8), (a2[0] + nx * s, a2[1] + ny * s), capa)
    lam.linea((b[0] + nx * s * 0.8, b[1] + ny * s * 0.8), (b2[0] + nx * s, b2[1] + ny * s), capa)
    lam.linea(a2, b2, capa)
    for p_ in (a2, b2):  # marcas oblicuas
        lam.linea((p_[0] - 0.7 * (dx / ln - nx), p_[1] - 0.7 * (dy / ln - ny)),
                  (p_[0] + 0.7 * (dx / ln - nx), p_[1] + 0.7 * (dy / ln - ny)), capa)  # fmt: skip
    ang = math.degrees(math.atan2(dy, dx))
    if ang > 90 or ang <= -90:
        ang -= 180 if ang > 0 else -180
    m_ = ((a2[0] + b2[0]) / 2 + nx * s * 1.4, (a2[1] + b2[1]) / 2 + ny * s * 1.4)
    lam.texto(m_, texto, h, capa, "centro", rotacion=ang)


def _arco(lam, c, r, a0, a1, capa="COTA") -> None:
    pts = [(c[0] + r * math.cos(math.radians(a)), c[1] + r * math.sin(math.radians(a)))
           for a in [a0 + (a1 - a0) * i / 12 for i in range(13)]]  # fmt: skip
    lam.polilinea(pts, capa)


def detalle_lastrada_3d(lam, area, n_mod: int = 0, mods=None, sep: float = 5.0) -> None:
    """Estructura lastrada en 3D con cotas (vista desde el sureste).

    Con `mods` (polígonos en planta) dibuja la distribución real, con todas sus filas; si no,
    una fila de `n_mod` módulos.
    """
    x0, y0, w, h = area
    if mods:
        filas = _filas(mods)
        s0 = min(f["mods"][0][0] for f in filas)
        t_min = filas[0]["t0"]
        for f in filas:
            f.update(u=(1.0, 0.0), v=(0.0, 1.0), t0=f["t0"] - t_min)
            f["mods"] = [(a - s0, b - s0) for a, b in f["mods"]]
            _juntas(f)
    else:
        f = {"t0": 0.0, "u": (1.0, 0.0), "v": (0.0, 1.0)}
        f["mods"] = [(i * (ANCHO_MOD + sep), i * (ANCHO_MOD + sep) + ANCHO_MOD)
                     for i in range(n_mod)]  # fmt: skip
        _juntas(f)
        filas = [f]
    f0 = filas[0]
    mods0, juntas = f0["mods"], f0["juntas"]
    largo = max(f["mods"][-1][1] for f in filas)
    fondo = filas[-1]["t0"] + PROY_MOD
    zm0 = _z_modulo(0)
    marco = [(x, y, z) for x in (-700, largo + 1400) for y in (-900, fondo + 500)
             for z in (0, zm0 + DESNIVEL + 200)]  # fmt: skip
    P, prof, _k = _vista((x0 + 4, y0 + 10, w - 60, h - 14), marco, desde="SE")
    yt = fondo + 400
    techo = [(-500, -700), (largo + 700, -700), (largo + 700, yt), (-500, yt)]
    lam.polilinea([P(x, y, 0) for x, y in techo], "CUBIERTA", cerrada=True, relleno="#ecebe6")
    n0 = len(mods0)
    fant = {(0, i) for i in range(max(1, n0 - 2), n0)}  # últimos módulos de la 1ª fila en corte
    _estructura3d(lam, P, prof, filas, 0.0, color_mod="#3d6aa8", fantasma=fant)
    largo0 = mods0[-1][1] - mods0[0][0]
    _cota(lam, P(mods0[0][0], -450, 0), P(mods0[-1][1], -450, 0), f"{largo0:.0f}", off=-2.5)
    _cota(lam, P(mods0[0][0], -150, zm0), P(mods0[0][1], -150, zm0), f"{ANCHO_MOD:.0f}",
          off=-2.0, h=1.2)  # fmt: skip
    xe = largo + 350
    _cota(lam, P(xe, 0, 0), P(xe, PROY_MOD, 0), f"{PROY_MOD:.0f} (planta)", off=-2.5, h=1.2)
    for fa, fb in zip(filas, filas[1:], strict=False):
        _cota(lam, P(xe + 1000, fa["t0"], 0), P(xe + 1000, fb["t0"], 0),
              f"{fb['t0'] - fa['t0']:.0f} entre filas", off=-2.5, h=1.2)  # fmt: skip
    # Rótulos
    xr = x0 + w - 54
    rot = [
        (
            P(mods0[min(1, n0 - 1)][0] + 500, PROY_MOD * 0.6, zm0 + DESNIVEL * 0.6 + 40),
            "Módulo JAM72D40 595 Wp (1134 × 2278), 10° (ver corte 2)",
        ),
        (
            P(juntas[-2], RIEL_S[1] * COS10, zm0 + RIEL_S[1] * SEN10 - 20),
            "Riel de aluminio (2 por fila, a 542 mm de cada borde)",
        ),
        (P(juntas[-2], RIEL_S[1] * COS10, Z_BLOQUE + 200), f"Soporte trasero {H_SOPORTE:.0f} mm"),
        (P(juntas[-2], RIEL_S[0] * COS10, Z_BLOQUE * 0.6), "Bloque de concreto (lastre)"),
        (P(juntas[1], 0, zm0 + 40), "Mid clamp en cada unión · end clamp en extremos"),
    ]
    rot.sort(key=lambda it: -it[0][1])
    y_prev = None
    for p_, t in rot:
        yq = p_[1] + 3 if y_prev is None else min(p_[1] + 3, y_prev - 6)
        y_prev = yq
        _guia(lam, p_, (xr, yq))
        _caja_texto(lam, (xr, yq + 1.5), [t], h=1.15)
    lam.texto((x0 + 2, y0 + 3), f"Separación entre módulos {sep:.0f} mm. Bloques esquemáticos: "
              "dimensiones, peso y cantidad según proveedor y cálculo de viento.", 1.15,
              "NOTA")  # fmt: skip


def corte_lastrada(lam, x, y, paso: float | None = None) -> None:
    """Corte lateral a escala 1:20 de la estructura lastrada con alturas e inclinación."""
    k = 1 / 20
    zb = Z_BLOQUE
    zm0 = _z_modulo(0)
    ts = [s * COS10 for s in RIEL_S]
    zr = [zm0 + s * SEN10 for s in RIEL_S]

    def p(t, z):
        return (x + 14 + t * k, y + 12 + z * k)

    lam.linea(p(-500, 0), p(PROY_MOD + 600, 0), "CUBIERTA")
    lam.polilinea([p(-500, 0), p(PROY_MOD + 600, 0), p(PROY_MOD + 600, -60), p(-500, -60)],
                  "CUBIERTA", cerrada=True, relleno="#d9d4cb")  # fmt: skip
    for t, z in zip(ts, zr, strict=True):
        a, b = p(t - BLOQUE_UV[1] / 2, 0), p(t + BLOQUE_UV[1] / 2, zb)
        lam.rect(a[0], a[1], b[0] - a[0], b[1] - a[1], "CUBIERTA", relleno="#cfcfcf")
        lam.linea(p(t, zb), p(t, z - 40), "ESTRUCTURA")
        lam.rect(p(t, z)[0] - 1, p(t, z - 40)[1], 2, 40 * k, "ESTRUCTURA", relleno="#8b5e3c")
    lam.linea(p(ts[0], zb), p(ts[1], zb), "ESTRUCTURA")
    lam.linea(p(ts[0], zb), p(ts[1], zr[1] - 40), "ESTRUCTURA")
    m0, m1 = p(0, zm0), p(PROY_MOD, zm0 + DESNIVEL)
    grosor = 35 * k
    lam.polilinea([m0, m1, (m1[0], m1[1] + grosor), (m0[0], m0[1] + grosor)], "MODULO",
                  cerrada=True, relleno="#3d6aa8")  # fmt: skip
    # Cotas: largo e inclinación del módulo, rieles, alturas y proyección
    _cota(lam, (m0[0], m0[1] + grosor), (m1[0], m1[1] + grosor), f"{LARGO_MOD:.0f}", off=6)
    r0 = (
        m0[0] + (m1[0] - m0[0]) * RIEL_S[0] / LARGO_MOD,
        m0[1] + (m1[1] - m0[1]) * RIEL_S[0] / LARGO_MOD,
    )
    r1 = (
        m0[0] + (m1[0] - m0[0]) * RIEL_S[1] / LARGO_MOD,
        m0[1] + (m1[1] - m0[1]) * RIEL_S[1] / LARGO_MOD,
    )
    _cota(lam, (m0[0], m0[1] + grosor), (r0[0], r0[1] + grosor), "542", off=2.5, h=1.2)
    _cota(lam, (r0[0], r0[1] + grosor), (r1[0], r1[1] + grosor), "1244", off=2.5, h=1.2)
    _cota(lam, (r1[0], r1[1] + grosor), (m1[0], m1[1] + grosor), "542", off=2.5, h=1.2)
    _cota(lam, p(0, -60), p(PROY_MOD, -60), f"{PROY_MOD:.0f} (proyección en planta)", off=-4)
    _cota(lam, p(ts[0], -60), p(ts[1], -60), f"{ts[1] - ts[0]:.0f} entre bloques", off=-9,
          h=1.2)  # fmt: skip
    _cota(lam, p(ts[1] + 120, zb), p(ts[1] + 120, zr[1]), f"{H_SOPORTE:.0f}", off=-3, h=1.3)
    _cota(lam, p(ts[0] - 120, zb), p(ts[0] - 120, zr[0]), f"{zr[0] - zb:.0f}*", off=3, h=1.2)
    _cota(lam, p(PROY_MOD + 250, zm0), p(PROY_MOD + 250, zm0 + DESNIVEL),
          f"{DESNIVEL:.0f}", off=-3, h=1.3)  # fmt: skip
    lam.linea(p(-150, zm0), p(PROY_MOD + 330, zm0), "COTA", trazo="discontinuo")
    lam.linea(m1, p(PROY_MOD + 330, zm0 + DESNIVEL), "COTA", trazo="discontinuo")
    # Ángulo
    lam.linea(m0, (m0[0] + 20, m0[1]), "COTA")
    _arco(lam, m0, 16, 0, 10)
    lam.texto((m0[0] + 17, m0[1] - 2.6), "10°", 1.8, "COTA", negrita=True)
    # Rótulos
    lam.texto((m1[0] - 30, m1[1] + 9.5), "MÓDULO FV", 1.2, "NOTA")
    lam.texto((p(ts[1], 0)[0] + 13, p(0, 0)[1] + 2.0), "BLOQUE DE CONCRETO (esquemático)", 1.1,
              "NOTA")  # fmt: skip
    lam.texto((p(-500, 0)[0], p(0, -60)[1] - 2.4), "CUBIERTA", 1.1, "NOTA")
    lam.texto((x + 2, y - 8), "Cotas en mm. * Altura del soporte delantero calculada con 10° y los "
              "rieles a 542 mm: confirmar con el proveedor.", 1.1, "NOTA")  # fmt: skip
    nota = (
        f"Filas seguidas cada {paso:.0f} mm (eje a eje); bloques bajo cada riel."
        if paso
        else f"Con más de una fila, distancia entre filas {PASO_FILAS:.0f} mm "
        "(sin sombras); en una sola hilera el bloque trasero va bajo el borde alto."
    )
    lam.texto((x + 2, y - 10.6), nota, 1.1, "NOTA")


def detalle_ruta3d(lam, area, g, mods, cual: str) -> None:
    """Ruta DC o AC de Primavera ampliada en 3D (tramos y curvas)."""
    R = rutas3d(g, mods)

    def escena(lam_, P, prof, f):
        _escena3d(lam_, P, prof, g, mods, {**R, "f": f})

    detalle_ruta(lam, area, R[cual], R["desc_" + cual], cual, _vista, escena,
                 NOTAS_RUTA[cual])  # fmt: skip


NOTAS_RUTA = {
    "dc": [
        "C1 a C{nc}: {nc} curvas de 90° hechas con la coraza",
        'americana de 1" (radio amplio, sin aplastarla).',
        "Caja de paso 10x10 cm IP66 a la salida del arreglo.",
        "Soportes / abrazaderas cada 1,5 m y a 30 cm de",
        "cada curva. Coraza siempre adosada (no en el aire).",
        "Cruce del pretil con pasamuro sellado.",
    ],
    "ac": [
        'C1 a C{nc}: {nc} curvas IMC 2" de 90° (fabricadas).',
        'Uniones IMC 2" cada 3 m; abrazaderas cada 1,5 m',
        "y a 30 cm de cada curva y de cada caja.",
        "Pase en cubierta del patio con sello impermeable.",
        "Tubo adosado al piso y a la fachada (no en el aire).",
    ],
}


def detalle_ruta(lam, area, pts, desc, cual, vista_fn, escena_fn, notas, extra=()) -> None:
    """Ruta ampliada en 3D: tramos numerados con su longitud, curvas marcadas y tabla.

    vista_fn(area, puntos) → (P, prof, k); escena_fn(lam, P, prof, f) dibuja la vivienda.
    `extra`: filas adicionales de la tabla (rótulo, recorrido, m), p. ej. tubería existente.
    """
    x0, y0, w, h = area
    largos = _largos(pts)
    ancho_tabla = 74
    vista = (x0 + 1, y0 + 1, w - ancho_tabla - 3, h - 2)
    xs = [q[0] for q in pts]
    ys = [q[1] for q in pts]
    zs = [q[2] for q in pts]
    mg = 700
    marco = [(x, y, z) for x in (min(xs) - mg, max(xs) + mg) for y in (min(ys) - mg, max(ys) + mg)
             for z in (min(zs) - 300, max(zs) + 300)]  # fmt: skip
    P, prof, k = vista_fn(vista, marco)
    escena_fn(_Recorte(lam, vista), P, prof, min(2.6, max(1.2, k * 60)))  # tubo más grueso
    lam.rect(*vista, "CAJETIN")
    color = "DC" if cual == "dc" else "AC"
    # Tramos: etiqueta T# junto a la mitad de cada tramo
    pp = [P(*q) for q in pts]
    ocupados = list(pp)  # vértices y etiquetas ya puestas, para no solapar
    for i, (a, b) in enumerate(zip(pp[:-1], pp[1:], strict=True), 1):
        if math.dist(a, b) < 2:
            continue
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln, dx / ln
        if ny < 0:
            nx, ny = -nx, -ny
        off = 5.5
        q = (mx + nx * off, my + ny * off)
        while any(math.dist(q, o) < 5.5 for o in ocupados) and off < 30:
            off += 2.5
            q = (mx + nx * off, my + ny * off)
        ocupados.append(q)
        ocupados.append((q[0] + 5, q[1]))
        lam.linea((mx, my), q, color)
        lam.circulo(q, 2.1, color, relleno="#ffffff")
        lam.texto(q, f"T{i}", 1.3, color, "centro", negrita=True)
        lam.texto((q[0] + 2.6, q[1] - 0.5), f"{largos[i - 1]:.2f} m".replace(".", ","), 1.15,
                  color)  # fmt: skip
    # Curvas: C# en cada cambio de dirección
    for j, c in enumerate(pp[1:-1], 1):
        lam.circulo(c, 0.9, color, relleno="#ffd54f")
        lam.texto((c[0] - 1.4, c[1] - 2.6), f"C{j}", 1.15, "TEXTO", "centro", negrita=True)
    # Tabla de tramos
    tx, ty = x0 + w - ancho_tabla, y0 + h
    cols = [("TRAMO", 10), ("RECORRIDO", 52), ("m", 12)]
    fila = 3.8
    xx = tx
    for t, cw in cols:
        lam.rect(xx, ty - fila, cw, fila, "CAJETIN", relleno="#d9d9d9")
        lam.texto((xx + cw / 2, ty - fila / 2), t, 1.2, "TEXTO", "centro", negrita=True)
        xx += cw
    yy = ty - fila
    for i, (dsc, lg) in enumerate(zip(desc, largos, strict=True), 1):
        xx = tx
        for (_t, cw), val in zip(cols, (f"T{i}", dsc, f"{lg:.2f}".replace(".", ",")), strict=True):
            lam.rect(xx, yy - fila, cw, fila, "CAJETIN")
            centro = cw < 20
            lam.texto((xx + (cw / 2 if centro else 0.8), yy - fila / 2), val, 1.05, "TEXTO",
                      "centro" if centro else "izq_medio")  # fmt: skip
            xx += cw
        yy -= fila
    for rot_, dsc, lg in extra:
        xx = tx
        for (_t, cw), val in zip(cols, (rot_, dsc, f"{lg:.2f}".replace(".", ",")), strict=True):
            lam.rect(xx, yy - fila, cw, fila, "CAJETIN", trazo="discontinuo")
            centro = cw < 20
            lam.texto((xx + (cw / 2 if centro else 0.8), yy - fila / 2), val, 1.05, "TEXTO",
                      "centro" if centro else "izq_medio")  # fmt: skip
            xx += cw
        yy -= fila
    total = sum(largos) + sum(e[2] for e in extra)
    lam.rect(tx, yy - fila, sum(c[1] for c in cols), fila, "CAJETIN", relleno="#f4f4f4")
    lam.texto((tx + 0.8, yy - fila / 2), f"TOTAL {total:.2f} m".replace(".", ","), 1.2,
              "TEXTO", "izq_medio", negrita=True)  # fmt: skip
    yy -= fila + 1.5
    nc = len(pts) - 2
    lineas = [t.format(nc=nc) for t in notas]
    for ln_ in lineas:
        lam.texto((tx, yy), ln_, 1.1, "TEXTO", "izq_medio")
        yy -= 2.7


def _suavizar(pts, radio=220.0, muestras=7):
    """Polilínea 3D con las esquinas reemplazadas por curvas (Bézier cuadrática ≈ arco)."""
    import numpy as np

    pts = [np.array(q, float) for q in pts]
    pts = [q for i, q in enumerate(pts) if i == 0 or np.linalg.norm(q - pts[i - 1]) > 1]
    out = [pts[0]]
    for a, b, c in zip(pts[:-2], pts[1:-1], pts[2:], strict=True):
        d1, d2 = b - a, c - b
        l1, l2 = np.linalg.norm(d1), np.linalg.norm(d2)
        if l1 < 1 or l2 < 1:
            continue
        r = min(radio, 0.45 * l1, 0.45 * l2)
        p0, p2 = b - d1 / l1 * r, b + d2 / l2 * r
        for t in np.linspace(0, 1, muestras):
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t**2 * p2)
    out.append(pts[-1])
    return [tuple(q) for q in out]


def tubo3d(lam, P, pts3d, diam, color, capa, abrazadera_mm=1000.0) -> None:
    """Tubería en el isométrico: curvas suaves, cuerpo con contorno, brillo y abrazaderas."""
    import numpy as np
    from shapely.geometry import LineString

    suave = _suavizar(pts3d)
    pts = [P(*q) for q in suave]
    ls = LineString(pts)
    cuerpo = ls.buffer(diam / 2, cap_style=2, join_style=1, quad_segs=8)
    lam.polilinea(list(cuerpo.exterior.coords), capa, cerrada=True, relleno=color)
    lam.polilinea([(x, y + diam * 0.18) for x, y in pts], "BRILLO")
    # Abrazaderas sobre los tramos rectos (cada ~1 m en 3D)
    for a, b in zip(pts3d[:-1], pts3d[1:], strict=True):
        a_, b_ = np.array(a, float), np.array(b, float)
        largo = np.linalg.norm(b_ - a_)
        for t in np.arange(abrazadera_mm, largo - 300, abrazadera_mm):
            q = a_ + (b_ - a_) * t / largo
            c, e = P(*q), P(*(q + (b_ - a_) / largo * 10))
            dx, dy = e[0] - c[0], e[1] - c[1]
            n = math.hypot(dx, dy) or 1
            nx, ny = -dy / n * diam * 0.75, dx / n * diam * 0.75
            lam.linea((c[0] - nx, c[1] - ny), (c[0] + nx, c[1] + ny), "SOMBRA")


def caja3d(lam, P, caja, color, capa) -> None:
    """Caja (x0, x1, y0, y1, z0, z1) con sus tres caras visibles sombreadas."""
    x0, x1, y0, y1, z0, z1 = caja

    def tono(hexa, f):
        r, g_, b = (int(hexa[i : i + 2], 16) for i in (1, 3, 5))
        return "#{:02x}{:02x}{:02x}".format(*(min(255, int(v * f)) for v in (r, g_, b)))

    caras = [
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], 0.85),  # cara +x
        ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], 0.95),  # cara +y
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], 1.08),  # tapa
    ]
    for pts, f in caras:
        lam.polilinea([P(*q) for q in pts], capa, cerrada=True, relleno=tono(color, f))


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
    lam.texto((x0 + 15 + 3665 * k / 2, y0 - 3.3), "3665 (entre filas)", 1.3, "COTA", "centro")
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
    """Alzado del balcón (pared lateral y frontal) con inversor, tablero FV, baterías y tuberías."""
    b = d["bat"]
    lam.rect(x, y, 110, 62, "CUBIERTA", relleno="#fbf6ee")
    lam.rect(x, y - 1.5, 110, 1.5, "CUBIERTA", relleno="#bdbdbd")  # piso del balcón
    lam.linea((x + 52, y), (x + 52, y + 62), "CUBIERTA", trazo="discontinuo")
    lam.texto((x + 26, y + 58), "PARED LATERAL DE BALCÓN", 1.4, "NOTA", "centro")
    lam.texto((x + 81, y + 58), "PARED FRONTAL DE BALCÓN", 1.4, "NOTA", "centro")
    # Equipos
    lam.rect(x + 14, y + 30, 20, 12, "AC", relleno="#e9eef3")
    lam.texto((x + 24, y + 44), "INVERSOR", 1.5, "TEXTO", "centro", negrita=True)
    lam.texto((x + 24, y + 36), d["inversor_modelo"], 1.1, "TEXTO", "centro")
    lam.rect(x + 60, y + 24, 12, 20, "EQUIPO", relleno="#e6e6e6")
    lam.texto((x + 66, y + 46), "T.A", 1.5, "TEXTO", "centro", negrita=True)
    lam.texto((x + 66, y + 34), "TABLERO FV", 1.0, "TEXTO", "centro")
    lam.rect(x + 4, y, 26, 16, "EQUIPO", relleno="#f6e0f6")
    lam.texto((x + 17, y + 11), "BATERÍAS", 1.8, "TEXTO", "centro", negrita=True)
    lam.texto((x + 17, y + 6), f"{b['n']} MÓDULOS · {_f(b['kwh'])} kWh", 1.2, "TEXTO", "centro")
    # Tuberías (dibujadas con su diámetro, curvas, uniones y abrazaderas)
    dc, ac, com = "#f6c9c4", "#cfe0f5", "#c7eef2"
    tubo(lam, [(x + 18, y + 62), (x + 18, y + 42)], 1.6, "DC", dc, abrazaderas=7)  # DC
    tubo(lam, [(x + 22, y + 30), (x + 22, y + 16)], 1.6, "DC", dc, abrazaderas=6)  # batería
    tubo(lam, [(x + 27, y + 30), (x + 27, y + 16)], 1.2, "COMUNIC", com)  # comunicaciones
    tubo(lam, [(x + 34, y + 36), (x + 60, y + 36)], 2.2, "AC", ac, abrazaderas=9)  # inv-tablero
    tubo(
        lam, [(x + 66, y + 44), (x + 66, y + 51), (x + 100, y + 51), (x + 100, y - 1.5)],
        2.6, "AC", ac, abrazaderas=8, uniones=17,
    )  # fmt: skip
    caja_paso(lam, (x + 100, y + 51), 3.2)
    _caja_texto(lam, (x - 2, y + 62), ['Coraza 1"', "Viene de fachada",
                                       "Cable FV 2x4 mm² +", "1N° 8 AWG Cu"],
                alinear="der")  # fmt: skip
    _guia(lam, (x + 18, y + 55), (x - 2, y + 58))
    _caja_texto(lam, (x + 36, y + 30), ["2 x [3N° 6 AWG (F) Cu", "1N° 6 AWG (N) Cu",
                                        "1N° 6 AWG (T) Cu - verde", 'Tubería 1½" ]'])  # fmt: skip
    _guia(lam, (x + 47, y + 36), (x + 47, y + 30))
    _caja_texto(lam, (x + 33, y + 14), ['Coraza 1" cable de baterías',
                                        'Coraza ¾" comunicaciones'], h=1.15)  # fmt: skip
    _guia(lam, (x + 27, y + 22), (x + 33, y + 12))
    _caja_texto(lam, (x + 103, y + 58), ["Caja de paso 10x10 cm IP66"], h=1.15)
    _guia(lam, (x + 100, y + 51), (x + 103, y + 56))
    _caja_texto(lam, (x + 103, y + 30), ["Hacia P.C. primer nivel", 'Tubería IMC 2"',
                                         "Abrazaderas c/ 1,5 m"], h=1.15)  # fmt: skip
    _guia(lam, (x + 100, y + 24), (x + 103, y + 27))
    lam.texto((x + 55, y - 5), fam_txt, 1.2, "NOTA", "centro")


def detalle_punto_conexion(lam, x, y) -> None:
    """Corte: bajante por fachada desde el balcón, pase en la cubierta del patio y tablero P.C."""
    ac = "#cfe0f5"
    lam.rect(x + 40, y, 4, 78, "CUBIERTA", relleno="#d9d4cb")  # fachada / columna
    lam.rect(x - 6, y + 44, 46, 2.0, "CUBIERTA", relleno="#9fb8d6")  # cubierta del patio
    lam.texto((x - 5, y + 47.5), "Cubierta existente del patio", 1.3, "NOTA")
    lam.rect(x + 44, y + 52, 30, 2, "CUBIERTA", relleno="#bdbdbd")  # losa del balcón
    lam.texto((x + 46, y + 56), "Balcón 2° piso", 1.3, "NOTA")
    tubo(
        lam, [(x + 60, y + 78), (x + 60, y + 66), (x + 38, y + 66), (x + 38, y + 50),
              (x + 30, y + 50), (x + 30, y + 22)],
        2.6, "AC", ac, abrazaderas=7, uniones=15,
    )  # fmt: skip
    caja_paso(lam, (x + 60, y + 66), 3.2)
    lam.circulo((x + 30, y + 45), 1.2, "ROJO", relleno="#c00000")
    lam.rect(x + 25, y + 8, 10, 14, "EQUIPO", relleno="#ffffff")
    for k in range(4):
        lam.linea((x + 27, y + 11 + k * 2.4), (x + 33, y + 11 + k * 2.4), "NOTA")
    lam.texto((x + 30, y + 4.5), "TABLERO P.C. · 1° PISO", 1.4, "TEXTO", "centro", negrita=True)
    _caja_texto(lam, (x + 64, y + 80), ["Viene del tablero FV (balcón)", 'Tubería IMC 2"'], h=1.2)
    _caja_texto(lam, (x + 64, y + 70), ["Caja de paso 10x10 cm IP66"], h=1.2)
    _guia(lam, (x + 61.6, y + 66), (x + 64, y + 68))
    _caja_texto(lam, (x + 48, y + 44), ["Bajante por fachada,", "adosada con abrazaderas"], h=1.2)
    _guia(lam, (x + 38, y + 58), (x + 48, y + 41))
    _caja_texto(lam, (x + 48, y + 34), ["Pase en cubierta", "existente del patio"], h=1.2)
    _guia(lam, (x + 31, y + 45), (x + 48, y + 31))
    _caja_texto(
        lam, (x - 8, y + 36),
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
    mods, az = colocar_alineado(g["cubierta"], obst, d["modulos"])
    orient = f"{az:.0f}° (paralelos a la cubierta), 10°"
    g["_modulos"] = mods
    info = CASAS[str(d["casa"])]
    conj = json.loads((INSUMOS / "primavera.json").read_text(encoding="utf-8"))
    b = d["bat"]
    fam_txt = f"Inversor {d['inversor_modelo']} · baterías {b['texto']} ({_f(b['kwh'])} kWh)"
    notas_base = [
        f"Sistema de {d['modulos']} módulos JA Solar JAM72D40 de 595 Wp ({_f(d['kwp'])} kWp) y un "
        f"inversor {d['inversor_modelo']}.",
        f"Estructura lastrada con bloques de concreto, módulos en una hilera paralela a la "
        f"cubierta, mirando a {az:.0f}° a 10°.",
        "Medidas en metros salvo indicación. Geometría según plano tipo: verificar en obra.",
        *SUPUESTOS,
    ]
    out: list[Lamina] = []
    total = 4

    def cerrar(lam, notas):
        lam.notas = notas
        cajetin.dibujar(
            lam, plantilla,
            datos_cajetin(d, lam, fecha, disenador, f"{lam.numero}/{total}", plantilla),
            validar.RAIZ,
        )  # fmt: skip
        out.append(lam)

    titulo_casa = f"CASA {d['casa']} - PRADO VERDE PRIMAVERA (MANZANA {info['manzana']})"
    L, ruta_dc, ruta_ac = rutas(g, mods)
    todo = g["lote"]

    # --- Hoja 1: localización, distribución de módulos, estructura y materiales -------------
    lam = _nueva(d, 1, "DIS", "Localización, distribución de módulos y materiales", fecha,
                 disenador, total, plantilla)  # fmt: skip
    lam.texto((14, 258), f"DISTRIBUCIÓN DE MÓDULOS · {titulo_casa}", 3.0, "TEXTO", negrita=True)
    mapa = INSUMOS / "primavera_mapa.png"
    mx, my, mw, mh = 14, 136, 84, 112
    lam.imagen(mapa, mx, my, mw, mh)
    lam.rect(mx, my, mw, mh, "CAJETIN")
    px, py = info["mapa"]
    cx, cy = mx + px / 414 * mw, my + mh - py / 550 * mh
    lam.circulo((cx, cy), 3.2, "ROJO")
    lam.circulo((cx, cy), 0.8, "ROJO", relleno="#c00000")
    lam.texto((cx + 4, cy + 2), f"CASA {d['casa']}", 1.6, "ROJO", negrita=True)
    _titulo_vista(lam, mx, my - 5, 1, "Localización en el conjunto")
    lam.texto((mx + 8, my - 9.5), f"Conjunto: {conj['lat']:.5f}, {conj['lon']:.5f}", 1.4, "NOTA")
    _resumen(lam, 14, 118, d, mods, ancho=84, orientacion=orient)
    m = Marco(todo, (100, 128, 150, 122), n_opciones=(75, 100, 125, 150))
    _casa_base(lam, m, g)
    _modulos(lam, m, mods)
    _equipos(lam, m, g)
    _norte(lam, 244, 248)
    _escala(lam, 104, 124, m.n)
    _titulo_vista(lam, 104, 118, 2, "Distribución de módulos", f"ESC 1:{m.n}")
    detalle_estructura(lam, 96, 62, d["modulos"])
    _titulo_vista(lam, 104, 100, 3, "Detalle estructura lastrada", "ESC 1:40 (cotas en mm)")
    tabla_materiales_compacta(lam, 256, 250, materiales_obra(d, L))
    cerrar(lam, notas_base + [
        "Materiales: cableado y canalización sobre la ruta del plano + 10 % de reserva.",
    ])  # fmt: skip

    # --- Hoja 2: rutas DC y AC en planta y detalle DC ---------------------------------------
    lam = _nueva(d, 2, "RUT", "Rutas de cableado DC y AC", fecha, disenador, total, plantilla)
    lam.texto((14, 258), f"RUTAS DE CABLEADO DC Y AC · {titulo_casa}", 3.0, "TEXTO", negrita=True)
    m = Marco(todo, (14, 70, 256, 176))
    _casa_base(lam, m, g)
    _modulos(lam, m, mods)
    _equipos(lam, m, g)
    cs = [md.centroid for md in mods]
    for a_, b_ in zip(cs[:-1], cs[1:], strict=True):
        lam.linea(m((a_.x + 300, a_.y - 500)), m((b_.x - 300, b_.y - 500)), "CONTROL")
    lam.polilinea([m(ruta_dc[0]), m((ruta_dc[0][0], cs[0].y))], "CONTROL", trazo="discontinuo")
    ruta_planta(lam, m, ruta_dc, "DC", "#f6c9c4", "DC-")
    caja_paso(lam, m(ruta_dc[0]), 2.4)
    lam.circulo(m(g["bajante_dc"]), 1.6, "DC")
    lam.texto(m(g["bajante_dc"]), "↓", 1.6, "DC", "centro", negrita=True)
    pc = g["bajante_ac"]
    ruta_planta(lam, m, ruta_ac, "AC", "#cfe0f5", "AC-")
    lam.circulo(m(pc), 1.6, "ROJO")
    lam.texto(m(pc), "↓", 1.6, "ROJO", "centro", negrita=True)
    _norte(lam, 258, 248)
    _escala(lam, 16, 70, m.n)
    _titulo_vista(lam, 16, 64, 1, "Rutas de cableado DC y AC", f"ESC 1:{m.n}")
    _caja_texto(lam, (278, 104), [
        "RUTA DC (rojo)",
        'Coraza 1" adosada a la cubierta, soportes c/ 1,5 m',
        "Cable FV 2x4 mm² (+/-) + 1N° 8 AWG Cu verde",
        f"Baja {L['dc_vertical']:.1f} m por el muro del balcón (↓)",
        f"Longitud total DC: {L['dc_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _caja_texto(lam, (278, 82), [
        "RUTA AC (azul)",
        'Tubería IMC 2", abrazaderas c/ 1,5 m',
        "2 x [3N° 6 AWG (F) + 1N° 6 (N) + 1N° 6 (T)] Cu",
        f"Baja {L['ac_bajante']:.1f} m por fachada al 1° piso (↓)",
        f"Longitud total AC: {L['ac_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _detalle_dc(lam, 278, 112, d)
    cerrar(lam, notas_base + [
        "Cable tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc para conductores DC.",
    ])  # fmt: skip

    # --- Hoja 3: esquema 3D, ubicación de equipos y punto de conexión -----------------------
    lam = _nueva(d, 3, "EQP", "Esquema 3D, ubicación de equipos y punto de conexión", fecha,
                 disenador, total, plantilla)  # fmt: skip
    lam.texto((14, 258), f"UBICACIÓN DE EQUIPOS Y PUNTO DE CONEXIÓN · {titulo_casa}", 3.0, "TEXTO",
              negrita=True)  # fmt: skip
    isometrico(lam, (14, 58, 196, 186), g, mods, d)
    _titulo_vista(lam, 16, 248, 1, "Esquema 3D de rutas DC (rojo) y AC (azul)", "SIN ESCALA")
    detalle_equipos(lam, 240, 178, d, fam_txt)
    _titulo_vista(lam, 214, 248, 2, "Detalle ubicación de equipos (balcón 2° piso)", "SIN ESCALA")
    detalle_punto_conexion(lam, 304, 62)
    _titulo_vista(lam, 214, 154, 3, "Detalle hasta el punto de conexión", "SIN ESCALA")
    cerrar(lam, notas_base + [
        "El cable AC se dimensiona con base al alimentador existente en calibre 6 AWG.",
        "Alturas supuestas: piso 2,8 m, cubierta 5,6 m, cubierta del patio 2,6 m.",
    ])  # fmt: skip

    # --- Hoja 4: detalles constructivos (estructura lastrada y rutas en 3D) ----------------
    lam = _nueva(d, 4, "DET", "Detalles de estructura lastrada y rutas DC / AC", fecha, disenador,
                 total, plantilla)  # fmt: skip
    lam.texto((14, 258), f"DETALLES CONSTRUCTIVOS · {titulo_casa}", 3.0, "TEXTO", negrita=True)
    _titulo_vista(lam, 16, 248, 1, f"Estructura lastrada: fila de {d['modulos']} módulos",
                  "SIN ESCALA (cotas en mm)")  # fmt: skip
    detalle_lastrada_3d(lam, (14, 150, 214, 92), d["modulos"])
    _titulo_vista(lam, 234, 248, 2, "Corte lateral de la estructura", "ESC 1:20 (cotas en mm)")
    corte_lastrada(lam, 236, 186)
    _titulo_vista(lam, 16, 146, 3, "Ruta DC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta3d(lam, (14, 58, 196, 84), g, mods, "dc")
    _titulo_vista(lam, 214, 146, 4, "Ruta AC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta3d(lam, (212, 58, 196, 84), g, mods, "ac")
    cerrar(lam, notas_base + [
        "Longitudes de tramo medidas sobre el eje de la tubería en el modelo 3D (sin reserva).",
        "Bloques de concreto esquemáticos: dimensiones, peso y cantidad según proveedor.",
    ])  # fmt: skip
    return out


def rutas(g, mods):
    """Rutas DC y AC en planta (mm) y longitudes en m (con los tramos verticales supuestos)."""
    cs = [md.centroid for md in mods]
    lleg = g["bajante_dc"]
    cerca = min(mods, key=lambda md: md.distance(Point(lleg)))
    x0 = cerca.centroid.x
    y_borde = cerca.bounds[3] + 250  # borde norte del arreglo
    ruta_dc = [(x0, y_borde), (x0, lleg[1] - 300), (lleg[0], lleg[1] - 300), lleg]
    tab = g["tablero"].centroid
    pc = g["bajante_ac"]
    ruta_ac = [(tab.x, tab.y), (tab.x, pc[1]), pc]

    def largo(r):
        return sum(math.dist(a, b) for a, b in zip(r[:-1], r[1:], strict=True)) / 1000

    # Longitudes de la ruta 3D (la misma que se dibuja y se tabula en la hoja 4)
    R = rutas3d(g, mods)

    def vertical(pts, desde=0):
        tramos = zip(pts[desde:-1], pts[desde + 1 :], strict=True)
        return sum(abs(q[2] - p_[2]) / 1000 for p_, q in tramos if abs(q[2] - p_[2]) > 1)

    L = {
        "dc_cubierta": largo(ruta_dc),
        "dc_vertical": vertical(R["dc"], 1),  # del borde de la cubierta al balcón e inversor
        "ac_balcon": largo(ruta_ac),
        "ac_bajante": vertical(R["ac"], 2),  # por fachada hasta el tablero P.C.
        "n_mod": len(cs),
        "dc_total": sum(_largos(R["dc"])),
        "ac_total": sum(_largos(R["ac"])),
        "curvas_ac": len(R["ac"]) - 2,
        "estructura": cantidades_estructura([_local(m_) for m_ in mods]),
    }
    return L, ruta_dc, ruta_ac


def materiales_obra(d, L) -> list[tuple]:
    """Listado de materiales por grupos: (grupo, descripción, unidad, cantidad, observación)."""
    n = d["modulos"]
    b = d["bat"]
    r = 1.10  # reserva de cableado y canalización

    def m_(x):
        return math.ceil(x * r)

    ldc, lac = L["dc_total"], L["ac_total"]
    cal, tub = L.get("cal_ac", "6"), L.get("tubo_ac", '2"')
    lnu = L.get("ac_nuevo", lac)  # tubería nueva (sin la existente)
    est = L.get("estructura") or {
        "bloques": 2 * (n + 1), "riel_m": 2 * n * 1.139, "mid_clamp": 2 * (n - 1),
        "end_clamp": 4, "fila_m": n * 1.139,
    }  # fmt: skip
    fila_m = est["fila_m"]
    return [
        ("GENERACIÓN FV", f"Módulo FV {d['modulo']['modelo']} 595 Wp", "und", n, "Ficha JA Solar"),
        ("", f"Inversor híbrido {d['inversor_modelo']}", "und", 1, "Incluye seccionador DC"),
        ("ALMACENAMIENTO", f"Batería {b['texto']} módulo {b['modulo']}", "und", b["n"], ""),
        ("", "BMS (torre 1) / top cover (torre 2)" if len(b["torres"]) > 1 else "BMS de la torre",
         "und", 1, ""),
        ("", "Estructura soporte para baterías", "und", 1,
         L.get("ubic_bat", "En el balcón, sobre el piso")),
        *(L.get("filas_estructura") or [
            ("ESTRUCTURA LASTRADA", "Kit de estructura lastrada 10° (por módulo)", "und", n,
             "Según detalle de la hoja 1"),
            ("", "Riel de aluminio para módulos", "m", math.ceil(est["riel_m"]),
             "2 rieles por tramo de fila"),
            ("", "Bloque de concreto (contrapeso)", "und", est["bloques"],
             "Estimado: verificar con cálculo de viento"),
            ("", "Mid clamp (con grounding)", "und", est["mid_clamp"], ""),
            ("", "End clamp (con grounding)", "und", est["end_clamp"], ""),
            ("", "Grounding lug para estructura", "und", 2, ""),
        ]),
        ("CABLEADO DC", "Cable FV PV 4 mm² 1,8 kVdc (rojo +)", "m", m_(ldc), "String S1.1.1"),
        ("", "Cable FV PV 4 mm² 1,8 kVdc (negro -)", "m", m_(ldc), ""),
        ("", "Cable Cu 8 AWG verde (tierra DC)", "m", m_(ldc + fila_m), "Equipotencialización"),
        ("", "Conector MC4 (par macho/hembra)", "par", 2, ""),
        ("", 'Coraza americana 1" (DC)', "m", m_(ldc), "Adosada a cubierta y fachada"),
        ("", "Caja de paso 10x10 cm IP66 (DC)", "und", 1, "Salida del arreglo"),
        ("CABLEADO AC", f"Cable Cu {cal} AWG THHN/THWN-2 (fases y neutro)", "m",
         m_(8 * lac + 8 * 1.5), "2 alimentadores x (3F + N)"),
        ("", f"Cable Cu {cal} AWG THHN/THWN-2 verde (tierra)", "m", m_(2 * lac + 2 * 1.5), ""),
        ("", f'Tubería IMC {tub} (tramos de 3 m)', "und", math.ceil(lnu * r / 3),
         L.get("obs_ac", f"{lac:.1f} m: balcón, bajante y 1° piso")),
        ("", f'Curva IMC {tub} 90°', "und", L.get("curvas_ac", 4), ""),
        ("", f'Unión IMC {tub}', "und", math.ceil(lnu * r / 3), ""),
        ("", f'Abrazadera IMC {tub} (c/ 1,5 m)', "und", math.ceil(lnu / 1.5) + 2, ""),
        ("", "Caja de paso 10x10 cm IP66 (AC)", "und", 2, ""),
        ("", 'Tubería 1½" inversor - tablero FV', "m", 2, ""),
        ("", "Tablero FV 15 kVA 220 V IP65 con componentes", "und", 1, "Según diagrama unifilar"),
        ("COMUNICACIONES", 'Coraza ¾" comunicaciones', "m", 3, ""),
        ("", 'Coraza 1" cable de baterías', "m", 2, ""),
        ("", "Cable UTP Cat 6", "m", 3, "Inversor - medidor"),
        ("", "Cable RS485 apantallado", "m", 3, "BMS / modem - medidor"),
        ("SEÑALIZACIÓN", "Kit de rótulos (A, B, H, I, J, K, L, N1, O, P, Q, S)", "und", 1,
         "Según unifilar"),
    ]  # fmt: skip


def tabla_materiales(lam, x, y, filas) -> None:
    cols = [("GRUPO", 46), ("ITEM", 10), ("DESCRIPCIÓN", 150), ("UND", 14), ("CANT.", 16),
            ("OBSERVACIÓN", 110)]  # fmt: skip
    h = 4.6
    xx = x
    for t, w in cols:
        lam.rect(xx, y - h, w, h, "CAJETIN", relleno="#d9d9d9")
        lam.texto((xx + w / 2, y - h / 2), t, 1.6, "TEXTO", "centro", negrita=True)
        xx += w
    yy = y - h
    for i, (grupo, desc, und, cant, obs) in enumerate(filas, 1):
        xx = x
        for (_, w), v in zip(cols, (grupo, i, desc, und, cant, obs), strict=True):
            lam.rect(xx, yy - h, w, h, "CAJETIN", relleno="#f4f4f4" if grupo else None)
            centro = w < 20
            lam.texto(
                (xx + (w / 2 if centro else 1.2), yy - h / 2), str(v), 1.45, "TEXTO",
                "centro" if centro else "izq_medio", negrita=bool(grupo) and v == grupo,
            )  # fmt: skip
            xx += w
        yy -= h


def tabla_materiales_compacta(lam, x, y, filas) -> None:
    """Listado de materiales con los grupos como filas de título (para la hoja 1)."""
    cols = [("ITEM", 7), ("DESCRIPCIÓN", 96), ("UND", 9), ("CANT.", 10), ("OBS.", 28)]
    h = 3.3
    lam.texto((x, y + 2), "LISTADO DE MATERIALES", 2.0, "TEXTO", negrita=True)
    xx = x
    for t, w in cols:
        lam.rect(xx, y - h, w, h, "CAJETIN", relleno="#d9d9d9")
        lam.texto((xx + w / 2, y - h / 2), t, 1.3, "TEXTO", "centro", negrita=True)
        xx += w
    ancho = sum(w for _, w in cols)
    yy = y - h
    for i, (grupo, desc, und, cant, obs) in enumerate(filas, 1):
        if grupo:
            lam.rect(x, yy - h, ancho, h, "CAJETIN", relleno="#eeeeee")
            lam.texto((x + 1.2, yy - h / 2), grupo, 1.3, "TEXTO", "izq_medio", negrita=True)
            yy -= h
        xx = x
        for (_, w), v in zip(cols, (i, desc, und, cant, obs), strict=True):
            lam.rect(xx, yy - h, w, h, "CAJETIN")
            centro = w < 12
            tam = 1.2 if w > 30 else (0.95 if w == 28 else 1.2)
            lam.texto(
                (xx + (w / 2 if centro else 0.8), yy - h / 2), str(v)[: int(w / (tam * 0.6))],
                tam, "TEXTO", "centro" if centro else "izq_medio",
            )  # fmt: skip
            xx += w
        yy -= h


def _resumen(
    lam, x, y, d, mods, ancho=74, orientacion="Sur (180°), 10°", estructura="Lastrada, bloques"
) -> None:
    filas = [
        ("Módulos", f"{len(mods)} × JAM72D40-595/MB"),
        ("Potencia DC", f"{_f(d['kwp'])} kWp"),
        ("Inversor", d["inversor_modelo"]),
        ("Strings", " + ".join(f"1 × {n} mód." for n in d["strings"])),
        ("Baterías", f"{d['bat']['n']} × {d['bat']['modulo']}"),
        ("Orientación", orientacion),
        ("Estructura", estructura),
    ]
    lam.rect(x, y - 4 - len(filas) * 3.6, ancho, 4 + len(filas) * 3.6, "CAJETIN")
    lam.texto((x + ancho / 2, y - 2), "RESUMEN DEL SISTEMA", 1.7, "TEXTO", "centro", negrita=True)
    for i, (k, v) in enumerate(filas):
        yy = y - 6 - i * 3.6
        lam.texto((x + 2, yy), k, 1.4, "NOTA")
        lam.texto((x + 26, yy), v, 1.4, "TEXTO")


def _detalle_dc(lam, x, y, d, bajante="Bajante hacia balcón 2° piso") -> None:
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
            bajante,
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
