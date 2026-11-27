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
# Marco de la vivienda: x ≈ este, y ≈ norte; origen al suroeste. Cubiertas a dos aguas con
# cumbrera norte-sur (aguas al oeste y al este, usuario); en el bloque sur las dos aguas las separa
# la losa de equipos: el agua oeste (testero de ladrillo) y el agua este (muro blanco).
GIRO_DEG = 8.1  # la vivienda está girada 8,1° (antihorario) respecto al norte (Maps)
INCL = 15.0  # inclinación de la teja (usuario)
TAN = math.tan(math.radians(INCL))
COS = math.cos(math.radians(INCL))
Z_LOSA = 7800.0  # losa de equipos (usuario: "casi 8 m")
Z_CIELO = 2700.0  # cielo falso del 1° piso (supuesto)
# Franjas de la medición (x0, x1, y0, y1) separadas por muros blancos con canal
G_NORTE = (1950.0, 11800.0, 8800.0, 11645.0)
G_MEDIO = (300.0, 11800.0, 5120.0, 8800.0)  # ≥ 3,44 m de ancho (usuario: caben 3 verticales)
G_SUR_O = (0.0, 6900.0, 0.0, 5120.0)  # agua oeste del bloque sur (testero de ladrillo al sur)
G_SUR_E = (9480.0, 11800.0, 0.0, 5120.0)  # agua este del bloque sur (muro blanco)
LOSA = (6900.0, 9480.0, 0.0, 4206.0)  # losa de los equipos (flecha del usuario)
FRANJA = (6900.0, 9480.0, 4206.0, 5120.0)  # cubierta del bloque sur al norte de la losa
MUROS_Y = (5120.0, 8800.0)  # muros blancos entre franjas (como en la foto de referencia)
X_LADRILLO, X_BLANCO = LOSA[0], LOSA[1]
X_CUM = X_LADRILLO  # borde alto de las aguas (línea del muro de ladrillo)
Z_BORDE = Z_LOSA + 2400  # borde alto del agua oeste sobre la losa (foto: ≈ 2,4 m; supuesto)
Z_CUM = Z_BORDE
ANCHO_LOSA = 1000.0  # franja de losa gris en la parte baja de cada agua (foto del usuario)
# Módulos verticales en el agua oeste del bloque sur, junto a la losa (usuario)
Y_MARGEN = 250.0  # a los bordes sur y norte del agua
RETIRO_BORDE = 300.0  # del borde alto (muro de ladrillo) a la primera hilera
SEP = 20.0
H_MOD = 160.0  # cara superior del módulo sobre la teja: anclaje + riel + marco (supuesto)
RIEL_DESDE_BORDE = LARGO_MOD / 4  # rieles a 1/4 del largo del módulo (esquemático, ver manual)
PASO_ANCLAJE = 1200.0  # separación máxima entre anclajes por riel (supuesto, según fabricante)
# Equipos en el muro de ladrillo (cara x = X_LADRILLO, mirando al este), sobre la losa
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
    "Cubierta según Maps (99,83 m²) rectificada; teja a 15° con cumbrera norte-sur (usuario); "
    "losa a 7,8 m (usuario); borde del agua oeste 2,4 m sobre la losa (foto); losa gris de "
    "≈ 1 m en la parte baja de cada agua (foto) y agua del medio ≥ 3,5 m de ancho: verificar "
    "en obra; cielo falso 2,7 m.",
    "Anclajes en L para teja, riel y tornillería según el fabricante; retirar y reponer la teja "
    "en cada anclaje y sellar la perforación.",
]


def _borde_alto(x: float, y: float) -> float:
    """x del borde alto del agua que contiene el punto (agua este del bloque sur: muro blanco)."""
    return X_BLANCO if (y < MUROS_Y[0] and x >= X_BLANCO) else X_LADRILLO


def _borde_bajo(x: float, y: float) -> float:
    """x del borde bajo del agua que contiene el punto."""
    xa = _borde_alto(x, y)
    if x > xa:
        return 11800.0
    g = next((g for g in (G_SUR_O, G_MEDIO, G_NORTE) if g[2] <= y <= g[3]), G_SUR_O)
    return g[0]


def largo_teja(x: float, y: float) -> float:
    """Largo en planta de la teja del agua: del borde alto hasta la losa gris de la parte baja."""
    return abs(_borde_alto(x, y) - _borde_bajo(x, y)) - ANCHO_LOSA


def z_techo(x: float, y: float = 0.0) -> float:
    """Cota de la cubierta: teja a 15° desde el borde alto y losa gris plana en la parte baja."""
    d = min(abs(x - _borde_alto(x, y)), largo_teja(x, y))
    return Z_BORDE - d * TAN


def hileras(n: int) -> list[dict[str, Any]]:
    """Una hilera de módulos verticales por agua, solo sobre la franja de teja, junto al borde
    alto (muro de ladrillo): agua oeste del bloque sur (hasta 4) y agua oeste del bloque medio."""
    prof = LARGO_MOD * COS
    xb = X_LADRILLO - RETIRO_BORDE
    xa = xb - prof
    if xa < G_MEDIO[0] + ANCHO_LOSA:
        raise ValueError("el módulo no cabe en la franja de teja")
    out, resto = [], n
    for y0g, y1g in ((G_SUR_O[2], G_SUR_O[3]), (G_MEDIO[2], G_MEDIO[3])):
        cabe = math.floor((y1g - y0g - 2 * 100 + SEP) / (ANCHO_MOD + SEP))
        k = min(cabe, 4, resto)
        if k <= 0:
            continue
        largo = k * ANCHO_MOD + (k - 1) * SEP
        out.append({"n": k, "y0": y0g + (y1g - y0g - largo) / 2, "largo": largo, "xa": xa,
                    "xb": xb})  # fmt: skip
        resto -= k
    if resto:
        raise ValueError(f"no caben {n} módulos en las franjas de teja")
    return out


def modulos(filas) -> list[tuple[float, float, float, float]]:
    paso = ANCHO_MOD + SEP
    return [(f["xa"], f["y0"] + i * paso, f["xb"], f["y0"] + i * paso + ANCHO_MOD)
            for f in filas for i in range(f["n"])]  # fmt: skip


def rieles_x(f) -> list[float]:
    """Posición x (en planta) de los dos rieles de una hilera, a 1/4 del largo del módulo."""
    return [f["xb"] - RIEL_DESDE_BORDE * COS, f["xa"] + RIEL_DESDE_BORDE * COS]


def anclajes(f) -> list[float]:
    """Posiciones y de los anclajes de un riel (a 200 mm de los extremos, ≤ PASO_ANCLAJE)."""
    a, b = f["y0"] + 200, f["y0"] + f["largo"] - 200
    k = max(1, math.ceil((b - a) / PASO_ANCLAJE))
    return [a + (b - a) * i / k for i in range(k + 1)]


def rutas(filas):
    """Rutas 3D (mm, marco de la vivienda) y longitudes (m)."""
    f = filas[0]  # hilera junto al muro de ladrillo: de ahí sale el string
    ym = f["y0"] + f["largo"] / 2
    xc = f["xb"] + 150
    x_m = X_LADRILLO - 100
    inv = EQ["inversor"]
    yi = (inv[2] + inv[3]) / 2
    dc = _fusionar([
        (xc, ym, z_techo(xc) + 80), (x_m, ym, z_techo(x_m) + 80),  # por la teja al muro
        (x_m, ym, Z_BORDE + 150), (X_EQ, ym, Z_BORDE + 150),  # sobre el borde del muro
        (X_EQ, ym, Z_LOSA + 150),  # baja por el muro de ladrillo a la losa
        (X_EQ, yi, Z_LOSA + 150), (X_EQ, yi, inv[4]),  # junto al piso, entra por debajo
    ])  # fmt: skip
    puente = []
    if len(filas) > 1:  # de la hilera del medio a la del sur, cruzando el muro blanco
        f2 = filas[1]
        zt = z_techo(xc) + 80
        zw = Z_BORDE + 400 + 150  # sobre la corona del muro blanco
        ym_ = MUROS_Y[0]
        puente = _fusionar([
            (xc, f2["y0"] + 300, zt), (xc, ym_ + 200, zt), (xc, ym_ + 200, zw),
            (xc, ym_ - 200, zw), (xc, ym_ - 200, zt), (xc, f["y0"] + f["largo"] - 300, zt),
        ])  # fmt: skip
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
        "Caja de paso del arreglo, por la teja hacia el muro",
        "Sube sobre el borde del muro de ladrillo",
        "Cruza el borde del muro hacia la losa",
        "Baja por el muro de ladrillo a la losa",
        "Junto al piso de la losa hasta el inversor",
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
    n_anc = sum(2 * len(anclajes(f_)) for f_ in filas)
    riel = sum(2 * (f_["largo"] + 120) / 1000 for f_ in filas)
    mid = sum(2 * (f_["n"] - 1) for f_ in filas)
    L = {
        "dc_total": sum(_largos(dc)) + (sum(_largos(puente)) if puente else 0.0),
        "ac_total": sum(_largos(ac)),
        "dc_vertical": (Z_BORDE - Z_LOSA) / 1000,
        "curvas_ac": len(ac) - 2,
        "ubic_bat": "En la losa, junto al muro de ladrillo",
        "obs_ac": "Losa, muro blanco y cielo falso",
        "estructura": {"fila_m": sum(f_["largo"] for f_ in filas) / 1000},
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
def _partes() -> list[tuple[float, float, float, float, str]]:
    """Partes de cubierta de una sola pendiente: franja de teja junto al borde alto y losa gris."""
    out = []
    for g in (G_NORTE, G_MEDIO, FRANJA, G_SUR_O, G_SUR_E):
        x0, x1, y0, y1 = g
        ym = (y0 + y1) / 2
        cortes = {x0, x1}
        for xc in (X_LADRILLO, X_BLANCO, 11800 - ANCHO_LOSA, x0 + ANCHO_LOSA):
            if x0 < xc < x1:
                cortes.add(xc)
        xs = sorted(cortes)
        for a, b in zip(xs[:-1], xs[1:], strict=True):
            xm = (a + b) / 2
            dist_alto = abs(xm - _borde_alto(xm, ym))
            tipo = "losa" if dist_alto > largo_teja(xm, ym) else "teja"
            out.append((a, b, y0, y1, tipo))
    return out


def _planta(lam, m: Marco, filas, rotulos=True) -> None:
    for x0, x1, y0, y1, tipo in _partes():
        lam.polilinea([m(q) for q in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], "CUBIERTA",
                      cerrada=True, relleno="#ead7c8" if tipo == "teja" else "#d0d0d0")  # fmt: skip
        if tipo == "losa":
            if x1 - x0 > 900 and rotulos:
                lam.texto(m(((x0 + x1) / 2, (y0 + y1) / 2)), "losa", 0.95, "NOTA", "centro")
            continue
        if x1 - x0 > 1500:  # flechas de caída del agua
            t = "←" if x1 <= _borde_alto((x0 + x1) / 2, (y0 + y1) / 2) else "→"
            for yy in (y0 + (y1 - y0) * 0.25, y0 + (y1 - y0) * 0.75):
                lam.texto(m(((x0 + x1) / 2 if x1 - x0 < 4000 else x0 + 900, yy)), t, 1.4,
                          "NOTA", "centro")  # fmt: skip
    for g in (G_NORTE, G_MEDIO, FRANJA):  # cumbrera norte-sur
        lam.polilinea([m((X_CUM, g[2])), m((X_CUM, g[3]))], "NOTA", trazo="discontinuo")
    for y in MUROS_Y:  # muros blancos entre franjas
        x0 = min(g[0] for g in (G_NORTE, G_MEDIO) if g[2] <= y <= g[3])
        lam.polilinea([m(q) for q in ((x0, y - 100), (11800, y - 100), (11800, y + 100),
                                      (x0, y + 100))], "CUBIERTA", cerrada=True,
                      relleno="#ffffff")  # fmt: skip
    lx0, lx1, ly0, ly1 = LOSA
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
            lam.texto((c[0], c[1] + 0.6), f"1.1.1.{i}", 1.1, "TEXTO", "centro", negrita=True)
            lam.texto((c[0], c[1] - 1.4), "595 Wp", 0.9, "TEXTO", "centro")
    lam.circulo(m((X_BAJADA, Y_BAJADA)), 1.2, "ROJO", relleno="#c00000")
    if rotulos:
        lam.texto(m(((lx0 + lx1) / 2, 3000)), "LOSA", 1.4, "NOTA", "centro", negrita=True)
        lam.texto(m(((lx0 + lx1) / 2, 2400)), "equipos", 1.1, "NOTA", "centro")
        for y in MUROS_Y:
            lam.texto(m((11900, y)), "muro blanco", 0.95, "NOTA")
        lam.texto(m((5900, -900)), "FACHADA SUR (vía)", 1.4, "NOTA", "centro")
        lam.texto(m((X_LADRILLO - 250, -350)), "muro ladrillo", 0.95, "NOTA", "der")
        lam.texto(m((X_BLANCO + 200, -350)), "muro blanco", 0.95, "NOTA")


def planta_fijacion(lam, x, y, filas) -> None:
    """Planta de fijación en verdadera magnitud (pendiente hacia abajo), ESC 1:100."""
    k = 1 / 100
    yy = y + sum(LARGO_MOD + SEP for _ in filas) * k  # borde alto (junto al muro) arriba
    for fi, f in enumerate(filas):
        ytop = yy - fi * (LARGO_MOD + SEP) * k
        for i in range(f["n"]):
            x0 = x + i * (ANCHO_MOD + SEP) * k
            lam.rect(x0, ytop - LARGO_MOD * k, ANCHO_MOD * k, LARGO_MOD * k, "MODULO",
                     relleno="#b4e8b0")  # fmt: skip
        for dr in (RIEL_DESDE_BORDE, LARGO_MOD - RIEL_DESDE_BORDE):
            yr = ytop - dr * k
            lam.rect(x - 0.6, yr - 0.3, (f["largo"] + 120) * k, 0.6, "ESTRUCTURA",
                     relleno="#8b5e3c")  # fmt: skip
            for ya in anclajes(f):
                lam.circulo((x + (ya - f["y0"]) * k, yr), 0.45, "ESTRUCTURA", relleno="#ffffff")
    f = filas[0]
    _cota(lam, (x, yy), (x + f["largo"] * k, yy), f"{f['largo']:.0f}", off=3, h=1.1)
    xr = x + f["largo"] * k
    _cota(lam, (xr, yy - LARGO_MOD * k), (xr, yy), f"{LARGO_MOD:.0f}", off=-3, h=1.1)
    lam.texto((xr + 6, yy + 1), "muro de ladrillo (borde alto)", 1.0, "NOTA")
    lam.texto((xr + 6, yy - 5), "↓ pendiente 15° (agua oeste)", 1.0, "NOTA")
    lam.texto((x, y - 4), "Módulos verticales; 2 rieles por hilera (marrón) a 1/4 del largo; "
              "anclajes en L (círculos).", 1.05, "NOTA")  # fmt: skip


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
    """Volúmenes con las cubiertas a dos aguas (cumbrera norte-sur), muros blancos y losa."""

    def cara(pts3, rel, capa="CUBIERTA"):
        c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
        caras.append((prof(*c), [P(*q) for q in pts3], capa, rel))

    for x0, x1, y0, y1, tipo in _partes():
        ym = (y0 + y1) / 2
        z0, z1 = z_techo(x0, ym), z_techo(x1, ym)
        base = Z_LOSA if y0 == FRANJA[2] else 0.0
        sur = "#c7714f" if x1 <= X_LADRILLO else "#f1ece3"  # testero de ladrillo al oeste
        cara([(x0, y0, base), (x1, y0, base), (x1, y0, z1), (x0, y0, z0)], sur)
        cara([(x0, y1, 0), (x1, y1, 0), (x1, y1, z1), (x0, y1, z0)], "#f1ece3")
        este = "#c7714f" if x1 == X_LADRILLO else "#f1ece3"
        cara([(x1, y0, 0), (x1, y1, 0), (x1, y1, z1), (x1, y0, z1)], este)
        cara([(x0, y0, 0), (x0, y1, 0), (x0, y1, z0), (x0, y0, z0)], "#f1ece3")
        color = "#cfcfcf" if tipo == "losa" else (
            "#c9653f" if x1 <= _borde_alto((x0 + x1) / 2, ym) else "#a8552f")  # fmt: skip
        cara([(x0, y0, z0), (x1, y0, z1), (x1, y1, z1), (x0, y1, z0)], color)
    for y in MUROS_Y:  # muros blancos entre franjas, 400 mm sobre la teja
        x0 = min(g[0] for g in (G_NORTE, G_MEDIO) if g[2] <= y <= g[3])
        xs = [x0, x0 + ANCHO_LOSA, X_LADRILLO, 11800 - ANCHO_LOSA, 11800]
        pts = [(xx, z_techo(xx, y)) for xx in xs]
        cara([(x0, y - 100, 0), (11800, y - 100, 0)] +
             [(xx, y - 100, zz + 400) for xx, zz in reversed(pts)], "#ffffff")  # fmt: skip
        for (xa, za), (xb, zb) in zip(pts[:-1], pts[1:], strict=True):
            cara([(xa, y - 100, za + 400), (xb, y - 100, zb + 400), (xb, y + 100, zb + 400),
                  (xa, y + 100, za + 400)], "#f4f4f4")  # fmt: skip
    lx0, lx1, ly0, ly1 = LOSA
    cara([(lx0, ly0, 0), (lx1, ly0, 0), (lx1, ly0, Z_LOSA), (lx0, ly0, Z_LOSA)], "#d6e4ef")
    cara([(lx0, ly0, Z_LOSA), (lx1, ly0, Z_LOSA), (lx1, ly1, Z_LOSA), (lx0, ly1, Z_LOSA)],
         "#d9d9d9")  # fmt: skip


def _riel3d(lam, P, prof, filas, zf=z_techo, color="#2f4f7f", fantasma=()) -> None:
    """Hileras sobre riel completo en el agua oeste: anclajes, rieles y módulos coplanares."""
    prims = []

    def add(tipo, pts3, capa, rel=None):
        c = [sum(q[i] for q in pts3) / len(pts3) for i in range(3)]
        prims.append((prof(*c), tipo, [P(*q) for q in pts3], capa, rel))

    for fi, f in enumerate(filas):
        for xr in rieles_x(f):
            z = zf(xr)
            add("l", [(xr, f["y0"] - 60, z + 100), (xr, f["y0"] + f["largo"] + 60, z + 100)],
                "ESTRUCTURA")  # fmt: skip
            for ya in anclajes(f):
                add("l", [(xr, ya, z), (xr, ya, z + 100)], "ESTRUCTURA")
                add("p", [(xr - 40, ya - 40, z), (xr + 40, ya - 40, z), (xr + 40, ya + 40, z),
                          (xr - 40, ya + 40, z)], "ESTRUCTURA", "#9aa3ad")  # fmt: skip
        for im, (x0, y0, x1, y1) in enumerate(modulos([f])):
            za, zb = zf(x0) + H_MOD, zf(x1) + H_MOD
            cara = [(x0, y0, za), (x0, y1, za), (x1, y1, zb), (x1, y0, zb)]
            if (fi, im) in fantasma:
                add("f", cara, "MODULO")
                continue
            add("p", cara, "MODULO", color)
            xm = (x0 + x1) / 2
            zm = (za + zb) / 2 + 1
            add("l", [(xm, y0, zm), (xm, y1, zm)], "SOMBRA")
            for yy in (y0, y1):
                add("l", [(x0, yy, za + 1), (x1, yy, zb + 1)], "BRILLO")
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
    if puente:
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
    esq = [(x, y, z) for x in (-1500, 13300) for y in (-2500, 13100) for z in (0, Z_CUM + 600)]
    P, prof, _k = _vista((x0 + 3, y0 + 3, w - 6, h - 6), esq, desde="SE")
    _escena(lam, P, prof, filas, dc, ac, puente)
    inv, tab, bat = EQ["inversor"], EQ["tablero"], EQ["baterias"]
    mods = modulos(filas)
    xm, ym = (mods[0][0] + mods[0][2]) / 2, (mods[0][1] + mods[0][3]) / 2
    rot = [
        (P(xm, ym, z_techo(xm) + H_MOD), "Módulos sobre la franja de teja (agua oeste)", -1),
        (P(*dc[0]), "Caja de paso, salida string S1.1.1", 1),
        (P(*dc[3]), 'DC: coraza 1" sobre el muro de ladrillo a la losa', 1),
        (P(inv[1], (inv[2] + inv[3]) / 2, inv[4] + 300), "Inversor", 1),
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
    lam.texto((x0 + 2, y0 + 2), "Vista desde el sureste. Teja a 15°, cumbrera norte-sur; losa a "
              "7,8 m; cielo falso 2,7 m (supuesto). Punteado: dentro de la casa. Sin escala.", 1.3,
              "NOTA")  # fmt: skip


# ------------------------------------------------------------------------------- detalles
def detalle_riel_3d(lam, area, filas) -> None:
    """Hilera tipo sobre la teja con rieles y anclajes (dos módulos en corte), vista suroeste."""
    x0, y0, w, h = area
    filas = filas[:1]
    xg0 = filas[-1]["xa"] - 500
    xg1 = filas[0]["xb"] + 300
    yg0, yg1 = G_SUR_O[2], G_SUR_O[3]
    marco = [(x, y, z) for x in (xg0 - 300, xg1 + 300) for y in (yg0 - 300, yg1 + 300)
             for z in (z_techo(xg0) - 200, z_techo(xg1) + 400)]  # fmt: skip
    P, prof, _k = _vista((x0 + 2, y0 + 8, w - 58, h - 12), marco, desde="SO")
    lam.polilinea([P(xg0, yg0, z_techo(xg0)), P(xg1, yg0, z_techo(xg1)), P(xg1, yg1, z_techo(xg1)),
                   P(xg0, yg1, z_techo(xg0))], "CUBIERTA", cerrada=True,
                  relleno="#d77a50")  # fmt: skip
    xt = xg0 + 120
    yt = yg0 + 120
    while yt < yg1:  # canales de la teja a lo largo de la pendiente (en x)
        lam.polilinea([P(xg0, yt, z_techo(xg0) + 30), P(xg1, yt, z_techo(xg1) + 30)], "NOTA")
        yt += 240
    del xt
    n0 = filas[0]["n"]
    _riel3d(lam, P, prof, filas, color="#3d6aa8", fantasma={(0, n0 - 1), (0, n0 - 2)})
    f = filas[0]
    _cota(lam, P(f["xb"] + 200, f["y0"], z_techo(f["xb"] + 200)),
          P(f["xb"] + 200, f["y0"] + f["largo"], z_techo(f["xb"] + 200)), f"{f['largo']:.0f}",
          off=2.5, h=1.2)  # fmt: skip
    xr = x0 + w - 54
    a = anclajes(f)
    r0, r1 = rieles_x(f)
    rot = [
        (P(f["xa"] + 800, f["y0"] + 500, z_techo(f["xa"] + 800) + H_MOD),
         "Módulo vertical, coplanar a 15° (agua oeste)"),
        (P(r0, a[-1], z_techo(r0) + 100), "Riel de aluminio (2 por hilera)"),
        (P(r1, a[-2], z_techo(r1)), f"Anclaje en L para teja c/ ≤ {PASO_ANCLAJE / 1000:.1f} m"),
        (P(f["xa"], f["y0"] + ANCHO_MOD + SEP / 2, z_techo(f["xa"]) + H_MOD),
         "Mid clamp en juntas · end clamp en extremos"),
        (P(xg0 + 200, yg1 - 300, z_techo(xg0 + 200)), "Teja española (canales en la pendiente)"),
        (P(xg1, yg0 + 300, z_techo(xg1)), "Borde alto: muro de ladrillo sobre la losa"),
    ]  # fmt: skip
    rot.sort(key=lambda it: -it[0][1])
    y_prev = None
    for p_, t in rot:
        yq = p_[1] + 3 if y_prev is None else min(p_[1] + 3, y_prev - 6)
        y_prev = yq
        _guia(lam, p_, (xr, yq))
        _caja_texto(lam, (xr, yq + 1.5), [t], h=1.1)
    lam.texto((x0 + 2, y0 + 2), f"Hilera de {filas[0]['n']} módulos (agua oeste, bloque sur); la "
              "del medio se arma igual. Dos módulos en corte.", 1.1, "NOTA")  # fmt: skip


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
    zr = Z_BORDE

    def px(ym, zm):
        return (x + (ym - ya) * k, y + (zm - Z_LOSA) * k)

    lam.polilinea([px(ya, Z_LOSA), px(yb, Z_LOSA), px(yb, Z_BORDE), px(ya, Z_BORDE)], "CUBIERTA",
                  cerrada=True, relleno="#e3a183")  # fmt: skip
    lam.rect(x - 3, y - 1.2, (yb - ya) * k + 6, 1.2, "CUBIERTA", relleno="#bdbdbd")
    lam.texto((x + (yb - ya) * k / 2, y + (zr - Z_LOSA) * k + 2), "MURO DE LADRILLO · LOSA",
              1.4, "NOTA", "centro")  # fmt: skip
    lam.texto((x + 1, y - 3.2), "Losa de equipos (≈ 7,8 m); borde de la teja ≈ 2,4 m sobre la losa",
              1.1, "NOTA")  # fmt: skip
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
    y_dc = _Y_DC[0]
    tubo(lam, [px(y_dc, Z_BORDE + 300), px(y_dc, Z_LOSA + 150), px(yi, Z_LOSA + 150),
               px(yi, inv[4])], 1.1, "DC", "#f6c9c4", abrazaderas=7)  # fmt: skip
    tubo(lam, [px(yt, tab[4]), px(yt, Z_LOSA + 400), px(ya, Z_LOSA + 400)], 1.5, "AC", "#cfe0f5",
         abrazaderas=7)  # fmt: skip
    tubo(lam, [px(inv[2], Z_LOSA + 1300), px(tab[3], Z_LOSA + 1300)], 1.2, "AC", "#cfe0f5")
    yb_ = bat[3] - 150
    tubo(lam, [px(yb_, bat[5]), px(yb_, Z_LOSA + 1250), px(inv[2], Z_LOSA + 1250)], 1.0, "DC",
         "#f6c9c4")  # fmt: skip
    caja_paso(lam, px(yt - 400, Z_LOSA + 400), 2.0)
    W = (yb - ya) * k
    _caja_texto(lam, (x + W + 3, y + 6), ['DC: coraza 1" sobre el muro,',
                "baja y va junto al piso"], h=1.1)  # fmt: skip
    _guia(lam, px(y_dc, Z_LOSA + 1200), (x + W + 3, y + 3))
    _caja_texto(lam, (x - 2, y + 9), ['AC: IMC 2" hacia el muro blanco', "Caja de paso 10x10 IP66",
                "2 x [3N° 6 + 1N° 6 (N) + 1N° 8 (T)] Cu"], h=1.1, alinear="der")  # fmt: skip
    _guia(lam, px(ya + 200, Z_LOSA + 400), (x - 2, y + 6))
    _caja_texto(lam, (x + W + 3, y + 22), ["Batería DEYE GB-L en el piso", 'Coraza 1" a inversor',
                f"Inversor {d['inversor_modelo']}"], h=1.1)  # fmt: skip


_Y_DC = [2500.0]  # se actualiza con la ruta DC


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
    _Y_DC[0] = dc[0][1]
    az = (270 - GIRO_DEG) % 360
    orient = f"{az:.0f}° (oeste), coplanar {INCL:.0f}° (teja)"
    notas = [
        f"Sistema de {d['modulos']} módulos JA Solar de 595 Wp ({_f(d['kwp'])} kWp) y un inversor "
        f"{d['inversor_modelo']}.",
        f"Módulos verticales solo sobre la franja de teja de las aguas oeste (bloque sur y bloque "
        f"medio: {' + '.join(str(f['n']) for f in filas)}), mirando a {az:.0f}° a {INCL:.0f}°, "
        "sobre riel completo; la parte baja de cada agua es losa.",
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
    planta_fijacion(lam, 18, 90, filas)
    _titulo_vista(
        lam, 14, 146, 3, "Planta de fijación con riel completo", "ESC 1:100 (cotas en mm)"
    )
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
    if puente:
        ruta_planta(lam, m, en_planta(puente), "DC", "#f6c9c4", "P-", pos=0.7)
    i_in = next(i for i, q in enumerate(ac) if abs(q[2] - Z_CIELO) < 1)
    ac_p = en_planta(ac[: i_in + 1])
    ruta_planta(lam, m, [(q[0] + 250, q[1]) if abs(q[0] - X_EQ) < 1 else q for q in ac_p], "AC",
                "#cfe0f5", "AC-", pos=0.7)  # fmt: skip
    interior = [m(q[:2]) for q in ac[i_in:]]  # dentro de la casa, por el cielo falso del 1° piso
    lam.polilinea(interior, "AC", trazo="discontinuo")
    lam.texto(((interior[1][0] + interior[2][0]) / 2, interior[1][1] - 2.2),
              "cielo falso 1° piso ≈ 5 m (punteado)", 1.0, "AC", "centro")  # fmt: skip
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
        "Puente entre hileras sobre el muro blanco; baja a la losa por el muro de ladrillo",
        f"Longitud total DC (con el puente): {L['dc_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _caja_texto(lam, (278, 80), [
        "RUTA AC (azul)", 'IMC 2" por la losa y el muro blanco; cielo falso ≈ 5 m',
        "2 x [3N° 6 AWG (F) + 1N° 6 (N) + 1N° 8 (T)] Cu",
        "Hasta el tablero de distribución junto a la cocina",
        f"Longitud total AC: {L['ac_total']:.1f} m",
    ], h=1.25)  # fmt: skip
    _detalle_dc(lam, 278, 112, d, "Sobre el muro de ladrillo hasta la losa")
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
    detalle_ruta(
        lam,
        (14, 58, 196, 84),
        dc,
        desc_dc,
        "dc",
        vista,
        escena,
        NOTAS_RUTA["dc"][:5],
        extra=[("P", "Puente entre hileras (sobre el muro blanco)", sum(_largos(puente)))]
        if puente
        else (),
    )
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
