"""Planos de la vivienda Pance Campestre 16 (Cali): cubierta tipo sándwich con mini riel.

Hojas: 1) localización y distribución de módulos con la planta de fijación y materiales;
2) rutas DC y AC en planta; 3) esquema 3D, equipos en la fachada oeste y punto de conexión;
4) detalles: estructura de mini riel en 3D, corte transversal y rutas DC / AC ampliadas.

Geometría de la cubierta: captura de Google Maps con "Medir distancia" (142,25 m², 49,54 m; la
escala por área y por perímetro coincide al 0,04 %). Supuestos marcados en `SUPUESTOS`.

Uso: python -m engine.planos.casas_pance <excel> [--fecha AAAA-MM-DD]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

from shapely.geometry import Polygon, box

from engine import validar
from engine.planos import cajetin
from engine.planos.casas_primavera import (
    ANCHO_MOD,
    INSUMOS,
    LARGO_MOD,
    NOTAS_RUTA,
    Marco,
    _caja_texto,
    _cota,
    _detalle_dc,
    _escala,
    _filas,
    _fusionar,
    _guia,
    _largos,
    _modulos,
    _norte,
    _resumen,
    _titulo_vista,
    _vista,
    caja_paso,
    cantidades_estructura,
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

# ------------------------------------------------------------------------------- vivienda (mm)
# x al este, y al norte; origen en la esquina suroeste del contorno medido en Maps
TECHO = Polygon([(0, 13490), (11830, 13370), (11500, 630), (3040, 0), (2900, 2000),
                 (800, 2000), (800, 9050), (0, 9050)])  # fmt: skip
X_MURO = 800.0  # fachada oeste del volumen alto: muro de los equipos (usuario)
Y_MURO = (2000.0, 9050.0)
TERRAZA = box(-2500, 0, X_MURO, 9050)  # terraza del 2° piso al oeste (ancho supuesto)
PATIO_SUR = box(X_MURO, 0, 2900, 2000)  # retranqueo suroeste, al nivel de la terraza
# Claraboya en el piso de la terraza, frente al listón de madera (usuario; tamaño estimado de la
# foto del muro) y buitrón por ella hasta el tablero del 1° piso
CLARABOYA = box(-600, 2500, 600, 3800)
BUITRON = (450.0, 3150.0)
Y_LISTON = (2700.0, 3750.0)  # listón de madera sobre la fachada (estimado de la foto)
Z_TER = 3000.0  # piso de la terraza del 2° piso (supuesto)
Z_CUB = 6500.0  # cubierta en el borde sur (supuesto: 2 pisos)
PEND = 0.05  # pendiente hacia el sur, 5 % ≈ 2,9° (supuesto: "casi plana")
INCL = math.degrees(math.atan(PEND))
PRETIL, ESP_PRETIL = 600.0, 150.0  # pretiles (supuesto)
RETIRO = 600.0  # de la cara interna del pretil a los módulos (sombra y mantenimiento)
SEP = 20.0  # separación entre módulos (ajustar para que cada junta caiga sobre una cresta)
H_MOD = 110.0  # cara superior del módulo sobre la cresta: mini riel + marco (supuesto)
MINIRRIEL = (400.0, 40.0, 40.0)  # largo × ancho × alto, esquemático (según fabricante)
S_FIJ = (542.0, LARGO_MOD - 542.0)  # mini rieles a 542 mm de cada borde del módulo
TORNILLOS_MR = 4  # tornillos autoperforantes por mini riel (supuesto, según fabricante)
PASO_CRESTA = 333.0  # paso entre crestas del panel sándwich (esquemático, verificar)
# Equipos en la fachada oeste (cara x = X_MURO), sobre la terraza; dimensiones de las fichas
X_EQ = X_MURO - 90  # eje de las tuberías sobre la fachada
EQ = {
    # dentro del recuadro marcado en la foto (≈ y 4900 a 8100), tablero hacia la claraboya
    "tablero": (X_MURO - 200, X_MURO, 5000, 5400, Z_TER + 800, Z_TER + 1600),
    "inversor": (X_MURO - 235, X_MURO, 5800, 6395, Z_TER + 1100, Z_TER + 1585),  # 595×485×235
    "baterias": (X_MURO - 209, X_MURO, 6800, 7670, Z_TER, Z_TER + 1167),  # BHF-S15 870×1167
}
Y_BAJANTE = BUITRON[1]  # la AC deja la fachada y va al buitrón de la claraboya
Z_TAB_PC = (900.0, 1700.0)  # tablero existente del 1° piso (supuesto: bajo el buitrón)
SUPUESTOS = [
    "Cubierta según Maps (142,25 m²); alturas supuestas: terraza 3,0 m, cubierta 6,5 m (borde "
    "sur), pretil 0,6 m; pendiente 5 % hacia el sur.",
    "Mini riel, tornillería y paso de crestas según el fabricante y el panel sándwich: verificar "
    "en obra.",
]


def z_techo(y: float) -> float:
    """Cota de la cresta de la cubierta (cae al sur)."""
    return Z_CUB + PEND * y


def geometria() -> dict[str, Any]:
    interior = TECHO.buffer(-ESP_PRETIL, join_style=2)
    g = {
        "techo": TECHO,
        "interior": interior,
        "util": TECHO.buffer(-(ESP_PRETIL + RETIRO), join_style=2),
        "terraza": TERRAZA,
        "patio_sur": PATIO_SUR,
        "claraboya": CLARABOYA,
        "lote": TECHO.union(TERRAZA).union(PATIO_SUR),
    }
    for k, (x0, x1, y0, y1, _z0, _z1) in EQ.items():
        g[k] = box(x0, y0, x1, y1)
    return g


def colocar(g, n: int):
    """Una hilera continua de módulos verticales (coplanares, mirando al sur); si no cabe, dos."""
    w, d = ANCHO_MOD, LARGO_MOD * math.cos(math.radians(INCL))
    util = g["util"]
    minx, miny, maxx, maxy = util.bounds
    c = util.centroid
    for por_fila in ([n], [n - n // 2, n // 2]):
        mejor = None
        ancho = max(por_fila) * w + (max(por_fila) - 1) * SEP
        y = miny
        while y + d * len(por_fila) + SEP * (len(por_fila) - 1) <= maxy:
            x = minx
            while x + ancho <= maxx:
                mods = [box(x + i * (w + SEP), y + f * (d + SEP), x + i * (w + SEP) + w,
                            y + f * (d + SEP) + d)
                        for f, k in enumerate(por_fila) for i in range(k)]  # fmt: skip
                if all(util.contains(m) for m in mods):
                    # cerca del centro (lejos de la sombra de los pretiles) y del muro oeste
                    cx = sum(m.centroid.x for m in mods) / len(mods)
                    cy = sum(m.centroid.y for m in mods) / len(mods)
                    costo = abs(cy - c.y) + 0.3 * (cx - minx)
                    if mejor is None or costo < mejor[0]:
                        mejor = (costo, mods)
                x += 50
            y += 50
        if mejor:
            return mejor[1]
    raise ValueError(f"no caben {n} módulos en la cubierta")


def rutas(g, mods):
    """Rutas 3D (mm) y longitudes (m)."""
    oeste = min(mods, key=lambda m: m.bounds[0])
    x0, y0, _x1, y1 = oeste.bounds
    ym = (y0 + y1) / 2
    ym = min(max(ym, Y_MURO[0] + 600), Y_MURO[1] - 600)  # bajada DC sobre el muro de equipos
    zm = z_techo(ym)
    x_int = X_MURO + ESP_PRETIL + 100  # junto a la cara interna del pretil oeste
    z_pre = zm + PRETIL + 120  # paso sobre el pretil
    inv = EQ["inversor"]
    yi = (inv[2] + inv[3]) / 2
    z_h = Z_TER + 1900
    dc = _fusionar([
        (x0 - 150, ym, zm + 80), (x_int, ym, zm + 80),
        (x_int, ym, z_pre), (X_EQ, ym, z_pre), (X_EQ, ym, z_h), (X_EQ, yi, z_h),
        (X_EQ, yi, inv[5]),
    ])  # fmt: skip
    tab = EQ["tablero"]
    yt = (tab[2] + tab[3]) / 2
    ac = _fusionar([
        (X_EQ, yt, tab[4]), (X_EQ, yt, Z_TER + 150), (X_EQ, Y_BAJANTE, Z_TER + 150),
        (BUITRON[0], Y_BAJANTE, Z_TER + 150), (BUITRON[0], Y_BAJANTE, Z_TAB_PC[1]),
    ])  # fmt: skip
    desc_dc = [
        "Caja de paso del arreglo, sobre la cubierta, al pretil oeste",
        "Sube para cruzar el pretil",
        "Cruza el pretil hacia la fachada oeste",
        "Baja por la fachada oeste",
        "Horizontal por la fachada hasta el inversor",
        "Baja a la entrada DC del inversor",
    ]
    desc_ac = [
        "Baja del tablero FV al piso de la terraza",
        "Por la fachada, junto al piso, hasta el listón de madera",
        "Al borde de la claraboya",
        "Baja por el buitrón de la claraboya al tablero P.C.",
    ]
    if len(desc_dc) != len(dc) - 1:
        desc_dc = [f"Tramo {i}" for i in range(1, len(dc))]
    if len(desc_ac) != len(ac) - 1:
        desc_ac = [f"Tramo {i}" for i in range(1, len(ac))]
    est = cantidades_estructura(mods)
    juntas = sum(len(g_) + 1 for f in _filas(mods) for g_ in f["grupos"])
    n_mr = 2 * juntas
    L = {
        "dc_total": sum(_largos(dc)),
        "ac_total": sum(_largos(ac)),
        "dc_vertical": (z_pre - z_h) / 1000,
        "ac_bajante": (Z_TER + 150 - Z_TAB_PC[1]) / 1000,
        "curvas_ac": len(ac) - 2,
        "ubic_bat": "En la terraza del 2° piso",
        "obs_ac": "Fachada oeste y buitrón por la claraboya",
        "estructura": est,
        "n_minirriel": n_mr,
        "filas_estructura": [
            ("ESTRUCTURA MINI RIEL", "Mini riel de aluminio para cubierta tipo sándwich", "und",
             n_mr, "2 por junta, sobre cresta"),
            ("", "Tornillo autoperforante con arandela EPDM", "und", TORNILLOS_MR * n_mr,
             "Según fabricante"),
            ("", "Mid clamp (con grounding)", "und", est["mid_clamp"], ""),
            ("", "End clamp (con grounding)", "und", est["end_clamp"], ""),
            ("", "Grounding lug para estructura", "und", 2, ""),
            ("", "Sellante para cubierta metálica (cartucho)", "und", 2, "Perforaciones"),
        ],
    }  # fmt: skip
    return dc, ac, desc_dc, desc_ac, L


# ------------------------------------------------------------------------------- planta
def _planta(lam, m: Marco, g, mods, rotulos=True) -> None:
    m.pol(lam, g["terraza"], "NOTA", "#eef5e8")
    m.pol(lam, g["techo"], "CUBIERTA", "#e9ecef")
    m.pol(lam, g["interior"], "CUBIERTA", None)
    m.pol(lam, g["util"], "NOTA", None, "discontinuo")
    # Crestas del panel sándwich (esquemáticas, en el sentido de la pendiente)
    minx, miny, maxx, maxy = g["interior"].bounds
    x = minx + PASO_CRESTA
    while x < maxx:
        from shapely.geometry import LineString

        seg = LineString([(x, miny - 10), (x, maxy + 10)]).intersection(g["interior"])
        for parte in getattr(seg, "geoms", [seg]):
            if not parte.is_empty and parte.length > 0:
                lam.polilinea([m(q) for q in parte.coords], "NOTA")
        x += PASO_CRESTA * 3
    m.pol(lam, g["patio_sur"], "NOTA", "#eef5e8")
    m.pol(lam, g["claraboya"], "NOTA", "#d6eaf8")
    cx0, cy0, cx1, cy1 = CLARABOYA.bounds
    lam.linea(m((cx0, cy0)), m((cx1, cy1)), "NOTA")
    lam.linea(m((cx0, cy1)), m((cx1, cy0)), "NOTA")
    for k, col in (("baterias", "#f0c9f0"), ("inversor", "#bfe3f7"), ("tablero", "#4a4a4a")):
        m.pol(lam, g[k], "EQUIPO", col)
    _modulos(lam, m, mods)
    lam.circulo(m(BUITRON), 1.3, "ROJO", relleno="#c00000")
    if rotulos:
        c = g["terraza"].centroid
        lam.texto(m((c.x, c.y + 1500)), "TERRAZA 2° PISO", 1.5, "NOTA", "centro", rotacion=90)
        lam.texto(m((6500, 12300)), "CUBIERTA TIPO SÁNDWICH", 1.5, "NOTA", "centro")
        lam.texto(m((6500, 11700)), f"pendiente {PEND * 100:.0f} % → sur", 1.2, "NOTA", "centro")
        lam.texto(m((6000, 14300)), "VÍA · NORTE", 1.5, "NOTA", "centro")
        lam.texto(m(CLARABOYA.centroid), "CLARABOYA", 1.0, "NOTA", "centro")
        p = m(BUITRON)
        _caja_texto(lam, (p[0] - 6, p[1] - 4), ["Buitrón por la claraboya", "al tablero (1° piso)"],
                    capa="ROJO", h=1.1, alinear="der")  # fmt: skip


def planta_fijacion(lam, x, y, n_mod: int) -> None:
    """Planta de fijación: mini rieles bajo cada junta a 542 mm de los bordes (cotas en mm)."""
    k = 1 / 50
    n_v = min(n_mod, 3)  # se dibujan 3 módulos; el resto se repite igual
    for i in range(n_v):
        x0 = x + i * (ANCHO_MOD + SEP) * k
        lam.rect(x0, y, ANCHO_MOD * k, LARGO_MOD * k, "MODULO", relleno="#b4e8b0")
    for j in range(n_v + 1):
        xj = x + (j * (ANCHO_MOD + SEP) - SEP / 2) * k if 0 < j < n_v else (
            x if j == 0 else x + (n_v * (ANCHO_MOD + SEP) - SEP) * k)  # fmt: skip
        for s in S_FIJ:
            lam.rect(xj - 0.6, y + (s - MINIRRIEL[0] / 2) * k, 1.2, MINIRRIEL[0] * k, "ESTRUCTURA",
                     relleno="#8b5e3c")  # fmt: skip
    total = n_v * (ANCHO_MOD + SEP) - SEP
    _cota(lam, (x, y + LARGO_MOD * k), (x + total * k, y + LARGO_MOD * k),
          f"{total:.0f}" + (f" (hilera de {n_mod})" if n_mod > n_v else ""), off=3)  # fmt: skip
    _cota(lam, (x, y), (x + ANCHO_MOD * k, y), f"{ANCHO_MOD:.0f}", off=-3, h=1.2)
    xr = x + total * k
    _cota(lam, (xr, y), (xr, y + S_FIJ[0] * k), "542", off=-3, h=1.2)
    _cota(lam, (xr, y + S_FIJ[0] * k), (xr, y + S_FIJ[1] * k), f"{S_FIJ[1] - S_FIJ[0]:.0f}",
          off=-3, h=1.2)  # fmt: skip
    _cota(lam, (xr, y + S_FIJ[1] * k), (xr, y + LARGO_MOD * k), "542", off=-3, h=1.2)
    lam.texto((x, y - 5.5), "Mini riel (marrón) bajo cada junta y en los extremos; mid clamp en "
              "las juntas, end clamp en los extremos.", 1.1, "NOTA")  # fmt: skip
    lam.texto((x, y - 8), "Cada mini riel va sobre una cresta del panel: ajustar la separación "
              "entre módulos al paso de crestas.", 1.1, "NOTA")  # fmt: skip
    lam.texto((x - 3, y + LARGO_MOD * k / 2), "↓ pendiente", 1.2, "NOTA", "centro", rotacion=90)


# ------------------------------------------------------------------------------- 3D
def _caja(lam, P, bx, color, capa) -> None:
    """Caja vista desde el suroeste: caras oeste, sur y superior."""
    x0, x1, y0, y1, z0, z1 = bx

    def tono(f):
        r, g_, b = (int(color[i : i + 2], 16) for i in (1, 3, 5))
        return "#{:02x}{:02x}{:02x}".format(*(min(255, int(v * f)) for v in (r, g_, b)))

    for pts, f in (
        ([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], 0.85),
        ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], 0.95),
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], 1.08),
    ):
        lam.polilinea([P(*q) for q in pts], capa, cerrada=True, relleno=tono(f))


def _minirriel3d(lam, P, prof, mods, zf, color="#2f4f7f", fantasma=()) -> None:
    """Módulos coplanares sobre mini rieles (cubierta con cota zf(y))."""
    prims = []

    def add(tipo, pts3, capa, rel=None):
        c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
        prims.append((prof(*c), tipo, [P(*q) for q in pts3], capa, rel))

    cos_i = math.cos(math.radians(INCL))
    lm, am, hm = MINIRRIEL
    for fi, f in enumerate(_filas(mods)):
        t0 = f["t0"]
        for s in f["juntas"]:
            for sf in S_FIJ:
                yc = t0 + sf * cos_i
                y0, y1 = yc - lm / 2 * cos_i, yc + lm / 2 * cos_i
                x0, x1 = s - am / 2, s + am / 2
                a0, a1, b0, b1 = zf(y0), zf(y1), zf(y0) + hm, zf(y1) + hm
                for pts in (
                    [(x0, y0, a0), (x0, y1, a1), (x0, y1, b1), (x0, y0, b0)],
                    [(x0, y0, a0), (x1, y0, a0), (x1, y0, b0), (x0, y0, b0)],
                    [(x0, y0, b0), (x1, y0, b0), (x1, y1, b1), (x0, y1, b1)],
                ):
                    add("p", pts, "ESTRUCTURA", "#b0b7bf")
        for im, (sa, sb) in enumerate(f["mods"]):
            ya, yb = t0, t0 + LARGO_MOD * cos_i
            cara = [(sa, ya, zf(ya) + H_MOD), (sb, ya, zf(ya) + H_MOD), (sb, yb, zf(yb) + H_MOD),
                    (sa, yb, zf(yb) + H_MOD)]  # fmt: skip
            if (fi, im) in fantasma:
                add("f", cara, "MODULO")
                continue
            add("p", cara, "MODULO", color)
            ym = (ya + yb) / 2
            add("l", [(sa + 5, ym, zf(ym) + H_MOD + 1), (sb - 5, ym, zf(ym) + H_MOD + 1)], "SOMBRA")
            for s in (sa, sb):
                add("l", [(s, ya, zf(ya) + H_MOD + 1), (s, yb, zf(yb) + H_MOD + 1)], "BRILLO")
    for _p, tipo, pts, capa, rel in sorted(prims, key=lambda q: -q[0]):
        if tipo == "p":
            lam.polilinea(pts, capa, cerrada=True, relleno=rel)
        elif tipo == "f":
            lam.polilinea(pts, capa, cerrada=True, trazo="discontinuo")
        else:
            lam.polilinea(pts, capa)


def _escena(lam, P, prof, g, mods, dc, ac, f=1.0) -> None:
    """Vivienda (vista desde el suroeste), estructura, equipos y rutas."""
    caras = []

    def cara(pts3, capa, rel):
        c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
        caras.append((prof(*c), [P(*q) for q in pts3], capa, rel))

    def prisma(pol, z0, ztop, rel, capa="CUBIERTA"):
        pts = list(pol.exterior.coords)[:-1]
        for a, b in zip(pts, pts[1:] + pts[:1], strict=True):
            cara([(*a, z0), (*b, z0), (*b, ztop(b[1])), (*a, ztop(a[1]))], capa, rel)
        cara([(x, y, ztop(y)) for x, y in pts], capa, rel)

    x0, y0, x1, y1 = g["lote"].bounds
    lam.polilinea([P(x0 - 1500, y0 - 1500, 0), P(x1 + 1500, y0 - 1500, 0),
                   P(x1 + 1500, y1 + 1500, 0), P(x0 - 1500, y1 + 1500, 0)], "NOTA",
                  cerrada=True, relleno="#e2e8da")  # fmt: skip
    prisma(g["terraza"], 0, lambda y: Z_TER, "#efe9de")
    prisma(g["patio_sur"], 0, lambda y: Z_TER, "#efe9de")
    prisma(TECHO, 0, z_techo, "#efece5")
    # Pretiles (tramos sobre cada borde)
    pts = list(TECHO.exterior.coords)[:-1]
    inn = list(g["interior"].exterior.coords)[:-1]
    for a, b in zip(pts, pts[1:] + pts[:1], strict=True):
        ia = min(inn, key=lambda q: math.dist(q, a))
        ib = min(inn, key=lambda q: math.dist(q, b))
        za, zb = z_techo(a[1]), z_techo(b[1])
        cara([(*a, za + PRETIL), (*b, zb + PRETIL), (*ib, zb + PRETIL), (*ia, za + PRETIL)],
             "CUBIERTA", "#e6e2da")  # fmt: skip
        cara([(*a, za), (*b, zb), (*b, zb + PRETIL), (*a, za + PRETIL)], "CUBIERTA", "#e9e5dd")
        cara([(*ia, za), (*ib, zb), (*ib, zb + PRETIL), (*ia, za + PRETIL)], "CUBIERTA", "#dcd8d0")
    for _p, pts_, capa, rel in sorted(caras, key=lambda c: -c[0]):
        lam.polilinea(pts_, capa, cerrada=True, relleno=rel)
    # Franja de ventanas en la fachada oeste (referencia de la foto)
    lam.polilinea([P(X_MURO, 5550, Z_TER + 2500), P(X_MURO, 9000, Z_TER + 2500),
                   P(X_MURO, 9000, Z_TER + 2850), P(X_MURO, 5550, Z_TER + 2850)], "NOTA",
                  cerrada=True, relleno="#5d6d7e")  # fmt: skip
    _minirriel3d(lam, P, prof, mods, z_techo)
    for key, col, capa in (("baterias", "#e9c4ea", "EQUIPO"), ("inversor", "#dbe9f6", "AC"),
                           ("tablero", "#d9d9d9", "EQUIPO")):  # fmt: skip
        _caja(lam, P, EQ[key], col, capa)
    tubo3d(lam, P, dc, 1.6 * f, "#e74c3c", "DC", abrazadera_mm=1500)
    tubo3d(lam, P, ac[:-1], 2.0 * f, "#2e86de", "AC", abrazadera_mm=1500)
    xc, yc, zc = dc[0]
    _caja(lam, P, (xc - 60, xc + 60, yc - 60, yc + 60, zc - 60, zc + 60), "#f4f4f4", "EQUIPO")
    cx0, cy0, cx1, cy1 = CLARABOYA.bounds
    _caja(lam, P, (cx0, cx1, cy0, cy1, Z_TER, Z_TER + 250), "#bcd9ee", "NOTA")
    tubo3d(lam, P, ac[-2:], 2.0 * f, "#2e86de", "AC", abrazadera_mm=1500)
    lam.circulo(P(*BUITRON, Z_TER + 250), 1.4 * f, "ROJO", relleno="#c00000")
    bx, by = BUITRON
    _caja(lam, P, (bx - 100, bx + 100, by - 260, by + 260, *Z_TAB_PC), "#ffffff", "EQUIPO")


def isometrico(lam, area, g, mods, dc, ac) -> None:
    x0, y0, w, h = area
    bx0, by0, bx1, by1 = g["lote"].bounds
    esq = [(x, y, z) for x in (bx0 - 1500, bx1 + 1500) for y in (by0 - 1500, by1 + 1500)
           for z in (0, z_techo(by1) + PRETIL + 300)]  # fmt: skip
    P, prof, _k = _vista((x0 + 3, y0 + 3, w - 6, h - 6), esq, desde="SO")
    _escena(lam, P, prof, g, mods, dc, ac)
    inv, tab, bat = EQ["inversor"], EQ["tablero"], EQ["baterias"]
    rot = [
        (P(*dc[0]), "Arreglo FV · caja de paso, salida string S1.1.1", 1),
        (P(*dc[4]), 'DC: coraza 1" cruza el pretil y baja por la fachada', -1),
        (P(inv[0], (inv[2] + inv[3]) / 2, inv[4] + 250), "Inversor", -1),
        (P(tab[0], (tab[2] + tab[3]) / 2, tab[4] + 400), "Tablero FV", -1),
        (P(bat[0], (bat[2] + bat[3]) / 2, bat[4] + 500), "Baterías", -1),
        (P(*ac[1]), 'AC: IMC 2" junto al piso de la terraza', -1),
        (P(*BUITRON, Z_TER + 250), "Buitrón por la claraboya · baja al 1° piso", 1),
        (P(*BUITRON, (Z_TAB_PC[0] + Z_TAB_PC[1]) / 2), "Tablero P.C. · 1° piso", 1),
        (P(6000, 9000, z_techo(9000) + H_MOD), "Módulos coplanares sobre mini riel", 1),
    ]
    for lado, xcol in ((-1, x0 + 46), (1, x0 + w - 56)):
        items = sorted(((p, t) for p, t, s in rot if s == lado), key=lambda it: -it[0][1])
        y_prev = None
        for p, t in items:
            yq = p[1] + 3 if y_prev is None else min(p[1] + 3, y_prev - 6.5)
            y_prev = yq
            _guia(lam, p, (xcol, yq))
            _caja_texto(lam, (xcol, yq + 1.6), [t], h=1.3, alinear="der" if lado < 0 else "izq")
    lam.texto((x0 + 2, y0 + 2), "Vista desde el suroeste. Alturas supuestas: terraza 3,0 m; "
              "cubierta 6,5 m (borde sur, pendiente 5 %); pretil 0,6 m. Sin escala.", 1.3,
              "NOTA")  # fmt: skip


# ------------------------------------------------------------------------------- detalles
def detalle_minirriel_3d(lam, area, n_mod: int) -> None:
    """Detalle 3D de la fijación con mini riel sobre el panel sándwich (vista desde el suroeste)."""
    x0, y0, w, h = area
    n_v = min(n_mod, 3)
    largo = n_v * ANCHO_MOD + (n_v - 1) * SEP
    cos_i = math.cos(math.radians(INCL))
    fondo = LARGO_MOD * cos_i

    def zf(y):
        return PEND * y

    mods = [box(i * (ANCHO_MOD + SEP), 0, i * (ANCHO_MOD + SEP) + ANCHO_MOD, fondo)
            for i in range(n_v)]  # fmt: skip
    marco = [(x, y, z) for x in (-600, largo + 600) for y in (-600, fondo + 600)
             for z in (-60, zf(fondo) + 400)]  # fmt: skip
    P, prof, _k = _vista((x0 + 2, y0 + 8, w - 58, h - 12), marco, desde="SO")
    # Panel sándwich con crestas
    xs0, xs1, ys0, ys1 = -500, largo + 500, -500, fondo + 500
    lam.polilinea([P(xs0, ys0, zf(ys0)), P(xs1, ys0, zf(ys0)), P(xs1, ys1, zf(ys1)),
                   P(xs0, ys1, zf(ys1))], "CUBIERTA", cerrada=True, relleno="#dfe3e8")  # fmt: skip
    xc = xs0 + 40
    while xc < xs1:
        lam.polilinea([P(xc - 20, ys0, zf(ys0) + 1), P(xc - 20, ys1, zf(ys1) + 1)], "NOTA")
        lam.polilinea([P(xc + 20, ys0, zf(ys0) + 1), P(xc + 20, ys1, zf(ys1) + 1)], "NOTA")
        xc += PASO_CRESTA
    _minirriel3d(lam, P, prof, mods, zf, color="#3d6aa8", fantasma={(0, n_v - 1)})
    _cota(lam, P(0, -350, zf(-350)), P(largo, -350, zf(-350)), f"{largo:.0f}", off=-2.5, h=1.2)
    _cota(lam, P(largo + 350, 0, zf(0)), P(largo + 350, fondo, zf(fondo)),
          f"{LARGO_MOD:.0f} ({INCL:.1f}°)", off=-2.5, h=1.2)  # fmt: skip
    xr = x0 + w - 54
    sj = n_v * (ANCHO_MOD + SEP) - SEP
    rot = [
        (
            P(ANCHO_MOD / 2, fondo * 0.6, zf(fondo * 0.6) + H_MOD),
            "Módulo JAM72D40 595 Wp, coplanar",
        ),
        (P(sj, S_FIJ[1] * cos_i, zf(S_FIJ[1]) + 40), "Mini riel sobre cresta (a 542 mm del borde)"),
        (P(sj, S_FIJ[0] * cos_i, zf(S_FIJ[0]) + 20), "Tornillos autoperforantes + EPDM"),
        (P(ANCHO_MOD + SEP / 2, 0, zf(0) + H_MOD), "Mid clamp en juntas · end clamp en extremos"),
        (
            P(largo + 200, fondo + 300, zf(fondo + 300)),
            "Panel sándwich (crestas a lo largo de la pendiente)",
        ),
    ]
    rot.sort(key=lambda it: -it[0][1])
    y_prev = None
    for p_, t in rot:
        yq = p_[1] + 3 if y_prev is None else min(p_[1] + 3, y_prev - 6)
        y_prev = yq
        _guia(lam, p_, (xr, yq))
        _caja_texto(lam, (xr, yq + 1.5), [t], h=1.1)
    lam.texto((x0 + 2, y0 + 2), f"Se muestran {n_v} módulos; la hilera de {n_mod} se arma igual. "
              "Paso de crestas esquemático.", 1.1, "NOTA")  # fmt: skip


def corte_minirriel(lam, x, y) -> None:
    """Corte transversal (perpendicular a las crestas) por una junta entre módulos, ESC 1:5."""
    k = 1 / 5
    # Panel sándwich: chapa trapezoidal sobre aislamiento
    base = y + 10
    lam.rect(x, base - 50 * k, 160, 50 * k, "CUBIERTA", relleno="#f3e6b3")
    xs = [x + 14 + i * PASO_CRESTA * k for i in range(3)]
    perfil = [(x, base)]
    for xc in xs:
        perfil += [(xc - 60 * k, base), (xc - 20 * k, base + 40 * k), (xc + 20 * k, base + 40 * k),
                   (xc + 60 * k, base)]  # fmt: skip
    perfil.append((x + 160, base))
    lam.polilinea(perfil, "CUBIERTA")
    lam.texto((x + 1, base - 6.5), "Panel sándwich (aislamiento)", 1.1, "NOTA")
    # Mini riel sobre la cresta central y módulos a cada lado
    xc = xs[1]
    zc = base + 40 * k
    lam.rect(xc - 20 * k, zc, 40 * k, 40 * k, "ESTRUCTURA", relleno="#b0b7bf")
    for dx in (-12, 12):
        lam.linea((xc + dx * k, zc + 40 * k), (xc + dx * k, zc - 25 * k), "TEXTO")
    zt = zc + 40 * k
    for lado in (-1, 1):
        x_in = xc + lado * SEP / 2 * k
        x_out = x_in + lado * 56
        lam.rect(min(x_in, x_out), zt, 56, 35 * k, "MODULO", relleno="#3d6aa8")
    lam.rect(xc - 12 * k, zt + 35 * k, 24 * k, 6 * k, "ESTRUCTURA", relleno="#8b5e3c")
    lam.linea((xc, zt + 41 * k), (xc, zc + 10 * k), "TEXTO")
    _cota(lam, (xc - SEP / 2 * k, zt + 35 * k + 2), (xc + SEP / 2 * k, zt + 35 * k + 2),
          f"{SEP:.0f}", off=4, h=1.1)  # fmt: skip
    _cota(lam, (xs[1] + 60 * k + 3, zc - 40 * k), (xs[1] + 60 * k + 3, zt + 35 * k),
          f"≈ {H_MOD + 40:.0f}*", off=-4, h=1.1)  # fmt: skip
    _cota(lam, (xs[1], base - 50 * k - 3), (xs[2], base - 50 * k - 3), f"{PASO_CRESTA:.0f}*",
          off=-2, h=1.1)  # fmt: skip
    _caja_texto(lam, (xc + 16, zt + 35 * k + 12), ["Mid clamp con grounding"], h=1.1)
    _guia(lam, (xc, zt + 38 * k), (xc + 16, zt + 35 * k + 10))
    _caja_texto(lam, (xc - 30, zc + 10), ["Mini riel", "(sobre la cresta)"], h=1.1, alinear="der")
    _guia(lam, (xc - 20 * k, zc + 20 * k), (xc - 30, zc + 8))
    _caja_texto(lam, (xc + 22, zc - 1), ["Tornillo autoperforante", "con arandela EPDM"], h=1.1)
    _guia(lam, (xc + 12 * k, zc - 10 * k), (xc + 22, zc - 3))
    lam.texto((x, y - 4), "* Esquemático: alturas, paso de crestas y tornillería según el "
              "fabricante del mini riel y del panel.", 1.1, "NOTA")  # fmt: skip


def detalle_equipos(lam, x, y, d) -> None:
    """Alzado de la fachada oeste vista desde la terraza (norte a la izquierda), ESC 1:70."""
    b = d["bat"]
    k = 1 / 70
    ya, yb = Y_MURO
    W = (yb - ya) * k
    Hm = (z_techo(yb) + PRETIL - Z_TER) * k

    def px(ym, zm):
        return (x + (yb - ym) * k, y + (zm - Z_TER) * k)

    lam.polilinea([px(yb, Z_TER), px(ya, Z_TER), px(ya, z_techo(ya) + PRETIL),
                   px(yb, z_techo(yb) + PRETIL)], "CUBIERTA", cerrada=True,
                  relleno="#f1dfc7")  # fmt: skip
    lam.polilinea([px(yb, z_techo(yb)), px(ya, z_techo(ya))], "NOTA", trazo="discontinuo")
    lam.rect(x - 3, y - 1.2, W + 6, 1.2, "CUBIERTA", relleno="#bdbdbd")
    p0, p1 = px(9000, Z_TER + 2500), px(5550, Z_TER + 2850)
    q0, q1 = px(Y_LISTON[1], Z_TER), px(Y_LISTON[0], Z_TER + 2400)
    lam.rect(q0[0], q0[1], q1[0] - q0[0], q1[1] - q0[1], "NOTA", relleno="#c8915a")
    for i in range(1, 12):
        yl = q0[1] + i * (q1[1] - q0[1]) / 12
        lam.linea((q0[0], yl), (q1[0], yl), "NOTA")
    lam.texto(((q0[0] + q1[0]) / 2, q1[1] + 1.2), "listón", 1.0, "NOTA", "centro")
    lam.rect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1], "NOTA", relleno="#5d6d7e")
    lam.texto((x + W / 2, y + Hm + 2), "FACHADA OESTE · TERRAZA DEL 2° PISO", 1.4, "NOTA", "centro")
    lam.texto((x + 1, y - 3.2), "Piso de la terraza (2° piso)", 1.1, "NOTA")
    lam.texto((x + W - 1, y - 3.2), "SUR →", 1.1, "NOTA", "der")
    lam.texto((x + 1, y + Hm - 2.5), "← NORTE", 1.1, "NOTA")

    def r(bx, col, capa, t1, t2=""):
        _, _, ya_, yb_, za, zb = bx
        q0, q1 = px(yb_, za), px(ya_, zb)
        lam.rect(q0[0], q0[1], q1[0] - q0[0], q1[1] - q0[1], capa, relleno=col)
        lam.texto(((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2), t1, 1.1, "TEXTO", "centro",
                  negrita=True)  # fmt: skip
        if t2:
            lam.texto(((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2 - 2), t2, 0.9, "TEXTO", "centro")

    r(EQ["baterias"], "#f6e0f6", "EQUIPO", "BATERÍAS", f"{b['n']} mód. · {_f(b['kwh'])} kWh")
    r(EQ["inversor"], "#e9eef3", "AC", "INV.")
    r(EQ["tablero"], "#e6e6e6", "EQUIPO", "T.FV")
    inv, tab, bat = EQ["inversor"], EQ["tablero"], EQ["baterias"]
    yi, yt = (inv[2] + inv[3]) / 2, (tab[2] + tab[3]) / 2
    y_dc = _Y_DC[0]
    tubo(lam, [px(y_dc, z_techo(y_dc) + PRETIL + 300), px(y_dc, Z_TER + 1900), px(yi, Z_TER + 1900),
               px(yi, inv[5])], 1.1, "DC", "#f6c9c4", abrazaderas=7)  # fmt: skip
    tubo(lam, [px(yt, tab[4]), px(yt, Z_TER + 150), px(Y_BAJANTE, Z_TER + 150),
               px(Y_BAJANTE, Z_TER - 700)], 1.5, "AC", "#cfe0f5", abrazaderas=7)  # fmt: skip
    c0, c1 = px(CLARABOYA.bounds[3], Z_TER - 120), px(CLARABOYA.bounds[1], Z_TER)
    lam.rect(c0[0], c0[1], c1[0] - c0[0], c1[1] - c0[1], "NOTA", relleno="#bcd9ee")
    lam.texto(((c0[0] + c1[0]) / 2, c0[1] - 2.2), "claraboya (buitrón ↓)", 1.0, "AC", "centro")
    tubo(lam, [px(inv[2], Z_TER + 1300), px(tab[3], Z_TER + 1300)], 1.2, "AC", "#cfe0f5")
    tubo(lam, [px(bat[2] + 200, bat[5]), px(bat[2] + 200, Z_TER + 1250), px(inv[3], Z_TER + 1250)],
         1.0, "DC", "#f6c9c4")  # fmt: skip
    caja_paso(lam, px(Y_BAJANTE + 250, Z_TER + 150), 2.2)
    _caja_texto(lam, (x - 2, y + Hm - 2), ['DC: coraza 1" cruza el pretil',
                "Cable FV 2x4 mm² + 1N° 8 AWG Cu"], h=1.1, alinear="der")  # fmt: skip
    _guia(lam, px(y_dc, z_techo(y_dc)), (x - 2, y + Hm - 5))
    _caja_texto(lam, (x + W + 4, y + 16), ['AC: IMC 2" al buitrón de la claraboya',
                "2 x [3N° 6 + 1N° 6 (N) + 1N° 6 (T)] Cu", "Caja de paso 10x10 IP66"],
                h=1.1)  # fmt: skip
    _guia(lam, px(Y_BAJANTE + 250, Z_TER + 150), (x + W + 4, y + 12))
    _caja_texto(lam, (x + W + 4, y + Hm - 4), ["Franja de ventanas", "(referencia de la foto)"],
                h=1.1)  # fmt: skip
    _guia(lam, px(5400, Z_TER + 2700), (x + W + 4, y + Hm - 7))
    _caja_texto(lam, (x - 2, y + 12), ['Coraza 1" cable de baterías', 'Coraza ¾" comunicaciones',
                f"Inversor {d['inversor_modelo']}"], h=1.1, alinear="der")  # fmt: skip


_Y_DC = [5500.0]  # se actualiza con la ruta DC calculada


def detalle_punto_conexion(lam, x, y) -> None:
    """Corte: buitrón por la claraboya hasta el tablero del 1° piso, ESC 1:60."""
    k = 1 / 60
    H = (Z_TER + 1500) * k
    lam.rect(x + 30, y, 3, H, "CUBIERTA", relleno="#d9d4cb")  # muro
    lam.rect(x, y + Z_TER * k - 2, 30, 2, "CUBIERTA", relleno="#bdbdbd")  # placa de la terraza
    lam.texto((x + 1, y + Z_TER * k + 0.8), "Piso de la terraza (2° piso)", 1.1, "NOTA")
    lam.rect(x + 12, y + Z_TER * k - 2, 18, 2 + 250 * k, "NOTA", relleno="#bcd9ee")
    lam.texto((x + 15, y + (Z_TER + 250) * k + 0.8), "CLARABOYA", 1.0, "NOTA")
    xt = x + 26
    tubo(lam, [(xt, y + (Z_TER + 1200) * k), (xt, y + (Z_TER + 150) * k),
               (xt, y + Z_TAB_PC[1] * k)], 1.6, "AC", "#cfe0f5", abrazaderas=8)  # fmt: skip
    caja_paso(lam, (xt, y + (Z_TER + 150) * k), 2.4)
    lam.circulo((xt, y + Z_TER * k - 1), 1.0, "ROJO", relleno="#c00000")
    lam.rect(xt - 4, y + Z_TAB_PC[0] * k, 8, (Z_TAB_PC[1] - Z_TAB_PC[0]) * k, "EQUIPO",
             relleno="#ffffff")  # fmt: skip
    for i in range(4):
        lam.linea((xt - 3, y + Z_TAB_PC[0] * k + 2 + i * 2.4), (xt + 3, y + Z_TAB_PC[0] * k + 2 +
                  i * 2.4), "NOTA")  # fmt: skip
    lam.texto((xt, y + Z_TAB_PC[0] * k - 3), "TABLERO EXISTENTE (P.C.) · 1° PISO", 1.2, "TEXTO",
              "centro", negrita=True)  # fmt: skip
    _caja_texto(lam, (x + 36, y + (Z_TER + 1200) * k + 2), ["Viene del tablero FV por la fachada",
                'oeste hasta el listón (IMC 2")'], h=1.15)  # fmt: skip
    _caja_texto(lam, (x + 36, y + (Z_TER + 150) * k + 2), ["Caja de paso 10x10 cm IP66"], h=1.15)
    _caja_texto(lam, (x + 36, y + (Z_TER - 300) * k), ["Buitrón por la claraboya,",
                "sellado contra el agua"], h=1.15)  # fmt: skip
    _guia(lam, (xt + 1, y + Z_TER * k - 1), (x + 36, y + (Z_TER - 300) * k - 2))
    _caja_texto(lam, (x + 36, y + Z_TAB_PC[1] * k),
                ["Ubicación del tablero existente", "supuesta: verificar en obra"],
                capa="ROJO", h=1.15)  # fmt: skip


# ------------------------------------------------------------------------------- láminas
def laminas(d: dict[str, Any], fecha: str, disenador: str = "") -> list[Lamina]:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "cajetin.json")
    g = geometria()
    mods = colocar(g, d["modulos"])
    dc, ac, desc_dc, desc_ac, L = rutas(g, mods)
    _Y_DC[0] = dc[0][1]
    conj = json.loads((INSUMOS / "pance.json").read_text(encoding="utf-8"))
    titulo = f"CASA {d['casa']} - PANCE CAMPESTRE"
    orient = f"Sur (180°), coplanar {INCL:.1f}°"
    notas = [
        f"Sistema de {d['modulos']} módulos JA Solar de 595 Wp ({_f(d['kwp'])} kWp) y un inversor "
        f"{d['inversor_modelo']}.",
        f"Módulos coplanares sobre mini riel en una hilera mirando al sur a {INCL:.1f}°; "
        f"retiro de {RETIRO / 1000:.1f} m a los pretiles.",
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
    iw = 62
    lam.imagen(INSUMOS / "pance16_maps.png", 14, 194, iw, iw * 472 / 528)
    lam.rect(14, 194, iw, iw * 472 / 528, "CAJETIN")
    fw = 24
    lam.imagen(INSUMOS / "pance16_fachada.jpg", 80, 194, fw, fw * 1600 / 734 * 0.62)
    _titulo_vista(lam, 14, 188, 1, "Medición en Maps y fachada")
    lam.texto((22, 183.5), f"Conjunto: {conj['lat']:.5f}, {conj['lon']:.5f} · Cali · 142,25 m²",
              1.4, "NOTA")  # fmt: skip
    _resumen(lam, 14, 178, d, mods, ancho=96, orientacion=orient,
             estructura="Coplanar, mini riel")  # fmt: skip
    m = Marco(g["lote"].union(box(0, 0, 11830, 14600)), (112, 100, 140, 152),
              n_opciones=(75, 100, 125))  # fmt: skip
    _planta(lam, m, g, mods)
    _norte(lam, 246, 248)
    _escala(lam, 116, 100, m.n)
    _titulo_vista(lam, 116, 94, 2, "Distribución de módulos", f"ESC 1:{m.n}")
    planta_fijacion(lam, 22, 82, d["modulos"])
    _titulo_vista(lam, 14, 142, 3, "Planta de fijación con mini riel", "ESC 1:50 (cotas en mm)")
    tabla_materiales_compacta(lam, 256, 250, materiales_obra(d, L))
    cerrar(lam, ["Materiales: cableado y canalización sobre la ruta 3D + 10 % de reserva."])

    # --- Hoja 2 ----------------------------------------------------------------------------
    lam = nueva(2, "RUT", "Rutas de cableado DC y AC")
    lam.texto((14, 258), f"RUTAS DE CABLEADO DC Y AC · {titulo}", 3.0, "TEXTO", negrita=True)
    m = Marco(g["lote"].union(box(0, 0, 11830, 14600)), (14, 66, 256, 182),
              n_opciones=(50, 75, 100))  # fmt: skip
    _planta(lam, m, g, mods)
    i_fach = next(i for i, q in enumerate(dc) if abs(q[0] - X_EQ) < 1)
    dc_p = [q[:2] for q in dc[: i_fach + 1]]
    dc_p = [q for i, q in enumerate(dc_p) if i == 0 or math.dist(q, dc_p[i - 1]) > 1]
    dc_f = [q[:2] for q in dc[i_fach:]]
    dc_f = [q for i, q in enumerate(dc_f) if i == 0 or math.dist(q, dc_f[i - 1]) > 1]
    ac_p = [(q[0] - 450 if abs(q[0] - X_EQ) < 1 else q[0], q[1]) for q in ac]
    ac_p = [q for i, q in enumerate(ac_p) if i == 0 or math.dist(q, ac_p[i - 1]) > 1]
    ruta_planta(lam, m, dc_p, "DC", "#f6c9c4", "DC-")
    if len(dc_f) > 1:
        ruta_planta(lam, m, [(q[0] - 200, q[1]) for q in dc_f], "DC", "#f6c9c4", "DC-F")
    ruta_planta(lam, m, ac_p, "AC", "#cfe0f5", "AC-")
    caja_paso(lam, m(dc_p[0]), 2.4)
    for p, t, capa in ((dc_p[-1], "↓", "DC"), (BUITRON, "↓", "ROJO")):
        lam.circulo(m(p), 1.6, capa)
        lam.texto(m(p), t, 1.6, capa, "centro", negrita=True)
    _norte(lam, 258, 248)
    _escala(lam, 16, 66, m.n)
    _titulo_vista(lam, 16, 60, 1, "Rutas de cableado DC y AC", f"ESC 1:{m.n}")
    _caja_texto(lam, (278, 104), [
        "RUTA DC (rojo)", 'Coraza 1" adosada a la cubierta, soportes c/ 1,5 m',
        "Cable FV 2x4 mm² (+/-) + 1N° 8 AWG Cu verde",
        f"Cruza el pretil oeste y baja {L['dc_vertical']:.1f} m por la fachada (↓)",
        f"Longitud total DC: {L['dc_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _caja_texto(lam, (278, 80), [
        "RUTA AC (azul)", 'IMC 2" por la fachada oeste, junto al piso de la terraza',
        "2 x [3N° 6 AWG (F) + 1N° 6 (N) + 1N° 6 (T)] Cu",
        f"Baja {L['ac_bajante']:.1f} m por el buitrón de la claraboya al 1° piso (↓)",
        f"Longitud total AC: {L['ac_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _detalle_dc(lam, 278, 112, d, "Cruza el pretil y baja por la fachada oeste")
    cerrar(lam, ["Cable tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc para conductores DC.",
                 "Rutas sobre la fachada desplazadas en planta para que se lean."])  # fmt: skip

    # --- Hoja 3 ----------------------------------------------------------------------------
    lam = nueva(3, "EQP", "Esquema 3D, ubicación de equipos y punto de conexión")
    lam.texto((14, 258), f"UBICACIÓN DE EQUIPOS Y PUNTO DE CONEXIÓN · {titulo}", 3.0, "TEXTO",
              negrita=True)  # fmt: skip
    isometrico(lam, (14, 58, 200, 186), g, mods, dc, ac)
    _titulo_vista(lam, 16, 248, 1, "Esquema 3D de rutas DC (rojo) y AC (azul)", "SIN ESCALA")
    detalle_equipos(lam, 270, 166, d)
    _titulo_vista(lam, 222, 248, 2, "Fachada oeste: equipos (terraza 2° piso)", "ESC 1:70")
    lam.imagen(INSUMOS / "pance16_muro.png", 222, 66, 70, 70 * 382 / 561)
    lam.rect(222, 66, 70, 70 * 382 / 561, "CAJETIN")
    lam.texto((222, 62), "Foto de referencia del muro (usuario)", 1.2, "NOTA")
    detalle_punto_conexion(lam, 320, 66)
    _titulo_vista(lam, 222, 150, 3, "Detalle hasta el punto de conexión", "ESC 1:60")
    cerrar(lam, ["Alimentador AC en 6 AWG Cu hasta el punto final del tablero de conexión."])

    # --- Hoja 4 ----------------------------------------------------------------------------
    lam = nueva(4, "DET", "Detalles de estructura con mini riel y rutas DC / AC")
    lam.texto((14, 258), f"DETALLES CONSTRUCTIVOS · {titulo}", 3.0, "TEXTO", negrita=True)
    _titulo_vista(lam, 16, 248, 1, "Fijación con mini riel sobre panel sándwich",
                  "SIN ESCALA (cotas en mm)")  # fmt: skip
    detalle_minirriel_3d(lam, (14, 150, 214, 92), d["modulos"])
    _titulo_vista(lam, 234, 248, 2, "Corte por una junta entre módulos", "ESC 1:5 (cotas en mm)")
    corte_minirriel(lam, 240, 196)

    def escena(lam_, P, prof, f):
        _escena(lam_, P, prof, g, mods, dc, ac, f)

    def vista(area, pts):
        return _vista(area, pts, desde="SO")

    _titulo_vista(lam, 16, 146, 3, "Ruta DC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta(lam, (14, 58, 196, 84), dc, desc_dc, "dc", vista, escena, NOTAS_RUTA["dc"])
    _titulo_vista(lam, 214, 146, 4, "Ruta AC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta(lam, (212, 58, 196, 84), ac, desc_ac, "ac", vista, escena, [
        'C1 a C{nc}: {nc} curvas IMC 2" de 90° (fabricadas).',
        'Uniones IMC 2" cada 3 m; abrazaderas cada 1,5 m',
        "y a 30 cm de cada curva y de cada caja.",
        "Buitrón por la claraboya, sellado contra el agua.",
        "Tablero del 1° piso: ubicación supuesta, verificar.",
    ])  # fmt: skip
    cerrar(lam, [
        "Longitudes de tramo medidas sobre el eje de la tubería en el modelo 3D (sin reserva).",
        "Perforaciones en la cubierta selladas; no pisar el panel fuera de las crestas.",
    ])  # fmt: skip
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m engine.planos.casas_pance")
    p.add_argument("excel", type=Path)
    p.add_argument("--casa", default="16")
    p.add_argument("--fecha", default=dt.date.today().isoformat())
    args = p.parse_args(argv)
    bib = validar.cargar_biblioteca()
    casas = pvsyst.leer_casas(args.excel)
    modulo = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, _ = pvsyst.plan(casas, modulo)
    sel = [(c, f) for c, f in zip(casas, filas, strict=True)
           if _slug(c["proyecto"]) == _slug("PANCE CAMPESTRE")
           and _slug(str(c["casa"])) == _slug(args.casa)]  # fmt: skip
    if not sel:
        print("Casa no encontrada en Pance Campestre.")
        return 1
    d = datos_casa(*sel[0], bib)
    lams = laminas(d, args.fecha, _disenador())
    ruta = a_pdf(lams, SALIDA / f"PRO-ELE-PANCE-C{_slug(args.casa)}-PLANOS.pdf")
    print(ruta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
