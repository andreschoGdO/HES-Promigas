"""Planos de la vivienda Portón de la Rivera 28 (Cali): teja española a dos aguas con riel completo.

Hojas: 1) localización y distribución de módulos con la planta de fijación y materiales;
2) rutas DC y AC en planta; 3) esquema 3D, equipos en la losa y punto de conexión;
4) detalles: estructura de riel sobre teja en 3D, corte por la teja y rutas DC / AC ampliadas.

Geometría: captura de Google Maps con "Medir distancia" (99,83 m², 76,92 m; escala por área y por
perímetro igual al 0,2 %), rectificada en el marco de la vivienda (girada 8,1° respecto al norte).
Cubierta en E: tres cubiertas a dos aguas con cumbrera este-oeste separadas por limahoyas
(usuario). Supuestos marcados en `SUPUESTOS`.

Uso: python -m engine.planos.casas_porton <excel> [--casa 28] [--fecha AAAA-MM-DD]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

from shapely.geometry import box

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
    _fusionar,
    _guia,
    _largos,
    _norte,
    _resumen,
    _titulo_vista,
    _vista,
    caja_paso,
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
# Marco de la vivienda: x a lo largo de las cumbreras (≈ este), y ≈ norte; origen al suroeste
GIRO_DEG = 8.1  # la vivienda está girada 8,1° (antihorario) respecto al norte (Maps)
INCL = 15.0  # inclinación de la teja (usuario)
TAN = math.tan(math.radians(INCL))
COS = math.cos(math.radians(INCL))
Z_LOSA = 7800.0  # losa de equipos (usuario: "casi 8 m")
Z_ALERO = Z_LOSA + 1700  # alero: el ladrillo sube 1,2 a 2,4 m sobre la losa (foto; supuesto)
Z_CIELO = 2700.0  # cielo falso del 1° piso (supuesto)
# Cubiertas a dos aguas (x0, x1, y0, y1): cumbrera al centro en y; limahoyas en y = 5120 y 8370
G_NORTE = (1950.0, 11800.0, 8370.0, 11645.0)
G_MEDIO = (300.0, 11800.0, 5120.0, 8370.0)
G_SUR_O = (0.0, 6900.0, 0.0, 5120.0)  # bloque sur, al oeste de la losa (testero de ladrillo)
G_SUR_E = (9480.0, 11800.0, 0.0, 5120.0)  # bloque sur, al este de la losa (muro blanco)
LOSA = (6900.0, 9480.0, 0.0, 4206.0)  # losa de los equipos (flecha del usuario)
X_LADRILLO, X_BLANCO = LOSA[0], LOSA[1]
# Módulos horizontales en las aguas sur, dos hileras rectas con el mismo arranque al oeste
X_INICIO = 2300.0
SEP = 20.0
H_MOD = 160.0  # cara superior del módulo sobre la teja: anclaje + riel + marco (supuesto)
RIEL_DESDE_BORDE = ANCHO_MOD / 4  # rieles a 1/4 del ancho del módulo (esquemático, ver manual)
PASO_ANCLAJE = 1200.0  # separación máxima entre anclajes por riel (supuesto, según fabricante)
# Equipos en el testero de ladrillo (cara x = X_LADRILLO, mirando al este), sobre la losa
X_EQ = X_LADRILLO + 90  # eje de las tuberías sobre el muro
EQ = {
    "tablero": (X_LADRILLO, X_LADRILLO + 200, 900, 1300, Z_LOSA + 800, Z_LOSA + 1600),
    "baterias": (X_LADRILLO, X_LADRILLO + 385, 1800, 2340, Z_LOSA, Z_LOSA + 870),  # GB-L 3 mód.
    "inversor": (X_LADRILLO, X_LADRILLO + 247, 2800, 3208, Z_LOSA + 1000, Z_LOSA + 1678),
}
X_BAJADA, Y_BAJADA = X_BLANCO - 90, 150.0  # baja por el muro blanco (usuario)
TABLERO_PC = (X_LADRILLO, 2800.0)  # tablero existente: centro de la casa, cocina (supuesto)
Z_TAB_PC = (1100.0, 1900.0)
SUPUESTOS = [
    "Cubierta según Maps (99,83 m²) rectificada; teja a 15° (usuario); losa a 7,8 m (usuario); "
    "alero a 9,5 m y cielo falso del 1° piso a 2,7 m (supuestos).",
    "Anclajes en L para teja, riel y tornillería según el fabricante; retirar y reponer la teja "
    "en cada anclaje y sellar la perforación.",
]


def _cubiertas() -> list[tuple[float, float, float, float]]:
    return [G_NORTE, G_MEDIO, G_SUR_O, G_SUR_E]


def z_agua_sur(g, y: float) -> float:
    """Cota de la teja en el agua sur de la cubierta g (sube hacia la cumbrera)."""
    return Z_ALERO + (y - g[2]) * TAN


def hileras(n: int) -> list[dict[str, Any]]:
    """Hileras horizontales centradas en las aguas sur de las cubiertas norte y media."""
    prof = ANCHO_MOD * COS  # proyección del módulo horizontal sobre el agua
    out = []
    for g, k in ((G_NORTE, n - (n * 4) // 7), (G_MEDIO, (n * 4) // 7)):
        if k <= 0:
            continue
        agua = (g[3] - g[2]) / 2
        y0 = g[2] + (agua - prof) / 2
        largo = k * LARGO_MOD + (k - 1) * SEP
        if X_INICIO + largo > g[1] - 300 or prof > agua - 100:
            raise ValueError(f"no caben {k} módulos en la cubierta {g}")
        out.append({"g": g, "n": k, "x0": X_INICIO, "y0": y0, "y1": y0 + prof, "largo": largo})
    return out


def modulos(filas) -> list[tuple[float, float, float, float]]:
    return [(f["x0"] + i * (LARGO_MOD + SEP), f["y0"], f["x0"] + i * (LARGO_MOD + SEP) + LARGO_MOD,
             f["y1"]) for f in filas for i in range(f["n"])]  # fmt: skip


def anclajes(f) -> list[float]:
    """Posiciones x de los anclajes de un riel (a 200 mm de los extremos, ≤ PASO_ANCLAJE)."""
    a, b = f["x0"] + 200, f["x0"] + f["largo"] - 200
    k = math.ceil((b - a) / PASO_ANCLAJE)
    return [a + (b - a) * i / k for i in range(k + 1)]


def rutas(filas):
    """Rutas 3D (mm, marco de la vivienda) y longitudes (m)."""
    fb = filas[-1]  # hilera de la cubierta media: sale el string hacia la losa
    g = fb["g"]
    xc = fb["x0"] + fb["largo"] + 150
    yc = (fb["y0"] + fb["y1"]) / 2
    x_l = 9200.0  # cruce de la franja norte del bloque sur hacia la losa
    z_franja = Z_ALERO + (G_SUR_O[3] - LOSA[3]) * TAN  # borde de la franja sobre la losa
    inv = EQ["inversor"]
    yi = (inv[2] + inv[3]) / 2
    dc = _fusionar([
        (xc, yc, z_agua_sur(g, yc) + 80), (xc, g[2] + 120, Z_ALERO + 80),  # baja por la teja
        (x_l, g[2] + 120, Z_ALERO + 80),  # por la limahoya hacia el oeste
        (x_l, LOSA[3] + 60, z_franja + 80),  # sube por la franja del bloque sur
        (x_l, LOSA[3] - 100, z_franja + 80), (x_l, LOSA[3] - 100, Z_LOSA + 150),  # a la losa
        (X_EQ, LOSA[3] - 100, Z_LOSA + 150), (X_EQ, yi, Z_LOSA + 150), (X_EQ, yi, inv[4]),
    ])  # fmt: skip
    fa = filas[0]
    xp = fa["x0"] + fa["largo"] + 120
    gm = G_MEDIO
    ym = (gm[2] + gm[3]) / 2
    puente = [  # entre hileras: baja a la limahoya, cruza la cubierta media por la cumbrera
        (xp, (fa["y0"] + fa["y1"]) / 2, z_agua_sur(fa["g"], (fa["y0"] + fa["y1"]) / 2) + 80),
        (xp, fa["g"][2] + 60, Z_ALERO + 80), (xp, ym, Z_ALERO + (ym - gm[2]) * TAN + 80),
        (xp, fb["y1"] + 100, z_agua_sur(gm, fb["y1"] + 100) + 80),
    ]  # fmt: skip
    tab = EQ["tablero"]
    yt = (tab[2] + tab[3]) / 2
    ac = _fusionar([
        (X_EQ, yt, tab[4]), (X_EQ, yt, Z_LOSA + 150), (X_EQ, Y_BAJADA, Z_LOSA + 150),
        (X_BAJADA, Y_BAJADA, Z_LOSA + 150),  # por la losa hasta el muro blanco
        (X_BAJADA, Y_BAJADA, Z_CIELO),  # baja por el muro blanco
        (X_BAJADA, TABLERO_PC[1], Z_CIELO),  # cielo falso hacia el centro de la casa
        (TABLERO_PC[0], TABLERO_PC[1], Z_CIELO),  # y hacia el muro de ladrillo (cocina)
        (TABLERO_PC[0], TABLERO_PC[1], Z_TAB_PC[1]),
    ])  # fmt: skip
    desc_dc = [
        "Caja de paso del arreglo, baja por la teja a la limahoya",
        "Por la limahoya hacia el oeste",
        "Sube por la franja norte del bloque sur",
        "Cruza el borde de la franja",
        "Baja a la losa de equipos",
        "Junto al piso de la losa, hacia el muro de ladrillo",
        "Junto al piso, hasta el inversor",
        "Sube a la entrada DC del inversor (por debajo)",
    ]
    desc_ac = [
        "Baja del tablero FV al piso de la losa",
        "Junto al piso, al borde sur de la losa",
        "Por el borde de la losa hasta el muro blanco",
        "Baja por el muro blanco hasta el cielo falso",
        "Cielo falso hacia el centro de la casa",
        "Cielo falso hacia el muro de ladrillo (cocina)",
        "Baja al tablero de distribución (P.C.)",
    ]
    if len(desc_dc) != len(dc) - 1:
        desc_dc = [f"Tramo {i}" for i in range(1, len(dc))]
    if len(desc_ac) != len(ac) - 1:
        desc_ac = [f"Tramo {i}" for i in range(1, len(ac))]
    n_anc = sum(2 * len(anclajes(f)) for f in filas)
    riel = sum(2 * (f["largo"] + 120) / 1000 for f in filas)
    mid = sum(2 * (f["n"] - 1) for f in filas)
    L = {
        "dc_total": sum(_largos(dc)) + sum(_largos(puente)),
        "ac_total": sum(_largos(ac)),
        "dc_vertical": (z_franja - Z_LOSA) / 1000,
        "curvas_ac": len(ac) - 2,
        "ubic_bat": "En la losa, junto al muro de ladrillo",
        "obs_ac": "Losa, muro blanco y cielo falso",
        "estructura": {"fila_m": sum(f["largo"] for f in filas) / 1000},
        "n_anclajes": n_anc,
        "filas_estructura": [
            ("ESTRUCTURA RIEL", "Riel de aluminio para módulos", "m", math.ceil(riel),
             "2 rieles por hilera"),
            ("", "Anclaje en L para teja española (varilla roscada)", "und", n_anc,
             f"c/ ≤ {PASO_ANCLAJE / 1000:.1f} m por riel"),
            ("", "Mid clamp (con grounding)", "und", mid, ""),
            ("", "End clamp (con grounding)", "und", 4 * len(filas), ""),
            ("", "Grounding lug para estructura", "und", 2, ""),
            ("", "Sellante / cinta butílica para la teja", "und", 2, "Perforaciones"),
        ],
    }  # fmt: skip
    return dc, ac, puente, desc_dc, desc_ac, L


# ------------------------------------------------------------------------------- planta
def _planta(lam, m: Marco, filas, rotulos=True) -> None:
    for g in _cubiertas():
        x0, x1, y0, y1 = g
        lam.polilinea([m(q) for q in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], "CUBIERTA",
                      cerrada=True, relleno="#ead7c8")  # fmt: skip
        yc = (y0 + y1) / 2
        lam.polilinea([m((x0, yc)), m((x1, yc))], "NOTA", trazo="discontinuo")  # cumbrera
        for xf in (x0 + 900, x1 - 900):  # flechas de caída de agua
            lam.texto(m((xf, (y0 + yc) / 2)), "↓", 1.4, "NOTA", "centro")
            lam.texto(m((xf, (yc + y1) / 2)), "↑", 1.4, "NOTA", "centro")
    lx0, lx1, ly0, ly1 = LOSA
    yn = G_SUR_O[3]  # franja del agua norte del bloque sur, sobre la losa
    lam.polilinea([m(q) for q in ((lx0, ly1), (lx1, ly1), (lx1, yn), (lx0, yn))], "CUBIERTA",
                  cerrada=True, relleno="#ead7c8")  # fmt: skip
    lam.texto(m(((lx0 + lx1) / 2, (ly1 + yn) / 2)), "↑", 1.2, "NOTA", "centro")
    lam.polilinea([m(q) for q in ((lx0, ly0), (lx1, ly0), (lx1, ly1), (lx0, ly1))], "CUBIERTA",
                  cerrada=True, relleno="#dcdcdc")  # fmt: skip
    for k, col in (("baterias", "#f0c9f0"), ("inversor", "#bfe3f7"), ("tablero", "#4a4a4a")):
        x0, x1, y0, y1, *_ = EQ[k]
        lam.polilinea([m(q) for q in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], "EQUIPO",
                      cerrada=True, relleno=col)  # fmt: skip
    for i, (x0, y0, x1, y1) in enumerate(modulos(filas), 1):
        lam.polilinea([m(q) for q in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], "MODULO",
                      cerrada=True, relleno="#b4e8b0")  # fmt: skip
        if rotulos:
            c = m(((x0 + x1) / 2, (y0 + y1) / 2))
            lam.texto((c[0], c[1] + 0.6), f"1.1.1.{i}", 1.2, "TEXTO", "centro", negrita=True)
            lam.texto((c[0], c[1] - 1.4), "595 Wp", 0.9, "TEXTO", "centro")
    lam.circulo(m((X_BAJADA, Y_BAJADA)), 1.2, "ROJO", relleno="#c00000")
    if rotulos:
        lam.texto(m(((lx0 + lx1) / 2, 3000)), "LOSA", 1.4, "NOTA", "centro", negrita=True)
        lam.texto(m(((lx0 + lx1) / 2, 2400)), "equipos", 1.1, "NOTA", "centro")
        for y, t in ((8370, "limahoya"), (5120, "limahoya")):
            lam.texto(m((900 if y == 5120 else 2600, y + 120)), t, 0.95, "NOTA")
        lam.texto(m((5900, -900)), "FACHADA SUR (vía)", 1.4, "NOTA", "centro")
        lam.texto(m((X_LADRILLO - 250, 600)), "muro ladrillo", 0.95, "NOTA", "der")
        lam.texto(m((X_BLANCO + 200, -350)), "muro blanco", 0.95, "NOTA")


def planta_fijacion(lam, x, y, filas) -> None:
    """Planta de fijación de la hilera tipo: rieles, anclajes y grapas (cotas en mm), ESC 1:80."""
    k = 1 / 80
    f = filas[0]
    prof = ANCHO_MOD  # en verdadera magnitud sobre el agua
    for i in range(f["n"]):
        x0 = x + i * (LARGO_MOD + SEP) * k
        lam.rect(x0, y, LARGO_MOD * k, prof * k, "MODULO", relleno="#b4e8b0")
    for dy in (RIEL_DESDE_BORDE, ANCHO_MOD - RIEL_DESDE_BORDE):
        lam.rect(x - 60 * k, y + dy * k - 0.4, (f["largo"] + 120) * k, 0.8, "ESTRUCTURA",
                 relleno="#8b5e3c")  # fmt: skip
        for xa in anclajes(f):
            lam.circulo((x + (xa - f["x0"]) * k, y + dy * k), 0.7, "ESTRUCTURA", relleno="#ffffff")
    _cota(lam, (x, y + prof * k), (x + f["largo"] * k, y + prof * k), f"{f['largo']:.0f}", off=3)
    _cota(lam, (x, y), (x + LARGO_MOD * k, y), f"{LARGO_MOD:.0f}", off=-3, h=1.2)
    xr = x + f["largo"] * k
    _cota(lam, (xr, y), (xr, y + RIEL_DESDE_BORDE * k), f"{RIEL_DESDE_BORDE:.0f}", off=-3, h=1.1)
    _cota(lam, (xr, y + RIEL_DESDE_BORDE * k), (xr, y + (ANCHO_MOD - RIEL_DESDE_BORDE) * k),
          f"{ANCHO_MOD - 2 * RIEL_DESDE_BORDE:.0f}", off=-3, h=1.1)  # fmt: skip
    a = anclajes(f)
    _cota(lam, (x + (a[0] - f["x0"]) * k, y - 1), (x + (a[1] - f["x0"]) * k, y - 1),
          f"{a[1] - a[0]:.0f}", off=-2.5, h=1.1)  # fmt: skip
    lam.texto((x, y - 7), "Módulos horizontales; 2 rieles por hilera (marrón); anclajes en L "
              "(círculos) a la estructura bajo la teja.", 1.1, "NOTA")  # fmt: skip
    lam.texto((x, y - 9.4), f"Hilera tipo de {f['n']} módulos; la otra hilera ({filas[-1]['n']}) "
              "se arma igual. ↓ pendiente hacia abajo.", 1.1, "NOTA")  # fmt: skip


# ------------------------------------------------------------------------------- 3D
def _caja(lam, P, bx, color, capa) -> None:
    """Caja vista desde el sureste: caras este, sur y superior."""
    x0, x1, y0, y1, z0, z1 = bx

    def tono(f):
        r, g_, b = (int(color[i : i + 2], 16) for i in (1, 3, 5))
        return "#{:02x}{:02x}{:02x}".format(*(min(255, int(v * f)) for v in (r, g_, b)))

    for pts, f in (
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], 0.85),
        ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], 0.95),
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], 1.08),
    ):
        lam.polilinea([P(*q) for q in pts], capa, cerrada=True, relleno=tono(f))


def _techo3d(caras, P, prof) -> None:
    """Volúmenes con las cubiertas a dos aguas, la franja norte del bloque sur y la losa."""

    def cara(pts3, rel, capa="CUBIERTA"):
        c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
        caras.append((prof(*c), [P(*q) for q in pts3], capa, rel))

    for g in _cubiertas():
        x0, x1, y0, y1 = g
        ym = (y0 + y1) / 2
        zr = Z_ALERO + (ym - y0) * TAN
        za = Z_ALERO
        cara([(x0, y0, 0), (x1, y0, 0), (x1, y0, za), (x0, y0, za)], "#f1ece3")
        cara([(x0, y1, 0), (x1, y1, 0), (x1, y1, za), (x0, y1, za)], "#f1ece3")
        blanco = "#f4f4f4" if g is G_SUR_E else "#c7714f"
        for xx, rel in ((x0, blanco), (x1, "#c7714f")):  # testeros (ladrillo; blanco al este)
            cara([(xx, y0, 0), (xx, y1, 0), (xx, y1, za), (xx, ym, zr), (xx, y0, za)], rel)
        cara([(x0, y0, za), (x1, y0, za), (x1, ym, zr), (x0, ym, zr)], "#c9653f")  # agua sur
        cara([(x0, ym, zr), (x1, ym, zr), (x1, y1, za), (x0, y1, za)], "#a8552f")  # agua norte
    lx0, lx1, ly0, ly1 = LOSA
    # Franja del agua norte del bloque sur sobre la losa
    zf = Z_ALERO + (G_SUR_O[3] - ly1) * TAN
    cara([(lx0, ly1, Z_LOSA), (lx1, ly1, Z_LOSA), (lx1, ly1, zf), (lx0, ly1, zf)], "#c7714f")
    cara([(lx0, ly1, zf), (lx1, ly1, zf), (lx1, G_SUR_O[3], Z_ALERO), (lx0, G_SUR_O[3], Z_ALERO)],
         "#a8552f")  # fmt: skip
    # Losa de los equipos y el volumen bajo ella (ventanal)
    cara([(lx0, ly0, 0), (lx1, ly0, 0), (lx1, ly0, Z_LOSA), (lx0, ly0, Z_LOSA)], "#d6e4ef")
    cara([(lx0, ly0, Z_LOSA), (lx1, ly0, Z_LOSA), (lx1, ly1, Z_LOSA), (lx0, ly1, Z_LOSA)],
         "#d9d9d9")  # fmt: skip


def _riel3d(lam, P, prof, filas, color="#2f4f7f", fantasma=()) -> None:
    """Hileras sobre riel completo: anclajes, rieles y módulos coplanares con la teja."""
    prims = []

    def add(tipo, pts3, capa, rel=None):
        c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
        prims.append((prof(*c), tipo, [P(*q) for q in pts3], capa, rel))

    for fi, f in enumerate(filas):
        g = f["g"]

        def z(y, g=g):
            return z_agua_sur(g, y)

        for dy in (RIEL_DESDE_BORDE, ANCHO_MOD - RIEL_DESDE_BORDE):
            y = f["y0"] + dy * COS
            xa, xb = f["x0"] - 60, f["x0"] + f["largo"] + 60
            add("l", [(xa, y, z(y) + 100), (xb, y, z(y) + 100)], "ESTRUCTURA")
            for x in anclajes(f):
                add("l", [(x, y, z(y)), (x, y, z(y) + 100)], "ESTRUCTURA")
                add("p", [(x - 40, y - 40, z(y)), (x + 40, y - 40, z(y)), (x + 40, y + 40, z(y)),
                          (x - 40, y + 40, z(y))], "ESTRUCTURA", "#9aa3ad")  # fmt: skip
        for im, (x0, y0, x1, y1) in enumerate(modulos([f])):
            cara = [(x0, y0, z(y0) + H_MOD), (x1, y0, z(y0) + H_MOD), (x1, y1, z(y1) + H_MOD),
                    (x0, y1, z(y1) + H_MOD)]  # fmt: skip
            if (fi, im) in fantasma:
                add("f", cara, "MODULO")
                continue
            add("p", cara, "MODULO", color)
            ym = (y0 + y1) / 2
            xm = (x0 + x1) / 2
            add("l", [(xm, y0, z(y0) + H_MOD + 1), (xm, y1, z(y1) + H_MOD + 1)], "SOMBRA")
            for xx in (x0, x1):
                add("l", [(xx, y0, z(y0) + H_MOD + 1), (xx, y1, z(y1) + H_MOD + 1)], "BRILLO")
            del ym
    for _p, tipo, pts, capa, rel in sorted(prims, key=lambda q: -q[0]):
        if tipo == "p":
            lam.polilinea(pts, capa, cerrada=True, relleno=rel)
        elif tipo == "f":
            lam.polilinea(pts, capa, cerrada=True, trazo="discontinuo")
        else:
            lam.polilinea(pts, capa)


def _escena(lam, P, prof, filas, dc, ac, puente, f=1.0) -> None:
    lam.polilinea([P(-1500, -2500, 0), P(13300, -2500, 0), P(13300, 13100, 0), P(-1500, 13100, 0)],
                  "NOTA", cerrada=True, relleno="#e2e8da")  # fmt: skip
    caras: list = []
    _techo3d(caras, P, prof)
    for _p, pts, capa, rel in sorted(caras, key=lambda c: -c[0]):
        lam.polilinea(pts, capa, cerrada=True, relleno=rel)
    _riel3d(lam, P, prof, filas)
    for key, col, capa in (("baterias", "#e9c4ea", "EQUIPO"), ("inversor", "#dbe9f6", "AC"),
                           ("tablero", "#d9d9d9", "EQUIPO")):  # fmt: skip
        _caja(lam, P, EQ[key], col, capa)
    tubo3d(lam, P, dc, 1.6 * f, "#e74c3c", "DC", abrazadera_mm=1500)
    tubo3d(lam, P, puente, 1.3 * f, "#e74c3c", "DC", abrazadera_mm=1500)
    i_in = next(i for i, q in enumerate(ac) if abs(q[2] - Z_CIELO) < 1)  # entra al cielo falso
    tubo3d(lam, P, ac[: i_in + 1], 2.0 * f, "#2e86de", "AC", abrazadera_mm=1500)
    lam.polilinea([P(*q) for q in ac[i_in:]], "AC", trazo="discontinuo")  # dentro de la casa
    xc, yc, zc = dc[0]
    _caja(lam, P, (xc - 60, xc + 60, yc - 60, yc + 60, zc - 60, zc + 60), "#f4f4f4", "EQUIPO")
    tx, ty = TABLERO_PC
    _caja(lam, P, (tx - 100, tx + 60, ty - 260, ty + 260, *Z_TAB_PC), "#ffffff", "EQUIPO")


def isometrico(lam, area, filas, dc, ac, puente) -> None:
    x0, y0, w, h = area
    esq = [(x, y, z) for x in (-1500, 13300) for y in (-2500, 13100) for z in (0, Z_ALERO + 1200)]
    P, prof, _k = _vista((x0 + 3, y0 + 3, w - 6, h - 6), esq, desde="SE")
    _escena(lam, P, prof, filas, dc, ac, puente)
    inv, tab, bat = EQ["inversor"], EQ["tablero"], EQ["baterias"]
    rot = [
        (P(*dc[0]), "Caja de paso, salida string S1.1.1", 1),
        (P(*puente[2]), 'Puente entre hileras (coraza 1")', 1),
        (P(*dc[3]), 'DC: coraza 1" por la limahoya y la franja a la losa', 1),
        (P(inv[1], (inv[2] + inv[3]) / 2, inv[4] + 300), "Inversor", -1),
        (P(bat[1], (bat[2] + bat[3]) / 2, bat[4] + 400), "Baterías", -1),
        (P(tab[1], (tab[2] + tab[3]) / 2, tab[4] + 400), "Tablero FV", -1),
        (P(X_BAJADA, Y_BAJADA, (Z_LOSA + Z_CIELO) / 2), 'AC: IMC 2" baja por el muro blanco', 1),
        (P(X_BAJADA, 1500, Z_CIELO), "Cielo falso del 1° piso (≈ 5 m)", -1),
        (P(*TABLERO_PC, (Z_TAB_PC[0] + Z_TAB_PC[1]) / 2), "Tablero existente (cocina)", -1),
    ]
    for lado, xcol in ((-1, x0 + 46), (1, x0 + w - 56)):
        items = sorted(((p, t) for p, t, s in rot if s == lado), key=lambda it: -it[0][1])
        y_prev = None
        for p, t in items:
            yq = p[1] + 3 if y_prev is None else min(p[1] + 3, y_prev - 6.5)
            y_prev = yq
            _guia(lam, p, (xcol, yq))
            _caja_texto(lam, (xcol, yq + 1.6), [t], h=1.3, alinear="der" if lado < 0 else "izq")
    lam.texto((x0 + 2, y0 + 2), "Vista desde el sureste. Teja a 15°; losa a 7,8 m; alero 9,5 m y "
              "cielo falso 2,7 m (supuestos). Punteado: dentro de la casa. Sin escala.", 1.3,
              "NOTA")  # fmt: skip


# ------------------------------------------------------------------------------- detalles
def detalle_riel_3d(lam, area, filas) -> None:
    """Hilera tipo sobre la teja con rieles y anclajes (dos módulos en corte), vista sureste."""
    x0, y0, w, h = area
    f = dict(filas[-1])
    g = (0.0, f["largo"] + 600, 0.0, 2 * (ANCHO_MOD * COS + 500))
    f.update(g=g, x0=300.0, y0=500.0, y1=500.0 + ANCHO_MOD * COS)
    zt = Z_ALERO
    ym = (g[2] + g[3]) / 2
    marco = [(x, y, z) for x in (-300, g[1] + 600) for y in (-500, ym + 300)
             for z in (zt - 200, zt + (ym - g[2]) * TAN + 300)]  # fmt: skip
    P, prof, _k = _vista((x0 + 2, y0 + 8, w - 58, h - 12), marco, desde="SE")
    # Teja: agua sur con las canales de la teja española a lo largo de la pendiente
    lam.polilinea([P(g[0], g[2], zt), P(g[1], g[2], zt), P(g[1], ym, zt + (ym - g[2]) * TAN),
                   P(g[0], ym, zt + (ym - g[2]) * TAN)], "CUBIERTA", cerrada=True,
                  relleno="#d77a50")  # fmt: skip
    xt = g[0] + 120
    while xt < g[1]:
        lam.polilinea([P(xt, g[2], zt + 30), P(xt, ym, zt + (ym - g[2]) * TAN + 30)], "NOTA")
        xt += 240
    _riel3d(lam, P, prof, [f], color="#3d6aa8", fantasma={(0, f["n"] - 1), (0, f["n"] - 2)})
    _cota(lam, P(f["x0"], 200, zt + 200 * TAN), P(f["x0"] + f["largo"], 200, zt + 200 * TAN),
          f"{f['largo']:.0f}", off=-2.5, h=1.2)  # fmt: skip
    xr = x0 + w - 54
    a = anclajes(f)
    rot = [
        (P(f["x0"] + 1000, f["y0"] + 500, z_agua_sur(g, f["y0"] + 500) + H_MOD),
         "Módulo horizontal, coplanar a 15°"),
        (P(a[-1], f["y0"] + (ANCHO_MOD - RIEL_DESDE_BORDE) * COS,
           z_agua_sur(g, f["y0"] + (ANCHO_MOD - RIEL_DESDE_BORDE) * COS) + 100),
         "Riel de aluminio (2 por hilera)"),
        (P(a[-2], f["y0"] + RIEL_DESDE_BORDE * COS,
           z_agua_sur(g, f["y0"] + RIEL_DESDE_BORDE * COS)),
         f"Anclaje en L para teja c/ ≤ {PASO_ANCLAJE / 1000:.1f} m"),
        (P(f["x0"] + LARGO_MOD + SEP / 2, f["y0"], z_agua_sur(g, f["y0"]) + H_MOD),
         "Mid clamp en juntas · end clamp en extremos"),
        (P(g[1] - 200, 300, zt + 300 * TAN), "Teja española (canales en la pendiente)"),
    ]  # fmt: skip
    rot.sort(key=lambda it: -it[0][1])
    y_prev = None
    for p_, t in rot:
        yq = p_[1] + 3 if y_prev is None else min(p_[1] + 3, y_prev - 6)
        y_prev = yq
        _guia(lam, p_, (xr, yq))
        _caja_texto(lam, (xr, yq + 1.5), [t], h=1.1)
    lam.texto((x0 + 2, y0 + 2), f"Hilera de {f['n']} módulos (cubierta media); los dos últimos en "
              "corte para ver rieles y anclajes.", 1.1, "NOTA")  # fmt: skip


def corte_teja(lam, x, y) -> None:
    """Corte por un anclaje (perpendicular a la pendiente), ESC 1:5, esquemático."""
    k = 1 / 5
    base = y + 12
    lam.rect(x, base - 60 * k, 160, 60 * k, "CUBIERTA", relleno="#e8dccb")  # estructura / torta
    lam.texto((x + 1, base - 9), "Estructura de la cubierta (correa / torta)", 1.1, "NOTA")
    # Teja española: canales cóncavas y cobijas convexas alternadas
    for i in range(6):
        xc = x + 6 + i * 26
        pts = [(xc + 13 * math.cos(math.radians(a)), base + 6 * math.sin(math.radians(a)) +
                (0 if i % 2 else 6)) for a in range(180, 361, 15)]  # fmt: skip
        if i % 2:
            pts = [(xc + 13 * math.cos(math.radians(a)), base + 12 + 6 * math.sin(math.radians(a)))
                   for a in range(0, 181, 15)]  # fmt: skip
        lam.polilinea(pts, "EQUIPO")
    xa = x + 6 + 3 * 26  # anclaje sobre una cobija
    zt = base + 18
    lam.linea((xa, base - 60 * k + 2), (xa, zt + 6), "TEXTO")  # varilla roscada
    lam.rect(xa - 0.8, zt + 6, 10, 1.6, "ESTRUCTURA", relleno="#b0b7bf")  # L
    lam.rect(xa + 7.4, zt + 6, 1.6, 9, "ESTRUCTURA", relleno="#b0b7bf")
    lam.rect(xa + 9, zt + 11, 8, 6, "ESTRUCTURA", relleno="#9aa3ad")  # riel
    lam.rect(xa - 50, zt + 17, 120, 35 * k, "MODULO", relleno="#3d6aa8")
    lam.rect(xa - 3, zt - 0.6, 6, 1.2, "NOTA", relleno="#4d4d4d")  # sellante
    _caja_texto(lam, (xa + 22, zt + 30), ["Módulo (marco 35 mm)"], h=1.1)
    _caja_texto(lam, (xa + 22, zt + 22), ["Riel de aluminio"], h=1.1)
    _guia(lam, (xa + 17, zt + 14), (xa + 22, zt + 20))
    _caja_texto(lam, (xa + 22, zt + 12), ["Anclaje en L con varilla", "roscada a la estructura"],
                h=1.1)  # fmt: skip
    _guia(lam, (xa + 8, zt + 8), (xa + 22, zt + 9))
    _caja_texto(lam, (xa - 22, zt + 6), ["Perforación sellada", "(cinta butílica)"], h=1.1,
                alinear="der")  # fmt: skip
    _guia(lam, (xa, zt), (xa - 22, zt + 3))
    lam.texto((x, y - 4), "Esquemático: tipo de anclaje, fijación y alturas según el fabricante y "
              "la estructura existente.", 1.1, "NOTA")  # fmt: skip


def detalle_equipos(lam, x, y, d) -> None:
    """Alzado del muro de ladrillo visto desde el este, sobre la losa (sur a la izquierda), 1:50."""
    b = d["bat"]
    k = 1 / 50
    ya, yb = LOSA[2], LOSA[3]
    zr = Z_ALERO + (G_SUR_O[3] - G_SUR_O[2]) / 2 * TAN

    def px(ym, zm):
        return (x + (ym - ya) * k, y + (zm - Z_LOSA) * k)

    ycum = (G_SUR_O[2] + G_SUR_O[3]) / 2
    lam.polilinea([px(ya, Z_LOSA), px(yb, Z_LOSA), px(yb, Z_ALERO + (G_SUR_O[3] - yb) * TAN),
                   px(ycum, zr), px(ya, Z_ALERO)], "CUBIERTA", cerrada=True,
                  relleno="#e3a183")  # fmt: skip
    lam.rect(x - 3, y - 1.2, (yb - ya) * k + 6, 1.2, "CUBIERTA", relleno="#bdbdbd")
    lam.texto((x + (yb - ya) * k / 2, y + (zr - Z_LOSA) * k + 2), "TESTERO DE LADRILLO · LOSA",
              1.4, "NOTA", "centro")  # fmt: skip
    lam.texto((x + 1, y - 3.2), "Losa de equipos (≈ 7,8 m); ladrillo hasta el alero (≈ 9,5 m)", 1.1,
              "NOTA")  # fmt: skip
    lam.texto((x, y + 1), "← SUR", 1.0, "NOTA")

    def r(bx, col, capa, t1, t2=""):
        _, _, ya_, yb_, za, zb = bx
        q0, q1 = px(ya_, za), px(yb_, zb)
        lam.rect(q0[0], q0[1], q1[0] - q0[0], q1[1] - q0[1], capa, relleno=col)
        lam.texto(((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2), t1, 1.1, "TEXTO", "centro",
                  negrita=True)  # fmt: skip
        if t2:
            lam.texto(((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2 - 2), t2, 0.9, "TEXTO", "centro")

    r(EQ["baterias"], "#f6e0f6", "EQUIPO", "BAT.", f"{b['n']} mód.")
    r(EQ["inversor"], "#e9eef3", "AC", "INV.")
    r(EQ["tablero"], "#e6e6e6", "EQUIPO", "T.FV")
    inv, tab, bat = EQ["inversor"], EQ["tablero"], EQ["baterias"]
    yi, yt = (inv[2] + inv[3]) / 2, (tab[2] + tab[3]) / 2
    tubo(lam, [px(yb, Z_LOSA + 150), px(yi, Z_LOSA + 150), px(yi, inv[4])], 1.1, "DC", "#f6c9c4",
         abrazaderas=7)  # fmt: skip
    tubo(lam, [px(yt, tab[4]), px(yt, Z_LOSA + 400), px(ya, Z_LOSA + 400)], 1.5, "AC", "#cfe0f5",
         abrazaderas=7)  # fmt: skip
    tubo(lam, [px(inv[2], Z_LOSA + 1300), px(tab[3], Z_LOSA + 1300)], 1.2, "AC", "#cfe0f5")
    yb_ = bat[3] - 150
    tubo(lam, [px(yb_, bat[5]), px(yb_, Z_LOSA + 1250), px(inv[2], Z_LOSA + 1250)], 1.0, "DC",
         "#f6c9c4")  # fmt: skip
    caja_paso(lam, px(yt - 400, Z_LOSA + 400), 2.0)
    W = (yb - ya) * k
    _caja_texto(lam, (x + W + 3, y + 6), ['DC: coraza 1" desde la cubierta', "junto al piso"],
                h=1.1)  # fmt: skip
    _guia(lam, px(yb - 200, Z_LOSA + 150), (x + W + 3, y + 3))
    _caja_texto(lam, (x - 2, y + 9), ['AC: IMC 2" hacia el muro blanco', "Caja de paso 10x10 IP66",
                "2 x [3N° 6 + 1N° 6 (N) + 1N° 8 (T)] Cu"], h=1.1, alinear="der")  # fmt: skip
    _guia(lam, px(ya + 200, Z_LOSA + 400), (x - 2, y + 6))
    _caja_texto(lam, (x + W + 3, y + 22), ["Batería DEYE GB-L en el piso", 'Coraza 1" a inversor',
                f"Inversor {d['inversor_modelo']}"], h=1.1)  # fmt: skip


def detalle_punto_conexion(lam, x, y) -> None:
    """Esquema: baja por el muro blanco, cielo falso (≈ 5 m) y tablero de la cocina. ESC 1:100."""
    k = 1 / 100
    lam.rect(x, y, 3, (Z_LOSA + 600) * k, "CUBIERTA", relleno="#f4f4f4")  # muro blanco
    lam.rect(x - 26, y + Z_LOSA * k - 1.2, 26, 1.2, "CUBIERTA", relleno="#bdbdbd")  # losa
    lam.texto((x - 25, y + Z_LOSA * k + 1), "Losa de equipos", 1.1, "NOTA")
    lam.rect(x - 60, y + Z_CIELO * k, 63, 0.6, "NOTA", relleno="#cfcfcf")  # cielo falso
    lam.texto((x - 59, y + Z_CIELO * k + 1), "Cielo falso 1° piso", 1.1, "NOTA")
    xt = x - 1.5
    zl, zc = y + (Z_LOSA + 150) * k, y + Z_CIELO * k - 1
    pts = [(x - 20, zl), (xt, zl), (xt, zc), (x - 52, zc), (x - 52, y + Z_TAB_PC[1] * k)]
    tubo(lam, pts, 1.6, "AC", "#cfe0f5", abrazaderas=8)
    caja_paso(lam, (xt, y + Z_CIELO * k - 1), 2.2)
    lam.rect(x - 55, y + Z_TAB_PC[0] * k, 6, (Z_TAB_PC[1] - Z_TAB_PC[0]) * k, "EQUIPO",
             relleno="#ffffff")  # fmt: skip
    lam.texto((x - 52, y + Z_TAB_PC[0] * k - 2.6), "TABLERO (COCINA)", 1.1, "TEXTO", "centro",
              negrita=True)  # fmt: skip
    zt = y + Z_CIELO * k + 3.5
    _cota(lam, (x - 52, zt), (xt, zt), "≈ 5 m por cielo falso", off=1, h=1.1)
    _caja_texto(lam, (x + 5, y + (Z_LOSA - 1500) * k), ['Baja por el muro blanco', 'IMC 2", '
                "abrazaderas c/ 1,5 m"], h=1.1)  # fmt: skip
    _caja_texto(lam, (x + 5, y + (Z_CIELO + 400) * k), ["Pasamuro sellado al", "cielo falso"],
                h=1.1)  # fmt: skip
    _caja_texto(lam, (x - 58, y + (Z_TAB_PC[0] - 500) * k), ["Ubicación del tablero y recorrido",
                "por el cielo falso: verificar en obra"], capa="ROJO", h=1.1)  # fmt: skip


# ------------------------------------------------------------------------------- láminas
def laminas(d: dict[str, Any], fecha: str, disenador: str = "") -> list[Lamina]:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "cajetin.json")
    filas = hileras(d["modulos"])
    dc, ac, puente, desc_dc, desc_ac, L = rutas(filas)
    conj = json.loads((INSUMOS / "porton.json").read_text(encoding="utf-8"))
    titulo = f"CASA {d['casa']} - PORTÓN DE LA RIVERA"
    az = (180 - GIRO_DEG) % 360
    orient = f"{az:.0f}°, coplanar {INCL:.0f}° (teja)"
    notas = [
        f"Sistema de {d['modulos']} módulos JA Solar de 595 Wp ({_f(d['kwp'])} kWp) y un inversor "
        f"{d['inversor_modelo']}.",
        f"Módulos horizontales en las aguas sur, en dos hileras rectas ({filas[0]['n']} + "
        f"{filas[-1]['n']}), mirando a {az:.0f}° a {INCL:.0f}°, sobre riel completo.",
        *SUPUESTOS,
    ]
    out: list[Lamina] = []
    total = 4
    todo = box(-1500, -1500, 12300, 12300)

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
    lam.imagen(INSUMOS / "porton28_maps_losa.png", 14, 196, iw, iw * 470 / 514)
    lam.rect(14, 196, iw, iw * 470 / 514, "CAJETIN")
    fw = 24
    lam.imagen(INSUMOS / "porton28_equipos.jpg", 80, 196, fw, fw * 1600 / 734 * 0.62)
    _titulo_vista(lam, 14, 190, 1, "Medición en Maps y losa de equipos")
    lam.texto((22, 185.5), f"Conjunto: {conj['lat']:.5f}, {conj['lon']:.5f} · Cali · 99,83 m²",
              1.4, "NOTA")  # fmt: skip
    _resumen(lam, 14, 180, d, modulos(filas), ancho=96, orientacion=orient,
             estructura="Riel completo sobre teja")  # fmt: skip
    m = Marco(todo, (112, 100, 140, 152), n_opciones=(75, 100, 125))
    _planta(lam, m, filas)
    _norte(lam, 246, 248)
    lam.texto((246, 240), f"Vivienda girada {GIRO_DEG:.0f}°", 1.1, "NOTA", "centro")
    _escala(lam, 116, 100, m.n)
    _titulo_vista(lam, 116, 94, 2, "Distribución de módulos (marco de la vivienda)", f"ESC 1:{m.n}")
    planta_fijacion(lam, 18, 116, filas)
    _titulo_vista(lam, 14, 144, 3, "Planta de fijación con riel completo", "ESC 1:80 (cotas en mm)")
    tabla_materiales_compacta(lam, 256, 250, materiales_obra(d, L))
    cerrar(lam, ["Materiales: cableado y canalización sobre la ruta 3D + 10 % de reserva."])

    # --- Hoja 2 ----------------------------------------------------------------------------
    lam = nueva(2, "RUT", "Rutas de cableado DC y AC")
    lam.texto((14, 258), f"RUTAS DE CABLEADO DC Y AC · {titulo}", 3.0, "TEXTO", negrita=True)
    m = Marco(todo, (14, 66, 256, 182), n_opciones=(50, 75, 100))
    _planta(lam, m, filas)

    def en_planta(r):
        pts = [q[:2] for q in r]
        return [q for i, q in enumerate(pts) if i == 0 or math.dist(q, pts[i - 1]) > 1]

    ruta_planta(lam, m, en_planta(dc), "DC", "#f6c9c4", "DC-", pos=0.3)
    ruta_planta(lam, m, en_planta(puente), "DC", "#f6c9c4", "P-")
    i_in = next(i for i, q in enumerate(ac) if abs(q[2] - Z_CIELO) < 1)
    ac_p = en_planta(ac[: i_in + 1])
    ruta_planta(lam, m, [(q[0] + 250, q[1]) if abs(q[0] - X_EQ) < 1 else q for q in ac_p], "AC",
                "#cfe0f5", "AC-", pos=0.7)  # fmt: skip
    interior = [m(q[:2]) for q in ac[i_in:]]  # dentro de la casa, por el cielo falso del 1° piso
    lam.polilinea(interior, "AC", trazo="discontinuo")
    lam.texto((interior[1][0] - 1, interior[1][1] + 1.2), "cielo falso 1° piso ≈ 5 m", 1.1, "AC",
              "der")  # fmt: skip
    caja_paso(lam, m(dc[0][:2]), 2.4)
    for p, t, capa in (((X_BAJADA, Y_BAJADA), "↓", "ROJO"), (TABLERO_PC, "T", "ROJO")):
        lam.circulo(m(p), 1.6, capa)
        lam.texto(m(p), t, 1.4, capa, "centro", negrita=True)
    _norte(lam, 258, 248)
    _escala(lam, 16, 66, m.n)
    _titulo_vista(lam, 16, 60, 1, "Rutas de cableado DC y AC", f"ESC 1:{m.n}")
    _caja_texto(lam, (278, 104), [
        "RUTA DC (rojo)", 'Coraza 1" adosada a la teja y a la losa, soportes c/ 1,5 m',
        "Cable FV 2x4 mm² (+/-) + 1N° 8 AWG Cu verde",
        "Puente entre hileras por la cumbrera de la cubierta media",
        f"Longitud total DC (con el puente): {L['dc_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _caja_texto(lam, (278, 80), [
        "RUTA AC (azul)", 'IMC 2" por la losa y el muro blanco; cielo falso ≈ 5 m',
        "2 x [3N° 6 AWG (F) + 1N° 6 (N) + 1N° 8 (T)] Cu",
        "Hasta el tablero de distribución junto a la cocina",
        f"Longitud total AC: {L['ac_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _detalle_dc(lam, 278, 112, d, "Por la limahoya y la franja hasta la losa")
    cerrar(lam, ["Cable tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc para conductores DC.",
                 "Planta en el marco de la vivienda (girada 8° respecto al norte)."])  # fmt: skip

    # --- Hoja 3 ----------------------------------------------------------------------------
    lam = nueva(3, "EQP", "Esquema 3D, ubicación de equipos y punto de conexión")
    lam.texto((14, 258), f"UBICACIÓN DE EQUIPOS Y PUNTO DE CONEXIÓN · {titulo}", 3.0, "TEXTO",
              negrita=True)  # fmt: skip
    isometrico(lam, (14, 58, 200, 186), filas, dc, ac, puente)
    _titulo_vista(lam, 16, 248, 1, "Esquema 3D de rutas DC (rojo) y AC (azul)", "SIN ESCALA")
    detalle_equipos(lam, 262, 176, d)
    _titulo_vista(lam, 222, 248, 2, "Equipos en la losa (testero de ladrillo)", "ESC 1:50")
    lam.imagen(INSUMOS / "porton28_tablero.jpg", 222, 62, 30, 30 * 1600 / 734 * 0.62)
    lam.texto((222, 60), "Tablero existente (foto)", 1.1, "NOTA")
    detalle_punto_conexion(lam, 330, 70)
    _titulo_vista(lam, 222, 152, 3, "Detalle hasta el punto de conexión", "ESC 1:100")
    cerrar(lam, ["Alimentador AC en 6 AWG Cu hasta el punto final del tablero de conexión."])

    # --- Hoja 4 ----------------------------------------------------------------------------
    lam = nueva(4, "DET", "Detalles de estructura sobre teja y rutas DC / AC")
    lam.texto((14, 258), f"DETALLES CONSTRUCTIVOS · {titulo}", 3.0, "TEXTO", negrita=True)
    _titulo_vista(lam, 16, 248, 1, "Riel completo sobre teja española",
                  "SIN ESCALA (cotas en mm)")  # fmt: skip
    detalle_riel_3d(lam, (14, 150, 214, 92), filas)
    _titulo_vista(lam, 234, 248, 2, "Corte por un anclaje", "ESC 1:5 (esquemático)")
    corte_teja(lam, 240, 170)

    def escena(lam_, P, prof, f):
        _escena(lam_, P, prof, filas, dc, ac, puente, f)

    def vista(area, pts):
        return _vista(area, pts, desde="SE")

    _titulo_vista(lam, 16, 146, 3, "Ruta DC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta(lam, (14, 58, 196, 84), dc, desc_dc, "dc", vista, escena, NOTAS_RUTA["dc"][:5],
                 extra=[("P", "Puente entre hileras (por la cumbrera)",
                         sum(_largos(puente)))])  # fmt: skip
    _titulo_vista(lam, 214, 146, 4, "Ruta AC ampliada (tramos y curvas)", "SIN ESCALA")
    detalle_ruta(lam, (212, 58, 196, 84), ac, desc_ac, "ac", vista, escena, [
        'C1 a C{nc}: {nc} curvas IMC 2" de 90° (fabricadas).',
        'Uniones IMC 2" cada 3 m; abrazaderas cada 1,5 m',
        "y a 30 cm de cada curva y de cada caja.",
        "Pasamuro sellado al entrar al cielo falso.",
        "Recorrido en el cielo falso: verificar en obra.",
    ])  # fmt: skip
    cerrar(lam, [
        "Longitudes de tramo medidas sobre el eje de la tubería en el modelo 3D (sin reserva).",
        "No pisar la teja fuera de las cobijas; reponer las tejas rotas.",
    ])  # fmt: skip
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m engine.planos.casas_porton")
    p.add_argument("excel", type=Path)
    p.add_argument("--casa", default="28")
    p.add_argument("--fecha", default=dt.date.today().isoformat())
    args = p.parse_args(argv)
    bib = validar.cargar_biblioteca()
    casas = pvsyst.leer_casas(args.excel)
    modulo = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, _ = pvsyst.plan(casas, modulo)
    sel = [(c, f) for c, f in zip(casas, filas, strict=True)
           if _slug(c["proyecto"]) == _slug("Porton de la rivera")
           and _slug(str(c["casa"])) == _slug(args.casa)]  # fmt: skip
    if not sel:
        print("Casa no encontrada en Portón de la Rivera.")
        return 1
    d = datos_casa(*sel[0], bib)
    lams = laminas(d, args.fecha, _disenador())
    ruta = a_pdf(lams, SALIDA / f"PRO-ELE-PORTON-C{_slug(args.casa)}-PLANOS.pdf")
    print(ruta)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
