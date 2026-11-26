"""Ingeniería tipo de las casas del Condominio Doral (Cartagena), cajetín Promigas, 3 hojas A3.

1. Localización, distribución de módulos (lastrada 10° al sur), estructura y materiales.
2. Rutas DC y AC en planta y detalle DC.
3. Esquema 3D de rutas, detalle de equipos (patio del 2° piso) y detalle hasta el tablero.

Casa I10 (insumos del usuario):
- Losa en L medida en Google Maps (44,96 m², perímetro 28,91 m): 7,0 m de frente; parte oeste de
  3,15 m × 7,44 m y parte este de 3,85 m × 5,30 m. Norte arriba; fachada principal al sur.
- Patio en el 2° piso, al norte de la parte este; los equipos van en esa fachada (flecha roja).
- DC baja de la losa al patio. La AC sube del patio a la losa, va junto a los pretiles (ruta
  amarilla) hasta la tubería existente de 1¼" (reserva, vacía; círculo rojo) y por ella baja al
  tablero de distribución. Por ese tubo van la acometida hacia los equipos y el retorno de cargas
  críticas: 2 × (3F + N + T) en 8 AWG Cu (usuario).
- Filas lastradas seguidas (paso 2,5 m, usuario). Para los 8 módulos se reubican dos
  condensadoras, la caja blanca y un extractor (usuario).
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
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

from engine import validar
from engine.planos import cajetin
from engine.planos.casas_primavera import (
    DESNIVEL,
    INSUMOS,
    NOTAS_RUTA,
    Marco,
    _caja_texto,
    _detalle_dc,
    _escala,
    _estructura3d,
    _filas,
    _fusionar,
    _guia,
    _largos,
    _modulos,
    _norte,
    _resumen,
    _suavizar,
    _titulo_vista,
    _z_modulo,
    caja_paso,
    cantidades_estructura,
    corte_lastrada,
    detalle_estructura,
    detalle_lastrada_3d,
    detalle_ruta,
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

# ------------------------------------------------------------------------------- casa I10 (mm)
# x al este, y al norte, origen en la esquina suroeste de la losa
X_L, Y_L, X_T, Y_R = 3150.0, 7440.0, 7000.0, 5300.0
LOSA = Polygon([(0, 0), (X_T, 0), (X_T, Y_R), (X_L, Y_R), (X_L, Y_L), (0, Y_L)])
PATIO = box(X_L, Y_R, X_T, Y_L)  # patio del 2° piso, al norte de la parte este
Z_PISO, Z_LOSA, PRETIL, ESP_PRETIL = 2800.0, 5800.0, 400.0, 150.0
PASO_FILAS = 2500.0  # filas lastradas seguidas (usuario)
SUPUESTOS = [
    "Losa en L según medición en Google Maps (44,96 m²); obstáculos ubicados desde la foto aérea.",
    "Alturas supuestas: patio del 2° piso a 2,8 m, losa de cubierta a 5,8 m, pretil 0,4 m.",
]
# Obstáculos que se quedan
LAMINA = box(3250, 3300, 5300, 5150)  # lámina traslúcida
AA_ESQUINA = box(2550, 6500, 2950, 7300)
TUBO_EXISTENTE = (250.0, 2400.0)  # tubería de 1¼" existente (reserva) hacia el tablero
# Obstáculos a reubicar (posición actual → propuesta), acordado con el usuario
REUBICAR = {
    "Condensadora AA": (box(3800, 2600, 4600, 2900), box(700, 6400, 1500, 6700)),
    "Condensadora AA ": (box(6550, 1600, 6850, 2400), box(1600, 6400, 2400, 6700)),
    "Caja": (box(700, 2050, 900, 2550), box(700, 6900, 900, 7250)),
    "Extractor": (Point(1250, 3650).buffer(250), Point(1700, 7050).buffer(250)),
}
# Equipos en la fachada norte de la parte este (cara y = Y_R), en el patio del 2° piso
EQ = {
    "tablero": (3350, 3750, Y_R, Y_R + 200, Z_PISO + 800, Z_PISO + 1600),
    "inversor": (4000, 4400, Y_R, Y_R + 240, Z_PISO + 1100, Z_PISO + 1700),
    "baterias": (4700, 5550, Y_R, Y_R + 220, Z_PISO, Z_PISO + 900),
}
Y_FACH = Y_R + 90  # eje de las tuberías sobre la fachada del patio
ZR = Z_LOSA + 80  # tuberías sobre la losa
ZP = Z_LOSA + PRETIL + 120  # paso sobre el pretil
X_OESTE = 250.0  # carril AC junto al pretil oeste (eje del tubo existente)
Y_AC = Y_FACH  # carril AC sobre la losa oeste, en línea con la fachada del patio
TAB_INTERNO_Z = 1500.0


def geometria() -> dict[str, Any]:
    g = {
        "losa": LOSA,
        "util": LOSA.buffer(-250, join_style=2),
        "patio": PATIO,
        "lote": LOSA.union(PATIO),
        "lamina": LAMINA,
        "aa": [AA_ESQUINA] + [v[1] for k, v in REUBICAR.items() if k.startswith("Cond")],
        "reubicar_de": [v[0] for v in REUBICAR.values()],
        "reubicar_a": [v[1] for v in REUBICAR.values()],
        "fijos": [LAMINA, AA_ESQUINA, Point(*TUBO_EXISTENTE).buffer(120)]
        + [v[1] for v in REUBICAR.values()],
    }
    for k, (x0, x1, y0, y1, _z0, _z1) in EQ.items():
        g[k] = box(x0, y0, x1, y1)
    return g


def colocar(g, n: int, w=1134.0, sep=20.0):
    """Filas lastradas al sur (paso PASO_FILAS); hasta 3 filas; la combinación con menos filas."""
    from shapely.geometry import LineString

    dd = 2278 * math.cos(math.radians(10))
    carril = LineString([(3000, Y_AC), (X_OESTE, Y_AC), (X_OESTE, TUBO_EXISTENTE[1])])
    libre = prep(g["util"].difference(unary_union([o.buffer(250) for o in g["fijos"]]
                                                   + [carril.buffer(250)])))  # fmt: skip

    def fila(y, ox):
        """Módulos de una fila. Con ox: retícula común (columnas alineadas entre filas);
        sin ox: cada tramo continuo arranca donde quepa (tramos rectos, columnas libres)."""
        out, x = [], (ox or 0.0)
        while x + w <= X_T:
            b = box(x, y, x + w, y + dd)
            if libre.contains(b):
                out.append(b)
                x += w + sep
            else:
                x += w + sep if ox is not None else 50
        return out

    mejor = None  # (filas, sobrantes, huecos, módulos)
    for ox in [*range(0, int(w + sep), 50), None]:
        if ox is None and mejor is not None:
            break  # ya se logró con columnas alineadas
        filas = {y: fila(y, ox) for y in range(0, int(Y_L), 50)}
        ys = sorted(y for y, f in filas.items() if f)
        for r in (1, 2, 3):
            if mejor and mejor[0] < r:
                break
            for a in ys:
                if r == 1:
                    cands = [(a,)]
                else:
                    bs = [b for b in ys if b - a >= PASO_FILAS]
                    cands = [(a, b) for b in bs] if r == 2 else [
                        (a, b, c) for b in bs for c in ys if c - b >= PASO_FILAS]  # fmt: skip
                for comb in cands:
                    mods = [m for y in comb for m in filas[y]]
                    if len(mods) < n:
                        continue
                    mods = mods[:n]
                    xs = sorted({round(m.bounds[0]) for m in mods})
                    huecos = len(xs) - max(len([m for m in mods if abs(m.bounds[1] - y) < 1])
                                           for y in comb)  # fmt: skip
                    clave = (r, len(mods) - n, huecos)
                    if mejor is None or clave < mejor[:3]:
                        mejor = (*clave, mods)
    if mejor:
        return _alinear(mejor[3], libre, w + sep)
    raise ValueError(f"no caben {n} módulos en la losa")


def _alinear(mods, libre, paso):
    """Corre cada tramo continuo de las demás filas a las columnas de la primera, si cabe."""
    y0 = min(m.bounds[1] for m in mods)
    cols = sorted(m.bounds[0] for m in mods if abs(m.bounds[1] - y0) < 1)
    cols = [cols[0] + k * paso for k in range(-6, 7)]
    out = [m for m in mods if abs(m.bounds[1] - y0) < 1]
    resto = sorted(
        (m for m in mods if abs(m.bounds[1] - y0) >= 1), key=lambda m: m.bounds[:2][::-1]
    )
    grupos: list[list] = []
    for m in resto:
        g_ = grupos[-1] if grupos else None
        if g_ and abs(g_[-1].bounds[1] - m.bounds[1]) < 1 and m.bounds[0] - g_[-1].bounds[2] < 100:
            g_.append(m)
        else:
            grupos.append([m])
    for g_ in grupos:
        x_ini = g_[0].bounds[0]
        for c in sorted(cols, key=lambda c: abs(c - x_ini)):
            mov = [affinity.translate(m, c - x_ini) for m in g_]
            if abs(c - x_ini) < paso and all(libre.contains(m) for m in mov):
                g_ = mov
                break
        out += g_
    return out


def rutas(g, mods):
    """Rutas 3D (mm) y longitudes (m)."""
    # DC: del módulo más al noreste, al norte hasta el pretil, baja al patio y va al inversor
    m = max(mods, key=lambda o: (o.bounds[3], o.bounds[2]))
    xm = (m.bounds[0] + m.bounds[2]) / 2
    inv = EQ["inversor"]
    xi = (inv[0] + inv[1]) / 2
    y_sal = m.bounds[3] + 150  # caja de paso tras el borde alto del módulo
    z_sal = _z_modulo(Z_LOSA) + DESNIVEL
    if y_sal > Y_R - 400:  # módulo junto al pretil: de la caja baja al pretil y lo cruza
        tramo_losa = [(xm, y_sal, z_sal), (xm, y_sal, ZP)]
    else:  # baja a la losa, va hasta el pretil y lo cruza
        tramo_losa = [(xm, y_sal, z_sal), (xm, y_sal, ZR), (xm, Y_R - 250, ZR),
                      (xm, Y_R - 250, ZP)]  # fmt: skip
    dc = _fusionar([
        *tramo_losa, (xm, Y_FACH, ZP), (xm, Y_FACH, Z_PISO + 1950),
        (xi, Y_FACH, Z_PISO + 1950), (xi, Y_FACH, inv[5]),
    ])  # fmt: skip
    # AC: del tablero FV sube por la fachada del patio, cruza el pretil a la losa oeste y va
    # junto al pretil oeste hasta el tubo existente de 1¼"
    tab = EQ["tablero"]
    xt = (tab[0] + tab[1]) / 2
    xc = X_L - 250  # junto al muro este de la parte oeste
    tx, ty = TUBO_EXISTENTE
    ac = _fusionar([
        (xt, Y_FACH, tab[5]), (xt, Y_FACH, ZP), (xc, Y_FACH, ZP), (xc, Y_FACH, ZR),
        (tx, Y_AC, ZR), (tx, ty, ZR),
    ])  # fmt: skip
    existente = [(tx, ty, ZR), (tx, ty, Z_LOSA - 300), (tx, ty, TAB_INTERNO_Z)]
    nuevo = sum(_largos(ac))
    exist = sum(_largos(existente)) + 2.0  # + recorrido interno hasta el tablero (supuesto)
    L = {
        "dc_total": sum(_largos(dc)), "ac_nuevo": nuevo, "ac_existente": exist,
        "ac_total": nuevo + exist, "dc_vertical": (ZP - Z_PISO - 1950) / 1000,
        "cal_ac": "8", "tubo_ac": '1¼"', "curvas_ac": len(ac) - 1,  # + entrada al tubo existente
        "ubic_bat": "En el patio del 2° piso",
        "estructura": cantidades_estructura(mods),
        "obs_ac": f"Nueva {nuevo:.1f} m (patio y losa); existente 1¼\" {exist:.1f} m",
    }  # fmt: skip
    return dc, ac, existente, L


# ------------------------------------------------------------------------------- planta
def _planta(lam, m: Marco, g, mods, rotulos=True) -> None:
    def pol(o, capa, rel=None, trazo="continuo"):
        m.pol(lam, o, capa, rel, trazo)

    pol(g["patio"], "NOTA", "#eef5e8")
    pol(g["losa"], "CUBIERTA", "#ecebe6")
    pol(g["util"], "NOTA", None, "discontinuo")
    pol(g["lamina"], "NOTA", "#e4eef7")
    for o in g["aa"]:
        pol(o, "NOTA", "#ffffff")
    for de, a in zip(g["reubicar_de"], g["reubicar_a"], strict=True):
        pol(de, "ROJO", None, "discontinuo")
        pol(a, "NOTA", "#ffffff")
    for k, col in (("baterias", "#d873d8"), ("inversor", "#bfe3f7"), ("tablero", "#4a4a4a")):
        pol(g[k], "EQUIPO", col)
    _modulos(lam, m, mods)
    lam.circulo(m(TUBO_EXISTENTE), 1.3, "ROJO", relleno="#c00000")
    if rotulos:
        lam.texto(m(g["patio"].centroid), "PATIO 2° PISO", 1.8, "NOTA", "centro")
        lam.texto(m(g["lamina"].centroid), "LÁMINA TRASLÚCIDA", 1.2, "NOTA", "centro")
        lam.texto(m((X_T / 2, -700)), "FACHADA PRINCIPAL (VÍA) · SUR", 1.6, "NOTA", "centro")
        for de in g["reubicar_de"]:
            lam.texto(m(de.centroid), "REUBICAR", 0.9, "ROJO", "centro", negrita=True)
        for a in g["reubicar_a"]:
            lam.texto(m(a.centroid), "nuevo", 0.8, "NOTA", "centro")
        p = m(TUBO_EXISTENTE)
        _caja_texto(lam, (p[0] - 3, p[1] - 3), ['Tubería existente 1¼"', "(reserva) al tablero"],
                    capa="ROJO", h=1.1, alinear="der")  # fmt: skip


DESC_DC = {
    5: [
        "Baja de la caja de paso a la altura del pretil",
        "Cruza el pretil norte hacia el patio",
        "Baja por la fachada del patio",
        "Horizontal por la fachada hasta el inversor",
        "Baja a la entrada DC del inversor",
    ],
    7: [
        "Salida del arreglo (caja de paso) a la losa",
        "Sobre la losa hasta el pretil norte",
        "Sube para cruzar el pretil",
        "Cruza el pretil hacia el patio",
        "Baja por la fachada del patio",
        "Horizontal por la fachada hasta el inversor",
        "Baja a la entrada DC del inversor",
    ],
}
DESC_AC = [
    "Sube por la fachada del patio desde el tablero FV",
    "Cruza el pretil hacia la losa oeste",
    "Baja a la losa",
    "Por la losa hacia el pretil oeste",
    'Junto al pretil oeste hasta el tubo existente 1¼"',
]
NOTAS_AC = [
    'C1 a C{nc}: {nc} curvas IMC 1¼" de 90° + 1 curva de',
    "entrada a la tubería existente (bajante al tablero).",
    "Uniones cada 3 m; abrazaderas cada 1,5 m y a 30 cm",
    "de cada curva. Cruce del pretil con pasamuro sellado.",
    "Tubo adosado a fachada, pretil y losa (no en el aire).",
    "Tubería existente: verificar continuidad y guía.",
]


# ------------------------------------------------------------------------------- 3D
V = np.array([0.95, 1.25, 1.15])
V /= np.linalg.norm(V)


def _vista(area, pts3d):
    """Proyección desde el noreste ajustada a un área. Devuelve P, profundidad y escala."""
    x0, y0, w, h = area
    der = np.cross([0, 0, 1], V)
    der /= np.linalg.norm(der)
    arr = np.cross(V, der)

    def proy(x, y, z):
        q = np.array([x, y, z])
        return (float(q @ der), float(q @ arr))

    us, vs = zip(*(proy(*q) for q in pts3d), strict=True)
    k = min(w / (max(us) - min(us)), h / (max(vs) - min(vs)))
    ox = x0 + (w - (max(us) - min(us)) * k) / 2 - min(us) * k
    oy = y0 + (h - (max(vs) - min(vs)) * k) / 2 - min(vs) * k

    def P(x, y, z):
        u, v = proy(x, y, z)
        return (ox + u * k, oy + v * k)

    def prof(x, y, z):
        return -float(np.dot([x, y, z], V))

    return P, prof, k


def _escena(lam, P, prof, g, mods, dc, ac, existente, f=1.0) -> None:
    """Vivienda, obstáculos, estructura lastrada, equipos y rutas en 3D."""
    cajas = []  # (profundidad, caja, color, capa)

    def caja(bx, color, capa="CUBIERTA"):
        xa, xb, ya, yb, za, zb = bx
        cajas.append((float(np.dot([(xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2], V)), bx, color,
                      capa))  # fmt: skip

    def pintar(bx, color, capa):
        xa, xb, ya, yb, za, zb = bx
        caras = [
            ((0, 0, 1), [(xa, ya, zb), (xb, ya, zb), (xb, yb, zb), (xa, yb, zb)], 1.0),
            ((0, 1, 0), [(xa, yb, za), (xb, yb, za), (xb, yb, zb), (xa, yb, zb)], 0.92),
            ((1, 0, 0), [(xb, ya, za), (xb, yb, za), (xb, yb, zb), (xb, ya, zb)], 0.8),
        ]
        r, g_, b = (int(color[i : i + 2], 16) for i in (1, 3, 5))
        for nrm, pts, fac in caras:
            if np.dot(nrm, V) > 1e-6:
                rel = "#{:02x}{:02x}{:02x}".format(*(min(255, int(c * fac)) for c in (r, g_, b)))
                lam.polilinea([P(*q) for q in pts], capa, cerrada=True, relleno=rel)

    lam.polilinea([P(x, y, 0) for x, y in ((-1500, -1500), (X_T + 1500, -1500),
                   (X_T + 1500, Y_L + 1500), (-1500, Y_L + 1500))], "NOTA", cerrada=True,
                  relleno="#e2e8da")  # fmt: skip
    # Volúmenes: parte oeste y este hasta la losa; bajo el patio, el 1° piso
    caja((0, X_L, 0, Y_L, 0, Z_LOSA), "#efece5")
    caja((X_L, X_T, 0, Y_R, 0, Z_LOSA), "#efece5")
    caja((X_L, X_T, Y_R, Y_L, 0, Z_PISO), "#e6e1d7")
    for _p, bx, col, capa in sorted(cajas, key=lambda c: c[0]):
        pintar(bx, col, capa)
    cajas.clear()
    # Pretiles
    e, zt = ESP_PRETIL, Z_LOSA + PRETIL
    for bx in ((0, X_T, 0, e, Z_LOSA, zt), (0, e, 0, Y_L, Z_LOSA, zt),
               (0, X_L, Y_L - e, Y_L, Z_LOSA, zt), (X_L - e, X_L, Y_R, Y_L, Z_LOSA, zt),
               (X_L, X_T, Y_R - e, Y_R, Z_LOSA, zt),
               (X_T - e, X_T, 0, Y_R, Z_LOSA, zt)):  # fmt: skip
        caja(bx, "#e3dfd7")
    lx0, ly0, lx1, ly1 = LAMINA.bounds
    caja((lx0, lx1, ly0, ly1, Z_LOSA, Z_LOSA + 250), "#dfeaf3", "NOTA")
    for o in g["aa"]:
        a, b_, c_, d_ = o.bounds
        caja((a, c_, b_, d_, Z_LOSA, Z_LOSA + 650), "#f7f7f7", "NOTA")
    for o in g["reubicar_a"][2:]:
        a, b_, c_, d_ = o.bounds
        caja((a, c_, b_, d_, Z_LOSA, Z_LOSA + 350), "#f2f2f2", "NOTA")
    for key, col, capa in (("baterias", "#e9c4ea", "EQUIPO"), ("inversor", "#dbe9f6", "AC"),
                           ("tablero", "#d9d9d9", "EQUIPO")):  # fmt: skip
        caja(EQ[key], col, capa)
    for _p, bx, col, capa in sorted(cajas, key=lambda c: c[0]):
        pintar(bx, col, capa)
    # Filas lastradas: bloques, soportes, rieles y módulos (borde bajo al sur)
    _estructura3d(lam, P, prof, _filas(mods), Z_LOSA)
    tubo3d(lam, P, dc, 1.5 * f, "#e74c3c", "DC", abrazadera_mm=1500)
    tubo3d(lam, P, ac, 1.8 * f, "#2e86de", "AC", abrazadera_mm=1500)
    x_, y_, z_ = dc[0]
    pintar((x_ - 60, x_ + 60, y_ - 60, y_ + 60, z_ - 60, z_ + 60), "#f4f4f4", "EQUIPO")
    lam.polilinea([P(*q) for q in _suavizar(existente)], "AC", trazo="discontinuo")
    lam.circulo(P(*existente[0]), 1.3 * f, "ROJO", relleno="#c00000")


def isometrico(lam, area, g, mods, dc, ac, existente) -> None:
    x0, y0, w, h = area
    esq = [(x, y, z) for x in (-1500, X_T + 1500) for y in (-1500, Y_L + 1500)
           for z in (0, Z_LOSA + PRETIL + 600)]  # fmt: skip
    P, prof, _k = _vista((x0 + 3, y0 + 3, w - 6, h - 6), esq)
    _escena(lam, P, prof, g, mods, dc, ac, existente)
    rot = [
        (P(*dc[0]), "Arreglo FV · caja de paso, salida string S1.1.1", 1),
        (P(*dc[-3]), 'DC: coraza 1" baja al patio del 2° piso', 1),
        (P(4200, Y_R + 240, Z_PISO + 1400), "Inversor", 1),
        (P(5100, Y_R + 220, Z_PISO + 450), "Baterías", 1),
        (P(3550, Y_R + 200, Z_PISO + 1200), "Tablero FV", -1),
        (P(*ac[1]), 'AC: IMC 1¼" sube por la fachada del patio', -1),
        (P(X_OESTE, 4000, ZR), "AC por la losa junto al pretil oeste", -1),
        (P(*existente[0]), 'Tubería existente 1¼" (reserva) baja al tablero', -1),
    ]
    for lado, xcol in ((-1, x0 + 46), (1, x0 + w - 56)):
        items = sorted(((p, t) for p, t, s in rot if s == lado), key=lambda it: -it[0][1])
        y_prev = None
        for p, t in items:
            yq = p[1] + 3 if y_prev is None else min(p[1] + 3, y_prev - 6.5)
            y_prev = yq
            _guia(lam, p, (xcol, yq))
            _caja_texto(lam, (xcol, yq + 1.6), [t], h=1.3, alinear="der" if lado < 0 else "izq")
    lam.texto((x0 + 2, y0 + 2), "Vista desde el noreste. Alturas supuestas: patio 2,8 m; losa "
              "5,8 m; pretil 0,4 m. Esquema sin escala.", 1.3, "NOTA")  # fmt: skip


# ------------------------------------------------------------------------------- detalles
def detalle_equipos(lam, x, y, d) -> None:
    """Alzado de la fachada norte (vista desde el patio; el este a la izquierda)."""
    b = d["bat"]
    k = 1 / 50
    W = (X_T - X_L) * k
    H = (Z_LOSA + PRETIL - Z_PISO) * k

    def px(xm, zm):
        return (x + (X_T - xm) * k, y + (zm - Z_PISO) * k)

    lam.rect(x, y, W, H, "CUBIERTA", relleno="#fbf6ee")
    lam.rect(x - 3, y - 1.2, W + 6, 1.2, "CUBIERTA", relleno="#bdbdbd")
    lam.rect(x + W, y, 3, H + 12, "CUBIERTA", relleno="#e3dfd7")  # muro de la parte oeste
    lam.texto((x + W / 2, y + H + 2), "FACHADA NORTE · PATIO DEL 2° PISO", 1.4, "NOTA", "centro")
    lam.texto((x + 1, y - 3.2), "Piso del patio (2° piso)", 1.1, "NOTA")

    def r(bx, col, capa, t1, t2=""):
        xa, xb, _, _, za, zb = bx
        p0, p1 = px(xb, za), px(xa, zb)
        lam.rect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1], capa, relleno=col)
        lam.texto(((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2), t1, 1.1, "TEXTO", "centro",
                  negrita=True)  # fmt: skip
        if t2:
            lam.texto(((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 2), t2, 0.9, "TEXTO", "centro")

    r(EQ["baterias"], "#f6e0f6", "EQUIPO", "BATERÍAS", f"{b['n']} mód. · {_f(b['kwh'])} kWh")
    r(EQ["inversor"], "#e9eef3", "AC", "INV.")
    r(EQ["tablero"], "#e6e6e6", "EQUIPO", "T.FV")
    inv, tab = EQ["inversor"], EQ["tablero"]
    xi, xt = (inv[0] + inv[1]) / 2, (tab[0] + tab[1]) / 2
    x_dc = X_T - 900
    tubo(lam, [px(x_dc, ZP + 300), px(x_dc, Z_PISO + 1950), px(xi, Z_PISO + 1950),
               px(xi, inv[5])], 1.1, "DC", "#f6c9c4", abrazaderas=7)  # fmt: skip
    tubo(lam, [px(xt, tab[5]), px(xt, ZP + 300)], 1.5, "AC", "#cfe0f5", abrazaderas=7,
         uniones=16)  # fmt: skip
    tubo(lam, [px(inv[0], Z_PISO + 1400), px(tab[1], Z_PISO + 1400)], 1.2, "AC", "#cfe0f5")
    tubo(lam, [px(5100, Z_PISO + 900), px(5100, Z_PISO + 1250), px(inv[1], Z_PISO + 1250)], 1.0,
         "DC", "#f6c9c4")  # fmt: skip
    caja_paso(lam, px(xt, Z_PISO + 2300), 2.2)
    _caja_texto(lam, (x - 2, y + H - 4), ['DC: coraza 1" desde la losa',
                "Cable FV 2x4 mm² + 1N° 8 AWG Cu"], h=1.1, alinear="der")  # fmt: skip
    _guia(lam, px(x_dc, Z_LOSA), (x - 2, y + H - 7))
    _caja_texto(lam, (x + W + 5, y + H + 6), ['AC: IMC 1¼" sube a la losa',
                "2 x [3N° 8 + 1N° 8 (N) + 1N° 8 (T)] Cu"], h=1.1)  # fmt: skip
    _guia(lam, px(xt, Z_LOSA - 300), (x + W + 5, y + H + 3))
    _caja_texto(lam, (x + W + 5, y + H - 6), ["Caja de paso 10x10 cm IP66"], h=1.1)
    _guia(lam, px(xt, Z_PISO + 2300), (x + W + 5, y + H - 8))
    _caja_texto(lam, (x + W + 5, y + 14), ['Coraza 1" cable de baterías',
                'Coraza ¾" comunicaciones', f"Inversor {d['inversor_modelo']}"], h=1.1)  # fmt: skip


def detalle_punto_conexion(lam, x, y) -> None:
    """Corte: la AC llega por la losa a la tubería existente de 1¼" y baja al tablero."""
    k = 1 / 90
    H = (Z_LOSA + PRETIL) * k
    lam.rect(x, y, 3, H, "CUBIERTA", relleno="#d9d4cb")  # muro / pretil oeste
    lam.rect(x + 3, y + Z_LOSA * k - 2, 40, 2, "CUBIERTA", relleno="#bdbdbd")  # losa
    lam.rect(x + 3, y + Z_PISO * k - 1.5, 40, 1.5, "CUBIERTA", relleno="#cfcfcf")  # entrepiso
    lam.texto((x + 30, y + Z_LOSA * k - 4.5), "Losa de cubierta", 1.2, "NOTA")
    lam.texto((x + 30, y + Z_PISO * k + 0.6), "Entrepiso", 1.2, "NOTA")
    xt = x + 6
    tubo(lam, [(x + 40, y + ZR * k), (xt, y + ZR * k), (xt, y + Z_LOSA * k + 1.0)], 1.6, "AC",
         "#cfe0f5", abrazaderas=8)  # fmt: skip
    caja_paso(lam, (xt, y + ZR * k + 2.4), 2.6)
    lam.polilinea(
        [(xt, y + Z_LOSA * k), (xt, y + TAB_INTERNO_Z * k + 4)], "AC", trazo="discontinuo"
    )
    lam.polilinea([(xt + 1.2, y + Z_LOSA * k), (xt + 1.2, y + TAB_INTERNO_Z * k + 4)], "AC",
                  trazo="discontinuo")  # fmt: skip
    lam.rect(xt - 3, y + (TAB_INTERNO_Z - 400) * k, 7, 900 * k, "EQUIPO", relleno="#ffffff")
    for i in range(4):
        lam.linea((xt - 2, y + (TAB_INTERNO_Z - 300) * k + i * 1.7),
                  (xt + 3, y + (TAB_INTERNO_Z - 300) * k + i * 1.7), "NOTA")  # fmt: skip
    lam.texto((xt + 6, y + (TAB_INTERNO_Z - 400) * k - 2.5), "TABLERO DE DISTRIBUCIÓN (P.C.)", 1.2,
              "TEXTO", negrita=True)  # fmt: skip
    _caja_texto(lam, (x + 44, y + ZR * k + 7), ["Viene del patio por la losa,",
                'junto al pretil (IMC 1¼")'], h=1.15)  # fmt: skip
    _caja_texto(lam, (x + 2, y + ZR * k + 14), ["Caja de paso 10x10 IP66 y empalme",
                'a la tubería existente de 1¼"'], h=1.15)  # fmt: skip
    _caja_texto(lam, (x + 12, y + H * 0.55), ['Tubería existente 1¼" (reserva, vacía)',
                "baja embebida al tablero", "Acometida → equipos y retorno",
                "de cargas críticas: 2 x (3F+N+T) 8 AWG"], h=1.15)  # fmt: skip
    _guia(lam, (xt + 0.6, y + H * 0.5), (x + 12, y + H * 0.55 - 2))


# ------------------------------------------------------------------------------- láminas
def laminas(d: dict[str, Any], fecha: str, disenador: str = "") -> list[Lamina]:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "cajetin.json")
    g = geometria()
    mods = colocar(g, d["modulos"])
    dc, ac, existente, L = rutas(g, mods)
    conj = json.loads((INSUMOS / "doral.json").read_text(encoding="utf-8"))
    titulo = f"CASA {d['casa']} - CONDOMINIO DORAL (INGENIERÍA TIPO)"
    llenado = 10 * 0.2373  # 10 conductores 8 AWG THHN (cm²)
    notas = [
        f"Sistema de {d['modulos']} módulos JA Solar de 595 Wp ({_f(d['kwp'])} kWp) y un inversor "
        f"{d['inversor_modelo']}.",
        "Estructura lastrada al sur (180°) a 10°, filas seguidas cada 2,5 m, columnas alineadas.",
        "Reubicar 2 condensadoras, la caja y un extractor según la hoja 1.",
        f'Tubería de 1¼" existente: 10 conductores 8 AWG ≈ {llenado:.1f} cm² (≈ 24 %); verificar '
        "llenado y factor de corrección por agrupamiento (NTC 2050).",
        *SUPUESTOS,
    ]
    out: list[Lamina] = []
    total = 4

    def nueva(n, tipo, titulo_lam):
        return Lamina(n, codigo_plano(d, tipo, n), titulo_lam, disciplina="ELE", tipo=tipo,
                      escala="INDICADA", unidad="m")  # fmt: skip

    def cerrar(lam, extra=()):
        lam.notas = notas + list(extra)
        cajetin.dibujar(lam, plantilla, datos_cajetin(d, lam, fecha, disenador,
                        f"{lam.numero}/{total}", plantilla), validar.RAIZ)  # fmt: skip
        out.append(lam)

    # --- Hoja 1 ----------------------------------------------------------------------------
    lam = nueva(1, "DIS", "Localización, distribución de módulos y materiales")
    lam.texto((14, 258), f"DISTRIBUCIÓN DE MÓDULOS · {titulo}", 3.0, "TEXTO", negrita=True)
    foto = INSUMOS / "doral_i10_ruta.png"
    fw = 104
    lam.imagen(foto, 14, 194, fw, fw * 460 / 863)
    lam.rect(14, 194, fw, fw * 460 / 863, "CAJETIN")
    _titulo_vista(lam, 14, 188, 1, "Vista aérea: contorno, equipos y ruta AC")
    lam.texto((22, 183.5), f"Conjunto: {conj['lat']:.5f}, {conj['lon']:.5f} · Cartagena", 1.4,
              "NOTA")  # fmt: skip
    _resumen(lam, 14, 178, d, mods, ancho=104, orientacion="Sur (180°), 10°")
    m = Marco(g["lote"].union(box(0, -900, X_T, 0)), (120, 104, 132, 150),
              n_opciones=(75, 100, 125))  # fmt: skip
    _planta(lam, m, g, mods)
    _norte(lam, 246, 248)
    _escala(lam, 124, 104, m.n)
    _titulo_vista(lam, 124, 98, 2, "Distribución de módulos", f"ESC 1:{m.n}")
    por_fila = max(sum(1 for o in mods if abs(o.bounds[1] - q.bounds[1]) < 1) for q in mods)
    detalle_estructura(lam, 96, 62, por_fila)
    _titulo_vista(
        lam, 14, 92, 3, "Detalle estructura lastrada (por fila)", "ESC 1:40 (cotas en mm)"
    )
    tabla_materiales_compacta(lam, 256, 250, materiales_obra(d, L))
    cerrar(
        lam, ["Materiales: tubería nueva sobre la ruta + 10 %; cable incluye el tramo existente."]
    )

    # --- Hoja 2 ----------------------------------------------------------------------------
    lam = nueva(2, "RUT", "Rutas de cableado DC y AC")
    lam.texto((14, 258), f"RUTAS DE CABLEADO DC Y AC · {titulo}", 3.0, "TEXTO", negrita=True)
    m = Marco(g["lote"].union(box(0, -900, X_T, 0)), (14, 66, 256, 182), n_opciones=(50, 75, 100))
    _planta(lam, m, g, mods)
    i_fach = next(i for i, q in enumerate(dc) if abs(q[1] - Y_FACH) < 1)
    dc_p = [q[:2] for q in dc[: i_fach + 1]]
    ac_p = [q[:2] for q in ac[1:]]
    ac_p = [q for i, q in enumerate(ac_p) if i == 0 or math.dist(q, ac_p[i - 1]) > 1]
    dc_p = [q for i, q in enumerate(dc_p) if i == 0 or math.dist(q, dc_p[i - 1]) > 1]
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
        f"Baja {L['dc_vertical']:.1f} m por la fachada al patio del 2° piso (↓)",
        f"Longitud total DC: {L['dc_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _caja_texto(lam, (278, 80), [
        "RUTA AC (azul)", 'Nueva: IMC 1¼" del patio a la losa y por los pretiles',
        "2 x [3N° 8 AWG (F) + 1N° 8 (N) + 1N° 8 (T)] Cu",
        'Existente: tubería 1¼" de reserva hasta el tablero (↓)',
        f"Nueva {L['ac_nuevo']:.1f} m + existente {L['ac_existente']:.1f} m",
    ], h=1.25)  # fmt: skip
    _detalle_dc(lam, 278, 112, d, "Bajante por fachada al patio del 2° piso")
    cerrar(lam, ["Cable tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc para conductores DC."])

    # --- Hoja 3 ----------------------------------------------------------------------------
    lam = nueva(3, "EQP", "Esquema 3D, ubicación de equipos y punto de conexión")
    lam.texto((14, 258), f"UBICACIÓN DE EQUIPOS Y PUNTO DE CONEXIÓN · {titulo}", 3.0, "TEXTO",
              negrita=True)  # fmt: skip
    isometrico(lam, (14, 58, 200, 186), g, mods, dc, ac, existente)
    _titulo_vista(lam, 16, 248, 1, "Esquema 3D de rutas DC (rojo) y AC (azul)", "SIN ESCALA")
    detalle_equipos(lam, 272, 164, d)
    _titulo_vista(lam, 222, 248, 2, "Detalle de equipos (patio del 2° piso)", "ESC 1:50")
    detalle_punto_conexion(lam, 248, 64)
    _titulo_vista(lam, 222, 150, 3, "Detalle hasta el tablero (tubería existente)", "ESC 1:90")
    cerrar(lam, ["Por el tubo de 1¼\" van la acometida hacia los equipos y el retorno de cargas "
                 "críticas (2 alimentadores en 8 AWG)."])  # fmt: skip

    # --- Hoja 4: detalles constructivos ----------------------------------------------------
    lam = nueva(4, "DET", "Detalles de estructura lastrada y rutas DC / AC")
    lam.texto((14, 258), f"DETALLES CONSTRUCTIVOS · {titulo}", 3.0, "TEXTO", negrita=True)
    n_filas = len(_filas(mods))
    _titulo_vista(lam, 16, 248, 1, f"Estructura lastrada: {d['modulos']} módulos en {n_filas} "
                  "filas alineadas", "SIN ESCALA (cotas en mm)")  # fmt: skip
    detalle_lastrada_3d(lam, (14, 150, 214, 92), mods=mods, sep=20.0)
    _titulo_vista(lam, 234, 248, 2, "Corte lateral de la estructura", "ESC 1:20 (cotas en mm)")
    corte_lastrada(lam, 236, 186, paso=PASO_FILAS)

    def escena(lam_, P, prof, f):
        _escena(lam_, P, prof, g, mods, dc, ac, existente, f)

    desc_dc = DESC_DC.get(len(dc) - 1, [f"Tramo {i}" for i in range(1, len(dc))])
    desc_ac = DESC_AC if len(DESC_AC) == len(ac) - 1 else [f"Tramo {i}" for i in range(1, len(ac))]
    _titulo_vista(lam, 16, 146, 3, "Ruta DC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta(lam, (14, 58, 196, 84), dc, desc_dc, "dc", _vista, escena, NOTAS_RUTA["dc"])
    _titulo_vista(lam, 214, 146, 4, "Ruta AC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta(lam, (212, 58, 196, 84), ac, desc_ac, "ac", _vista, escena, NOTAS_AC,
                 extra=[("E", 'Tubo existente 1¼" al tablero (+2 m interno, sup.)',
                         L["ac_existente"])])  # fmt: skip
    cerrar(lam, [
        "Longitudes de tramo medidas sobre el eje de la tubería en el modelo 3D (sin reserva).",
        "Bloques de concreto esquemáticos: dimensiones, peso y cantidad según proveedor.",
    ])  # fmt: skip
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
