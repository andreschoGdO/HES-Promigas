"""Ingeniería tipo de las casas del Condominio Doral (Cartagena), cajetín Promigas, 3 hojas A3.

1. Localización, distribución de módulos (lastrada 10° al sur), estructura y materiales.
2. Rutas DC y AC en planta (cubierta y patio) y detalle DC.
3. Esquema 3D de rutas, detalle de equipos (fachada posterior) y detalle hasta el tablero.

Casa tipo: dos pisos con losa de concreto (acta de visita casa I10). Equipos en el muro posterior,
en el patio del 1° piso; la DC baja por la fachada posterior; la AC sube por la fachada posterior,
cruza la cubierta hasta la bajante del frente y baja al tablero de distribución interno (≈ 19 m,
acta). Las medidas de la vivienda se estiman de las fotos aéreas (SUPUESTOS).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from shapely import affinity
from shapely.geometry import Point, box

from engine import validar
from engine.planos import cajetin
from engine.planos.casas_primavera import (
    INSUMOS,
    Marco,
    _caja_texto,
    _detalle_dc,
    _escala,
    _guia,
    _modulos,
    _norte,
    _resumen,
    _suavizar,
    _titulo_vista,
    caja_paso,
    colocar_modulos,
    detalle_estructura,
    materiales_obra,
    ruta_planta,
    tabla_materiales_compacta,
    tubo,
    tubo3d,
)
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

# ------------------------------------------------------------------------------- casa tipo
FRENTE, FONDO, PATIO = 7000.0, 10000.0, 5000.0  # mm (estimados de las fotos aéreas)
Z_PISO, Z_LOSA, PRETIL = 2800.0, 5800.0, 400.0
AZ_FRENTE = 135.0  # la fachada principal mira al SE (acta: orientación de la cubierta SE)
SUPUESTOS = [
    f"Vivienda tipo de {FRENTE / 1000:.1f} × {FONDO / 1000:.1f} m (estimado de fotos aéreas), "
    "fachada principal al SE: verificar en obra.",
    "Alturas supuestas: entrepiso 2,8 m, losa de cubierta 5,8 m, pretil 0,4 m.",
]
# Obstáculos de la cubierta (foto de la casa I10): lámina traslúcida, condensadoras y extractores
LAMINA = box(4300, -8300, 6700, -6700)
CONDENSADORAS = [box(4600, -9400, 5400, -9100), box(6250, -6600, 6600, -5800)]
EXTRACTORES = [Point(1700, -8600).buffer(250), Point(2600, -8400).buffer(250),
               Point(3500, -8700).buffer(250)]  # fmt: skip
# Equipos en el muro posterior (y = -FONDO), vistos desde el patio
EQ = {
    "baterias": (900, 1750, -FONDO - 220, -FONDO, 0, 900),
    "inversor": (2050, 2450, -FONDO - 240, -FONDO, 1100, 1700),
    "tablero": (2800, 3200, -FONDO - 200, -FONDO, 800, 1600),
}
X_BAJANTE_AC = 1500.0  # bajante AC en el frente (foto: círculo amarillo)


def _norte_arriba(geom):
    """Del marco local (y hacia el frente) al marco con el norte arriba."""
    return affinity.rotate(geom, -AZ_FRENTE, origin=(0, 0))


def geometria() -> dict[str, Any]:
    loc = {
        "lote": box(0, -FONDO - PATIO, FRENTE, 0),
        "cubierta": box(0, -FONDO, FRENTE, 0),
        "util": box(150, -FONDO + 150, FRENTE - 150, -150),
        "patio": box(0, -FONDO - PATIO, FRENTE, -FONDO),
        "lamina": LAMINA,
        "obst": [LAMINA, *CONDENSADORAS, *EXTRACTORES],
        "condensadoras": CONDENSADORAS,
        "extractores": EXTRACTORES,
    }
    for k, (x0, x1, y0, y1, _z0, _z1) in EQ.items():
        loc[k] = box(x0, y0, x1, y1)
    return loc


def a_norte(loc):
    g = {}
    for k, v in loc.items():
        g[k] = [_norte_arriba(o) for o in v] if isinstance(v, list) else _norte_arriba(v)
    return g


def modulos(loc, n: int):
    """Módulos en el marco norte-arriba, en el marco local y su azimut.

    Primero al sur (lastrada 10°); si no caben, filas paralelas a la cubierta mirando a la
    fachada principal (SE, AZ_FRENTE), que es la orientación de la losa según el acta.
    """
    g = a_norte(loc)
    try:
        mods_n = colocar_modulos(g["util"], g["obst"], n, retiro=250.0)
        mods_l = [affinity.rotate(m, AZ_FRENTE, origin=(0, 0)) for m in mods_n]
        return mods_n, mods_l, 180.0
    except ValueError:
        mods_l = colocar_modulos(loc["util"], loc["obst"], n, retiro=250.0)
        mods_n = [_norte_arriba(m) for m in mods_l]
        return mods_n, mods_l, AZ_FRENTE


X_DC, X_AC = 1000.0, 500.0  # carriles libres en la losa y bajantes en la fachada posterior
Z_DC_H, Z_AC_H = 1950.0, 2300.0  # tramos horizontales sobre la fachada posterior


def rutas(loc, mods_l):
    """Rutas 3D (mm, marco local) y longitudes (m). Van por carriles libres de la losa."""
    zr = Z_LOSA + 80
    y_post = -FONDO + 250  # junto al pretil posterior, por dentro
    zp = Z_LOSA + PRETIL + 120
    izq = min(mods_l, key=lambda m: (m.bounds[0], m.bounds[1]))  # módulo posterior izquierdo
    xs, ys = izq.bounds[0], izq.bounds[1] + 400
    inv = EQ["inversor"]
    xi = (inv[0] + inv[1]) / 2
    dc = [
        (xs, ys, Z_LOSA + 330), (xs, ys, zr), (X_DC, ys, zr), (X_DC, y_post, zr),
        (X_DC, y_post, zp),
        (X_DC, -FONDO - 90, zp), (X_DC, -FONDO - 90, Z_DC_H), (xi, -FONDO - 90, Z_DC_H),
        (xi, -FONDO - 90, inv[5]),
    ]  # fmt: skip
    tab = EQ["tablero"]
    xt = (tab[0] + tab[1]) / 2
    ac = [
        (xt, -FONDO - 100, tab[5]), (xt, -FONDO - 100, Z_AC_H), (X_AC, -FONDO - 100, Z_AC_H),
        (X_AC, -FONDO - 100, zp + 30), (X_AC, y_post, zp + 30), (X_AC, y_post, zr),
        (X_AC, -300, zr), (X_BAJANTE_AC, -300, zr), (X_BAJANTE_AC, -300, zp + 30),
        (X_BAJANTE_AC, 100, zp + 30), (X_BAJANTE_AC, 100, 1500), (X_BAJANTE_AC + 600, 100, 1500),
    ]  # fmt: skip

    def largo(r):
        return sum(math.dist(a, b) for a, b in zip(r[:-1], r[1:], strict=True)) / 1000

    L = {"dc_total": largo(dc), "ac_total": largo(ac) + 1.5, "dc_vertical": (Z_LOSA - 1950) / 1000,
         "ac_bajante": (Z_LOSA - 1500) / 1000, "ubic_bat": "En el patio, junto al muro posterior",
         "obs_ac": "Fachada posterior, cubierta, bajante del frente y tablero interno"}  # fmt: skip
    L["obs_ac"] = f"{L['ac_total']:.1f} m: " + L["obs_ac"]
    return dc, ac, L


# ------------------------------------------------------------------------------- planta
def _planta(lam, m: Marco, g, mods_n, rotulos=True) -> None:
    def pol(o, capa, rel=None, trazo="continuo"):
        m.pol(lam, o, capa, rel, trazo)

    pol(g["lote"], "CUBIERTA", "#f4f1ea")
    pol(g["patio"], "NOTA", "#eef5e8")
    pol(g["cubierta"], "CUBIERTA", "#ecebe6")
    pol(g["util"], "NOTA", None, "discontinuo")
    pol(g["lamina"], "NOTA", "#e4eef7")
    for o in g["condensadoras"]:
        pol(o, "NOTA", "#ffffff")
    for o in g["extractores"]:
        pol(o, "NOTA", "#ffffff")
    for k, col in (("baterias", "#d873d8"), ("inversor", "#bfe3f7"), ("tablero", "#4a4a4a")):
        pol(g[k], "EQUIPO", col)
    _modulos(lam, m, mods_n)
    if rotulos:
        for o, t in ((g["patio"], "PATIO 1° PISO"), (g["lamina"], "LÁMINA TRASLÚCIDA")):
            lam.texto(m(o.centroid), t, 1.4 if "LÁMINA" in t else 2.0, "NOTA", "centro")
        for o in g["condensadoras"]:
            lam.texto(m(o.centroid), "AA", 1.0, "NOTA", "centro")
        frente = _norte_arriba(Point(FRENTE / 2, 900))
        lam.texto(m(frente), "FACHADA PRINCIPAL (VÍA)", 1.6, "NOTA", "centro",
                  rotacion=-AZ_FRENTE + 180)  # fmt: skip
        cub = _norte_arriba(Point(1300, -2500))
        lam.texto(m(cub), "LOSA DE CUBIERTA", 1.7, "NOTA", "centro")


# ------------------------------------------------------------------------------- 3D
def isometrico(lam, area, loc, mods_l, dc, ac, az=180.0) -> None:
    x0, y0, w, h = area
    V = np.array([1.0, -1.25, 1.1])
    V /= np.linalg.norm(V)
    der = np.cross([0, 0, 1], V)
    der /= np.linalg.norm(der)
    arr = np.cross(V, der)

    def proy(x, y, z):
        q = np.array([x, y, z])
        return (float(q @ der), float(q @ arr))

    esquinas = [proy(x, y, z) for x in (0, FRENTE) for y in (-FONDO - PATIO, 0)
                for z in (0, Z_LOSA + PRETIL + 600)]  # fmt: skip
    us, vs = [p[0] for p in esquinas], [p[1] for p in esquinas]
    k = min((w - 8) / (max(us) - min(us)), (h - 8) / (max(vs) - min(vs)))
    ox = x0 + (w - (max(us) - min(us)) * k) / 2 - min(us) * k
    oy = y0 + (h - (max(vs) - min(vs)) * k) / 2 - min(vs) * k

    def P(x, y, z):
        u, v = proy(x, y, z)
        return (ox + u * k, oy + v * k)

    def caja(bx, color, capa="CUBIERTA"):
        xa, xb, ya, yb, za, zb = bx
        caras = [
            ((0, 0, 1), [(xa, ya, zb), (xb, ya, zb), (xb, yb, zb), (xa, yb, zb)], 1.0),
            ((0, -1, 0), [(xa, ya, za), (xb, ya, za), (xb, ya, zb), (xa, ya, zb)], 0.9),
            ((1, 0, 0), [(xb, ya, za), (xb, yb, za), (xb, yb, zb), (xb, ya, zb)], 0.8),
            ((-1, 0, 0), [(xa, ya, za), (xa, yb, za), (xa, yb, zb), (xa, ya, zb)], 0.8),
            ((0, 1, 0), [(xa, yb, za), (xb, yb, za), (xb, yb, zb), (xa, yb, zb)], 0.9),
        ]
        for nrm, pts, f in caras:
            if np.dot(nrm, V) > 1e-6:
                r, g_, b = (int(color[i : i + 2], 16) for i in (1, 3, 5))
                rel = "#{:02x}{:02x}{:02x}".format(*(min(255, int(c * f)) for c in (r, g_, b)))
                lam.polilinea([P(*q) for q in pts], capa, cerrada=True, relleno=rel)

    # Suelo del lote, patio y casas vecinas (contexto)
    lam.polilinea([P(x, y, 0) for x, y in ((-1500, -FONDO - PATIO), (FRENTE + 1500, -FONDO - PATIO),
                   (FRENTE + 1500, 2500), (-1500, 2500))], "NOTA", cerrada=True,
                  relleno="#e2e8da")  # fmt: skip
    caja((FRENTE, FRENTE + 1500, -FONDO, 0, 0, Z_LOSA), "#e6e3dc", "NOTA")  # vecina derecha
    caja((0, FRENTE, -FONDO, 0, 0, Z_LOSA), "#efece5")  # casa
    # Pretil (anillo) y obstáculos
    for bx in ((0, FRENTE, -FONDO, -FONDO + 150, Z_LOSA, Z_LOSA + PRETIL),
               (0, 150, -FONDO, 0, Z_LOSA, Z_LOSA + PRETIL),
               (FRENTE - 150, FRENTE, -FONDO, 0, Z_LOSA, Z_LOSA + PRETIL),
               (0, FRENTE, -150, 0, Z_LOSA, Z_LOSA + PRETIL)):  # fmt: skip
        caja(bx, "#e3dfd7")
    lx0, ly0, lx1, ly1 = LAMINA.bounds
    caja((lx0, lx1, ly0, ly1, Z_LOSA, Z_LOSA + 250), "#dfeaf3", "NOTA")
    for c in CONDENSADORAS:
        a, b_, c_, d_ = c.bounds
        caja((a, c_, b_, d_, Z_LOSA, Z_LOSA + 650), "#f7f7f7", "NOTA")
    for e in EXTRACTORES:
        cx, cy = e.centroid.x, e.centroid.y
        caja((cx - 200, cx + 200, cy - 200, cy + 200, Z_LOSA, Z_LOSA + 350), "#f2f2f2", "NOTA")
    # Módulos (lastrada 10°): el borde bajo hacia el azimut de los módulos
    fa = math.radians(az)
    f = affinity.rotate(Point(math.sin(fa), math.cos(fa)), AZ_FRENTE, origin=(0, 0))
    for md in mods_l:
        pts = list(md.exterior.coords)[:4]
        ds = [x * f.x + y * f.y for x, y in pts]
        dmin, dmax = min(ds), max(ds)
        lam.polilinea([P(x, y, Z_LOSA + 330 + (dmax - dd) / (dmax - dmin or 1) * 380)
                       for (x, y), dd in zip(pts, ds, strict=True)], "MODULO", cerrada=True,
                      relleno="#7fb3e6")  # fmt: skip
    # Equipos sobre el muro posterior
    for key, col, capa in (("baterias", "#e9c4ea", "EQUIPO"), ("inversor", "#dbe9f6", "AC"),
                           ("tablero", "#d9d9d9", "EQUIPO")):  # fmt: skip
        caja(EQ[key], col, capa)
    # Rutas: visibles en color; el tramo por la fachada principal (no visible) en discontinuo
    tubo3d(lam, P, dc, 1.6, "#e74c3c", "DC")
    i_oc = next(i for i, q in enumerate(ac) if q[1] > 0)  # sale al frente
    tubo3d(lam, P, ac[: i_oc + 1], 1.9, "#2e86de", "AC")
    oculto = [P(*q) for q in _suavizar(ac[i_oc - 1 :])]
    lam.polilinea(oculto, "AC", trazo="discontinuo")
    tab_int = P(*ac[-1])
    rot = [
        (P(*dc[1]), "Arreglo FV · salida string S1.1.1", -1),
        (P(X_DC, -FONDO - 90, 4000), 'DC: coraza 1" baja por la fachada posterior', -1),
        (P(*dc[-1]), "Inversor (muro posterior, patio)", -1),
        (P(1300, -FONDO - 110, 500), "Baterías", -1),
        (P(3000, -FONDO - 100, 1200), "Tablero FV", 1),
        (P(X_AC, -FONDO - 100, 3600), 'AC: IMC 2" sube por la fachada posterior', -1),
        (P(X_AC, -5000, Z_LOSA + 80), "AC por la losa, junto al pretil", 1),
        (P(*ac[8]), "Bajante AC por fachada principal (oculta)", 1),
        (tab_int, "Al tablero interno (P.C.), fachada principal", 1),
    ]
    for lado, xcol in ((-1, x0 + 48), (1, x0 + w - 58)):
        items = sorted(((p, t) for p, t, s in rot if s == lado), key=lambda it: -it[0][1])
        y_prev = None
        for p, t in items:
            yq = p[1] + 3 if y_prev is None else min(p[1] + 3, y_prev - 6.5)
            y_prev = yq
            _guia(lam, p, (xcol, yq))
            _caja_texto(lam, (xcol, yq + 1.6), [t], h=1.3, alinear="der" if lado < 0 else "izq")
    lam.texto((x0 + 2, y0 + 2), "Alturas supuestas: entrepiso 2,8 m; losa 5,8 m; pretil 0,4 m. "
              "Esquema sin escala.", 1.3, "NOTA")  # fmt: skip


# ------------------------------------------------------------------------------- detalles
def detalle_equipos(lam, x, y, d) -> None:
    """Alzado del muro posterior (patio) con baterías, inversor, tablero FV y tuberías."""
    b = d["bat"]
    k = 1 / 75
    W, H = FRENTE * k, (Z_LOSA + PRETIL) * k
    lam.rect(x, y, W, H, "CUBIERTA", relleno="#fbf6ee")
    lam.rect(x - 3, y - 1.2, W + 6, 1.2, "CUBIERTA", relleno="#bdbdbd")
    lam.linea((x, y + Z_PISO * k), (x + W, y + Z_PISO * k), "NOTA", trazo="discontinuo")
    lam.texto((x + W - 1, y + Z_PISO * k + 1), "Entrepiso", 1.1, "NOTA", "der")
    lam.texto((x + W / 2, y + H + 1.5), "FACHADA POSTERIOR (PATIO 1° PISO)", 1.4, "NOTA", "centro")

    def r(bx, col, capa, t1, t2=""):
        x0, x1, _, _, z0, z1 = bx
        lam.rect(x + x0 * k, y + z0 * k, (x1 - x0) * k, (z1 - z0) * k, capa, relleno=col)
        lam.texto((x + (x0 + x1) / 2 * k, y + (z0 + z1) / 2 * k), t1, 0.95, "TEXTO", "centro",
                  negrita=True)  # fmt: skip
        if t2:
            lam.texto((x + (x0 + x1) / 2 * k, y + z0 * k - 1.6), t2, 0.85, "TEXTO", "centro")

    r(EQ["baterias"], "#f6e0f6", "EQUIPO", "BAT.", f"{b['n']} mód. · {_f(b['kwh'])} kWh")
    r(EQ["inversor"], "#e9eef3", "AC", "INV.")
    r(EQ["tablero"], "#e6e6e6", "EQUIPO", "T.FV")
    inv, tab = EQ["inversor"], EQ["tablero"]
    xi, xt = (inv[0] + inv[1]) / 2, (tab[0] + tab[1]) / 2
    tubo(lam, [(x + X_DC * k, y + H + 2), (x + X_DC * k, y + Z_DC_H * k),
               (x + xi * k, y + Z_DC_H * k), (x + xi * k, y + inv[5] * k)],
         1.0, "DC", "#f6c9c4", abrazaderas=6)  # fmt: skip
    tubo(lam, [(x + xt * k, y + tab[5] * k), (x + xt * k, y + Z_AC_H * k),
               (x + X_AC * k, y + Z_AC_H * k), (x + X_AC * k, y + H + 2)],
         1.3, "AC", "#cfe0f5", abrazaderas=6, uniones=14)  # fmt: skip
    tubo(lam, [(x + inv[1] * k, y + 1400 * k), (x + tab[0] * k, y + 1400 * k)], 1.1, "AC",
         "#cfe0f5")  # fmt: skip
    tubo(lam, [(x + 1500 * k, y + 900 * k), (x + 1500 * k, y + 1250 * k),
               (x + inv[0] * k, y + 1250 * k)], 0.9, "DC", "#f6c9c4")  # fmt: skip
    caja_paso(lam, (x + X_AC * k, y + Z_AC_H * k), 2.0)
    _caja_texto(lam, (x + W + 2, y + H + 2), ['DC: coraza 1" desde la losa',
                "Cable FV 2x4 mm² + 1N° 8 AWG Cu"], h=1.1)  # fmt: skip
    _guia(lam, (x + X_DC * k, y + H - 6), (x + W + 2, y + H - 1))
    _caja_texto(lam, (x + W + 2, y + H - 6), ['AC: IMC 2" sube a la losa',
                "2 x [3N° 6 + 1N° 6 (N) + 1N° 6 (T)] Cu"], h=1.1)  # fmt: skip
    _guia(lam, (x + X_AC * k, y + H - 12), (x + W + 2, y + H - 9))
    _caja_texto(lam, (x + W + 2, y + Z_AC_H * k + 2), ["Caja de paso 10x10 cm IP66"], h=1.1)
    _guia(lam, (x + X_AC * k, y + Z_AC_H * k), (x + W + 2, y + Z_AC_H * k))
    _caja_texto(lam, (x + W + 2, y + 1400 * k), ['Coraza 1" cable de baterías',
                'Coraza ¾" comunicaciones', f"Inversor {d['inversor_modelo']}"], h=1.1)  # fmt: skip


def detalle_punto_conexion(lam, x, y) -> None:
    """Corte por la fachada principal: bajante AC desde la cubierta al tablero interno."""
    k = 1 / 90
    H = (Z_LOSA + PRETIL) * k
    lam.rect(x + 30, y, 3, H, "CUBIERTA", relleno="#d9d4cb")  # fachada principal
    lam.rect(x, y + Z_LOSA * k - 2, 33, 2, "CUBIERTA", relleno="#bdbdbd")  # losa
    lam.rect(x, y + Z_PISO * k - 1.5, 30, 1.5, "CUBIERTA", relleno="#cfcfcf")  # entrepiso
    lam.rect(x + 30, y + Z_LOSA * k, 3, PRETIL * k, "CUBIERTA", relleno="#d9d4cb")
    lam.texto((x + 2, y + Z_LOSA * k + 1), "Losa de cubierta", 1.2, "NOTA")
    lam.texto((x + 2, y + Z_PISO * k + 0.6), "Entrepiso", 1.2, "NOTA")
    lam.texto((x + 40, y + 2), "VÍA / ANTEJARDÍN", 1.2, "NOTA", "centro")
    tubo(lam, [(x + 14, y + (Z_LOSA + 80) * k), (x + 28, y + (Z_LOSA + 80) * k),
               (x + 28, y + (Z_LOSA + PRETIL + 140) * k), (x + 36, y + (Z_LOSA + PRETIL + 140) * k),
               (x + 36, y + 1500 * k), (x + 29, y + 1500 * k)],
         1.8, "AC", "#cfe0f5", abrazaderas=8, uniones=18)  # fmt: skip
    lam.rect(x + 23, y + 1100 * k, 6, 900 * k, "EQUIPO", relleno="#ffffff")
    for i in range(4):
        lam.linea((x + 24, y + 1200 * k + i * 1.8), (x + 28, y + 1200 * k + i * 1.8), "NOTA")
    lam.circulo((x + 32.5, y + 1500 * k), 1.1, "ROJO", relleno="#c00000")
    _caja_texto(lam, (x + 40, y + H + 2),
                ["Viene por la cubierta desde la", 'fachada posterior (IMC 2")'],
                h=1.15)  # fmt: skip
    _caja_texto(lam, (x + 40, y + H * 0.6),
                ["Bajante AC por fachada principal", "adosada con abrazaderas"],
                h=1.15)  # fmt: skip
    _guia(lam, (x + 36, y + H * 0.55), (x + 40, y + H * 0.6 - 2))
    _caja_texto(lam, (x + 40, y + 1500 * k + 1),
                ["Pase por muro al tablero", "de distribución interno (P.C.)"],
                h=1.15)  # fmt: skip
    _guia(lam, (x + 32.5, y + 1500 * k), (x + 40, y + 1500 * k - 1))
    lam.texto((x + 15, y + 1100 * k - 3), "TABLERO INTERNO", 1.2, "TEXTO", "centro", negrita=True)


# ------------------------------------------------------------------------------- láminas
def laminas(d: dict[str, Any], fecha: str, disenador: str = "") -> list[Lamina]:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "cajetin.json")
    loc = geometria()
    g = a_norte(loc)
    mods_n, mods_l, az = modulos(loc, d["modulos"])
    orient = f"{'Sur' if az == 180 else 'Sureste'} ({az:.0f}°), 10°"
    dc, ac, L = rutas(loc, mods_l)
    conj = json.loads((INSUMOS / "doral.json").read_text(encoding="utf-8"))
    titulo = f"CASA {d['casa']} - CONDOMINIO DORAL (INGENIERÍA TIPO)"
    notas = [
        f"Sistema de {d['modulos']} módulos JA Solar de 595 Wp ({_f(d['kwp'])} kWp) y un inversor "
        f"{d['inversor_modelo']}.",
        f"Estructura lastrada con bloques de concreto sobre losa: {orient}"
        + ("" if az == 180 else " (al sur no caben; filas paralelas a la losa)")
        + ".",
        "AC al tablero de distribución interno (≈ 19 m según acta de visita).",
        *SUPUESTOS,
    ]
    out: list[Lamina] = []
    total = 3

    def nueva(n, tipo, titulo_lam):
        return Lamina(n, codigo_plano(d, tipo, n), titulo_lam, disciplina="ELE", tipo=tipo,
                      escala="INDICADA", unidad="m")  # fmt: skip

    def cerrar(lam, extra=()):
        lam.notas = notas + list(extra)
        cajetin.dibujar(lam, plantilla, datos_cajetin(d, lam, fecha, disenador,
                        f"{lam.numero}/{total}", plantilla), validar.RAIZ)  # fmt: skip
        out.append(lam)

    def proyectar(pts3d):
        return [tuple(_norte_arriba(Point(x, y)).coords[0]) for x, y, _z in pts3d]

    # --- Hoja 1 ----------------------------------------------------------------------------
    lam = nueva(1, "DIS", "Localización, distribución de módulos y materiales")
    lam.texto((14, 258), f"DISTRIBUCIÓN DE MÓDULOS · {titulo}", 3.0, "TEXTO", negrita=True)
    foto = INSUMOS / "doral_ubicacion_equipos.png"
    lam.imagen(foto, 14, 172, 104, 104 * 370 / 589)
    lam.rect(14, 172, 104, 104 * 370 / 589, "CAJETIN")
    _titulo_vista(lam, 14, 166, 1, "Localización (vista aérea de referencia)")
    lam.texto(
        (22, 161.5), f"Conjunto: {conj['lat']:.5f}, {conj['lon']:.5f} · Cartagena", 1.4, "NOTA"
    )
    _resumen(lam, 14, 156, d, mods_n, ancho=104, orientacion=orient)
    m = Marco(g["lote"], (120, 104, 132, 150), n_opciones=(100, 125, 150))
    _planta(lam, m, g, mods_n)
    _norte(lam, 246, 248)
    _escala(lam, 124, 104, m.n)
    _titulo_vista(lam, 124, 98, 2, "Distribución de módulos", f"ESC 1:{m.n}")
    por_fila = max(sum(1 for m_ in mods_l if abs(m_.bounds[1] - o.bounds[1]) < 1) for o in mods_l)
    detalle_estructura(lam, 96, 62, por_fila)
    _titulo_vista(
        lam, 14, 92, 3, "Detalle estructura lastrada (por fila)", "ESC 1:40 (cotas en mm)"
    )
    tabla_materiales_compacta(lam, 256, 250, materiales_obra(d, L))
    cerrar(lam, ["Materiales: cableado y canalización sobre la ruta + 10 % de reserva."])

    # --- Hoja 2 ----------------------------------------------------------------------------
    lam = nueva(2, "RUT", "Rutas de cableado DC y AC")
    lam.texto((14, 258), f"RUTAS DE CABLEADO DC Y AC · {titulo}", 3.0, "TEXTO", negrita=True)
    m = Marco(g["lote"], (14, 66, 256, 182), n_opciones=(75, 100, 125))
    _planta(lam, m, g, mods_n)
    dc_p, ac_p = proyectar(dc[1:6]), proyectar(ac[3:10])
    ruta_planta(lam, m, dc_p, "DC", "#f6c9c4", "DC-")
    ruta_planta(lam, m, ac_p, "AC", "#cfe0f5", "AC-")
    caja_paso(lam, m(dc_p[0]), 2.4)
    for p, t, capa in ((dc_p[-1], "↓", "DC"), (ac_p[0], "↑", "AC"), (ac_p[-1], "↓", "ROJO")):
        lam.circulo(m(p), 1.6, capa)
        lam.texto(m(p), t, 1.6, capa, "centro", negrita=True)
    _norte(lam, 258, 248)
    _escala(lam, 16, 66, m.n)
    _titulo_vista(lam, 16, 60, 1, "Rutas de cableado DC y AC", f"ESC 1:{m.n}")
    _caja_texto(lam, (278, 104), [
        "RUTA DC (rojo)", 'Coraza 1" adosada a la losa, soportes c/ 1,5 m',
        "Cable FV 2x4 mm² (+/-) + 1N° 8 AWG Cu verde",
        f"Baja {L['dc_vertical']:.1f} m por la fachada posterior (↓)",
        f"Longitud total DC: {L['dc_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _caja_texto(lam, (278, 82), [
        "RUTA AC (azul)", 'Tubería IMC 2", abrazaderas c/ 1,5 m',
        "2 x [3N° 6 AWG (F) + 1N° 6 (N) + 1N° 6 (T)] Cu",
        "Sube por fachada posterior (↑), cruza la losa y",
        f"baja por la fachada principal (↓) · total {L['ac_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _detalle_dc(lam, 278, 112, d, "Bajante por fachada posterior al patio")
    cerrar(lam, ["Cable tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc para conductores DC."])

    # --- Hoja 3 ----------------------------------------------------------------------------
    lam = nueva(3, "EQP", "Esquema 3D, ubicación de equipos y punto de conexión")
    lam.texto((14, 258), f"UBICACIÓN DE EQUIPOS Y PUNTO DE CONEXIÓN · {titulo}", 3.0, "TEXTO",
              negrita=True)  # fmt: skip
    isometrico(lam, (14, 58, 200, 186), loc, mods_l, dc, ac, az)
    _titulo_vista(lam, 16, 248, 1, "Esquema 3D de rutas DC (rojo) y AC (azul)", "SIN ESCALA")
    detalle_equipos(lam, 224, 160, d)
    _titulo_vista(lam, 222, 248, 2, "Detalle de equipos (fachada posterior)", "ESC 1:75")
    detalle_punto_conexion(lam, 236, 62)
    _titulo_vista(lam, 222, 150, 3, "Detalle hasta el punto de conexión", "ESC 1:90")
    cerrar(lam, ["El cable AC se dimensiona con base al alimentador existente en calibre 6 AWG."])
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m engine.planos.casas_doral")
    p.add_argument("excel", type=Path)
    p.add_argument("--casa", default="I10")
    p.add_argument("--fecha", default=dt.date.today().isoformat())
    args = p.parse_args(argv)
    bib = validar.cargar_biblioteca()
    casas = pvsyst.leer_casas(args.excel)
    modulo = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, _ = pvsyst.plan(casas, modulo)
    sel = [(c, f) for c, f in zip(casas, filas, strict=True)
           if "DORAL" in _slug(c["proyecto"])
           and _slug(str(c["casa"])) == _slug(args.casa)]  # fmt: skip
    if not sel:
        print("Casa no encontrada en Doral.")
        return 1
    d = datos_casa(*sel[0], bib)
    lams = laminas(d, args.fecha, _disenador())
    ruta = a_pdf(lams, SALIDA / f"PRO-ELE-DORAL-C{_slug(args.casa)}-PLANOS.pdf")
    print(ruta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
