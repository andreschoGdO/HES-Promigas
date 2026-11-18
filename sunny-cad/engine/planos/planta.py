"""Lámina de planta: cubiertas, zonas, módulos con su string, estructura y equipos.

Las huellas salen de engine.modelo3d.geometria, así planta y modelo 3D coinciden siempre.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from shapely.geometry import MultiPoint, Polygon

from engine.modelo3d.geometria import Elemento
from engine.planos.lamina import Lamina, Vista

ESCALAS = (50, 75, 100, 125, 150, 200, 250)
COLOR_STRING = ["#2b5aa8", "#0f8a6a", "#9b4fb3", "#c77b12", "#b33a3a", "#3a8fb3"]
CAPA_ELEMENTO = {
    "madera": "ESTRUCTURA",
    "inversor": "EQUIPO",
    "bateria": "EQUIPO",
    "tablero": "EQUIPO",
    "buitron": "EQUIPO",
    "muro": "CUBIERTA",
    "conexion": "EQUIPO",
}


def _huella(e: Elemento) -> list[tuple[float, float]]:
    return list(MultiPoint(e.malla.vertices[:, :2].tolist()).convex_hull.exterior.coords)[:-1]


def _cotas(lam: Lamina, vista: Vista, contorno, capa="COTA", separacion=4.0, minimo_m=0.5) -> None:
    """Longitud de cada lado (m), escrita paralela al lado y por fuera del polígono."""
    pol = Polygon(contorno)
    n = len(contorno)
    for i in range(n):
        a, b = np.array(contorno[i], float), np.array(contorno[(i + 1) % n], float)
        largo = np.linalg.norm(b - a) / 1000
        if largo < minimo_m:
            continue
        d = (b - a) / np.linalg.norm(b - a)
        normal = np.array([d[1], -d[0]])
        medio = (a + b) / 2
        if pol.contains(MultiPoint([tuple(medio + normal * 50)]).geoms[0]):
            normal = -normal
        pa, pb = np.array(vista(a)), np.array(vista(b))
        off = normal * separacion
        lam.linea(pa + off * 0.5, pb + off * 0.5, capa)
        ang = math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0]))
        if ang > 90 or ang < -90:
            ang += 180
        lam.texto((pa + pb) / 2 + off * 1.3, f"{largo:.2f}", 2.0, capa, "centro", rotacion=ang)


def dibujar(lam: Lamina, area, proyecto: dict[str, Any], elems: list[Elemento], biblioteca) -> None:
    x0, y0, aw, ah = area
    viv = proyecto["vivienda"]
    todos = np.array([p for c in viv["cubiertas"] for p in c["contorno_mm"]], float)
    mn, mx = todos.min(axis=0), todos.max(axis=0)
    ancho_dib = aw - 120  # columna derecha para cuadro resumen y convenciones
    n = next(
        e
        for e in ESCALAS
        if (mx[0] - mn[0]) / e <= ancho_dib - 20 and (mx[1] - mn[1]) / e <= ah - 25
    )
    lam.escala = f"1:{n}"
    centro_papel = (x0 + ancho_dib / 2, y0 + ah / 2)
    vista = Vista(n, (mn + mx) / 2, centro_papel)

    for c in viv["cubiertas"]:
        pts = [vista(p) for p in c["contorno_mm"]]
        lam.polilinea(
            pts, "CUBIERTA", cerrada=True, relleno="#ececE6" if not c["cota_base_mm"] else "#e3d6c8"
        )
        cx, cy = np.mean(pts, axis=0)
        nivel = (c["cota_base_mm"] or 0) / 1000
        if (
            Polygon(c["contorno_mm"]).area > 10e6
        ):  # las cubiertas pequeñas no se rotulan (se lee en las cotas)
            lam.texto((cx, cy - 12), f"{c['id'].upper()}  NPT {nivel:+.2f}", 2.2, "NOTA", "centro")
        _cotas(lam, vista, c["contorno_mm"])
    for z in viv.get("zonas_instalacion", []):
        lam.polilinea(
            [vista(p) for p in z["contorno_mm"]], "ZONA", cerrada=True, trazo="discontinuo"
        )

    strings = sorted({e.propiedades.get("string") for e in elems if e.tipo == "modulo"} - {None})
    for e in elems:
        if e.tipo in CAPA_ELEMENTO:
            relleno = {
                "madera": "#c9a27a",
                "inversor": "#f4d4cf",
                "bateria": "#f4d4cf",
                "tablero": "#f4d4cf",
                "buitron": "#d9c7b8",
                "conexion": "#d0d0d0",
                "muro": "#cfc2b4",
            }[e.tipo]
            lam.polilinea(
                [vista(p) for p in _huella(e)], CAPA_ELEMENTO[e.tipo], cerrada=True, relleno=relleno
            )
    for e in elems:
        if e.tipo != "modulo":
            continue
        color = COLOR_STRING[strings.index(e.propiedades["string"]) % len(COLOR_STRING)]
        pts = [vista(p) for p in _huella(e)]
        lam.polilinea(pts, "MODULO", cerrada=True, relleno=color)
        cx, cy = np.mean(pts, axis=0)
        lam.texto((cx, cy + 1.2), e.id[-3:], 1.6, "TEXTO", "centro")
        lam.texto((cx, cy - 1.6), e.propiedades["string"], 1.3, "TEXTO", "centro")
    # Rutas de cableado (esquemáticas, desde el modelo 3D)
    for e in elems:
        if e.tipo.startswith("canalizacion"):
            capa = "DC" if e.propiedades["circuito"] == "DC" else "AC"
            lam.polilinea(
                [vista(p[:2]) for p in e.propiedades["ruta_mm"]], capa, trazo="discontinuo"
            )
    # Etiquetas de equipos
    for e in elems:
        if e.tipo in ("inversor", "bateria", "tablero", "buitron", "conexion"):
            cx, cy = np.mean([vista(p) for p in _huella(e)], axis=0)
            nombre = {
                "inversor": "INV",
                "bateria": "BAT",
                "tablero": "TFV",
                "buitron": "BUITRÓN",
                "conexion": "PCC",
            }[e.tipo]
            lam.texto((cx, cy), nombre, 1.1, "EQUIPO", "centro", negrita=True)

    # Norte y escala gráfica
    nx, ny = x0 + 8, y0 + ah - 18
    lam.polilinea(
        [(nx, ny), (nx + 3, ny - 8), (nx, ny - 6), (nx - 3, ny - 8)],
        "TEXTO",
        cerrada=True,
        relleno="#000000",
    )
    lam.texto((nx, ny + 3), "N", 3.5, "TEXTO", "centro", negrita=True)
    bx, by = x0 + 4, y0 + 4
    paso = 1000 / n  # 1 m en papel
    for i in range(5):
        lam.rect(bx + i * paso, by, paso, 1.5, "TEXTO", relleno="#000000" if i % 2 == 0 else None)
    lam.texto((bx, by + 3), "0", 1.8)
    lam.texto((bx + 5 * paso, by + 3), "5 m", 1.8, alinear="der")
    lam.texto((bx + 5 * paso + 4, by), f"ESCALA 1:{n}", 2.2)

    _cuadro(lam, x0 + ancho_dib + 4, y0, 116, ah, proyecto, elems, biblioteca, strings)


def _cuadro(lam, x, y, w, h, proyecto, elems, biblioteca, strings) -> None:
    mods = [e for e in elems if e.tipo == "modulo"]
    m = biblioteca[mods[0].propiedades["componente_ref"]] if mods else None
    eq = {e["tipo"]: e for e in proyecto["equipos"] if e["tipo"] != "modulo"}
    filas = [("RESUMEN DEL SISTEMA", None)]
    if m:
        p = len(mods) * m["electrico"]["potencia_stc_w"] / 1000
        filas += [("Módulos", f"{len(mods)} × {m['modelo']}"), ("Potencia DC", f"{p:.2f} kWp")]
    if "inversor" in eq:
        inv = biblioteca[eq["inversor"]["componente_ref"]]
        filas += [
            ("Inversor", f"{inv['fabricante']} {inv['modelo']}"),
            ("Potencia AC", f"{inv['electrico']['potencia_nominal_ac_w'] / 1000:g} kW"),
        ]
    if "bateria" in eq:
        bat = biblioteca[eq["bateria"]["componente_ref"]]
        conf = next(
            c
            for c in bat["electrico"]["configuraciones"]
            if c["id"] == eq["bateria"]["configuracion"]
        )
        filas += [
            ("Batería", f"{bat['fabricante']} {conf.get('modelo_comercial', conf['id'])}"),
            (
                "Energía",
                f"{conf.get('energia_nominal_kwh', conf['energia_util_kwh'])} kWh "
                f"({conf['energia_util_kwh']} útiles)",
            ),
        ]
    zonas = proyecto["vivienda"].get("zonas_instalacion", [])
    if zonas:
        z = zonas[0]
        filas.append(("Orientación", f"{z['inclinacion_deg']}° hacia {z['azimut_deg']}°"))
    s = proyecto["sistema"]
    filas.append(
        ("Tipología", f"{s['tipologia']} · {s['arquitectura'] or '—'} · {s['conmutacion'] or '—'}")
    )
    filas.append(("CONVENCIONES", None))
    filas += [
        (f"■ {st}", f"{sum(1 for e in mods if e.propiedades['string'] == st)} módulos")
        for st in strings
    ]
    filas += [
        ("INV / BAT / TFV", "inversor / batería / tablero FV"),
        ("- - -", "zona de instalación"),
        ("DC (naranja)", "ruta de cableado DC"),
        ("AC (azul)", "ruta de cableado AC"),
        ("Madera", "estructura de la pérgola"),
        ("Cotas", "en metros; NPT = nivel de piso terminado"),
    ]
    yy = y + h - 6
    lam.rect(x, y, w, h, "CAJETIN")
    for k, v in filas:
        if v is None:
            yy -= 2
            lam.texto((x + 3, yy), k, 2.6, "TEXTO", negrita=True)
            yy -= 6
            continue
        color = None
        if k.startswith("■"):
            color = COLOR_STRING[strings.index(k[2:]) % len(COLOR_STRING)]
            lam.rect(x + 3, yy - 0.3, 3, 3, "MODULO", relleno=color)
            k = k[2:]
        lam.texto((x + (8 if color else 3), yy), k, 2.1, "NOTA")
        lam.texto((x + 40, yy), v, 2.1, "TEXTO")
        yy -= 5
    notas = [n for n in proyecto["informacion_faltante"]][:6]
    if notas:
        yy -= 3
        lam.texto((x + 3, yy), "PENDIENTES", 2.6, "TEXTO", negrita=True)
        yy -= 5
        import textwrap

        for n_ in notas:
            for linea in textwrap.wrap(n_, 74)[:3]:
                lam.texto((x + 3, yy), linea, 1.7, "NOTA")
                yy -= 3
            yy -= 1
