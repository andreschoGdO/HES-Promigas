"""Lámina de alzado del muro de equipos: posiciones y alturas reales de tablero, inversor,
batería y buitrón, proyectadas desde el modelo 3D sobre el plano del muro.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from engine.modelo3d.geometria import Elemento
from engine.planos.lamina import Lamina

NOMBRES = {
    "tablero": "TABLERO FV",
    "inversor": "INVERSOR",
    "bateria": "BATERÍA",
    "buitron": "BUITRÓN",
    "claraboya": "CLARABOYA",
}
RELLENO = {
    "tablero": "#f4d4cf",
    "inversor": "#f4d4cf",
    "bateria": "#f4d4cf",
    "buitron": "#e6d9cc",
    "claraboya": "#cfe6f2",
}


def _cota_h(lam, x1, x2, y, texto, capa="COTA"):
    lam.linea((x1, y), (x2, y), capa)
    for x in (x1, x2):
        lam.linea((x, y - 1.5), (x, y + 1.5), capa)
    lam.texto(((x1 + x2) / 2, y + 1.2), texto, 2.0, capa, "centro")


def _cota_v(lam, x, y1, y2, texto, capa="COTA"):
    lam.linea((x, y1), (x, y2), capa)
    for y in (y1, y2):
        lam.linea((x - 1.5, y), (x + 1.5, y), capa)
    lam.texto((x - 1.5, (y1 + y2) / 2), texto, 2.0, capa, "centro", rotacion=90)


def dibujar(
    lam: Lamina,
    area,
    proyecto: dict[str, Any],
    elems: list[Elemento],
    entrada: dict[str, Any],
    biblioteca,
) -> None:
    x0, y0, aw, ah = area
    muro = entrada["muro_equipos"]
    a, b = np.array(muro["de"], float), np.array(muro["a"], float)
    largo = float(np.linalg.norm(b - a))
    d = (b - a) / largo
    alto = muro["alto_mm"]
    n = 20
    lam.escala = f"1:{n}"
    k = 1 / n
    # Visto de frente, la esquina "de" (junto a la terraza alta) queda a la derecha.
    ox, oy = x0 + 40, y0 + 30
    W, H = largo * k, alto * k

    def px(s_mm, z_mm):
        return (ox + W - s_mm * k, oy + z_mm * k)

    lam.rect(ox, oy, W, H, "CUBIERTA", relleno="#efe6dc")
    lam.linea((ox - 15, oy), (ox + W + 15, oy), "CUBIERTA")
    lam.texto((ox + W + 2, oy - 4), "NPT ±0.00 (terraza baja)", 2.0, "NOTA")
    lam.texto(
        (ox + W / 2, oy + H + 4),
        "MURO DE EQUIPOS — ALZADO FRONTAL",
        2.8,
        "TEXTO",
        "centro",
        negrita=True,
    )

    filas = []
    for e in elems:
        if e.tipo not in NOMBRES:
            continue
        v = e.malla.vertices
        s = (v[:, :2] - a) @ d
        s0, s1, z0, z1 = float(s.min()), float(s.max()), float(v[:, 2].min()), float(v[:, 2].max())
        if s1 < -50 or s0 > largo + 50:
            continue
        p0, p1 = px(s1, z0), px(s0, z1)
        normal = np.array([-d[1], d[0]])
        lejos = float(np.abs((v[:, :2] - a) @ normal).min())  # separación del muro
        en_frente = lejos > 300
        lam.rect(
            p0[0],
            p0[1],
            p1[0] - p0[0],
            p1[1] - p0[1],
            "EQUIPO",
            relleno=None if en_frente else RELLENO[e.tipo],
            trazo="discontinuo" if en_frente else "continuo",
        )
        if en_frente:
            lam.texto(
                ((p0[0] + p1[0]) / 2, p1[1] + 2),
                f"en primer plano, a {lejos / 1000:.2f} m del muro",
                1.6,
                "NOTA",
                "centro",
            )
        lam.texto(
            ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + 2),
            NOMBRES[e.tipo],
            2.4,
            "TEXTO",
            "centro",
            negrita=True,
        )
        modelo = e.propiedades.get("modelo") or (
            "supuesto" if e.propiedades.get("es_supuesto") else ""
        )
        lam.texto(((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 2), modelo, 1.8, "TEXTO", "centro")
        filas.append((s0, s1, z0, z1, e))

    # Rutas de cableado proyectadas sobre el muro (las que corren cerca de él)
    normal = np.array([-d[1], d[0]])
    for e in elems:
        if not e.tipo.startswith("canalizacion") or e.propiedades.get("nivel_inferior"):
            continue
        pts = []
        for x, y, z in e.propiedades["ruta_mm"]:
            q = np.array([x, y]) - a
            if abs(q @ normal) < 1200 and -300 < q @ d < largo + 300:
                pts.append(px(float(q @ d), z))
        if len(pts) > 1:
            lam.polilinea(
                pts, "DC" if e.propiedades["circuito"] == "DC" else "AC", trazo="discontinuo"
            )
    lam.texto((ox, oy + H + 18), "Rutas: DC (naranja) · AC (azul) — esquemáticas", 1.8, "NOTA")

    # Cotas horizontales (posición desde la esquina interior, a la izquierda) y verticales (alturas)
    for i, (s0, s1, z0, z1, _e) in enumerate(sorted(filas, key=lambda f: f[0])):
        ya = oy - 8 - i * 6
        _cota_h(lam, px(s1, 0)[0], px(s0, 0)[0], ya, f"{(s1 - s0) / 1000:.2f}")
        lam.texto(
            (px(s1, 0)[0] - 1, ya - 3.5),
            f"a {(largo - s1) / 1000:.2f} m de la esquina interior",
            1.6,
            "NOTA",
            "der",
        )
        xv = px(s0, 0)[0] + 3 + (i % 2) * 5
        if z0 > 1:
            _cota_v(lam, xv, oy, oy + z0 * k, f"{z0 / 1000:.2f}")
        _cota_v(lam, xv + 0 if z0 <= 1 else xv, oy + z0 * k, oy + z1 * k, f"{(z1 - z0) / 1000:.2f}")
    _cota_h(lam, ox, ox + W, oy + H + 10, f"{largo / 1000:.2f} (trazado)")
    _cota_v(lam, ox - 8, oy, oy + H, f"{alto / 1000:.2f}")
    lam.texto(
        (ox + W + 2, oy + H - 3), "Origen de cotas: esquina interior (izquierda)", 1.8, "NOTA"
    )

    notas = [
        "NOTAS:",
        "1. Cotas en metros. Medidas de los equipos según su ficha técnica (biblioteca).",
        f"2. Tramo de muro de equipos: {largo / 1000:.2f} m.",
        "3. Posiciones de los equipos y elementos marcados como supuesto: confirmar en obra.",
        "4. Rutas de cableado esquemáticas: DC desde los módulos, AC hacia el punto de conexión.",
        "5. Distancias de trabajo y alturas de montaje: verificar según RETIE y el fabricante.",
    ]
    for i, t in enumerate(notas):
        lam.texto(
            (x0 + aw - 150, y0 + ah - 10 - i * 5),
            t,
            2.2 if i == 0 else 2.0,
            "TEXTO",
            negrita=i == 0,
        )
