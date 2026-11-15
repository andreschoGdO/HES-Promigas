"""Convierte el trazado en píxeles (insumos/lectura.json) en cubiertas del proyecto, en mm.

Pasos deterministas:
1. píxel (x a la derecha, y hacia abajo) → metros de imagen (x a la derecha, y hacia arriba);
2. giro para que el norte quede en +Y (``rotacion_norte_deg``);
3. traslado del origen a la esquina suroeste del rectángulo que contiene todas las cubiertas;
4. redondeo a milímetros enteros.

Los datos que no se ven en la imagen (inclinación, azimut, altura…) quedan en null y se
agregan a ``informacion_faltante``. Nunca se suponen.
"""

from __future__ import annotations

import copy
import math
from typing import Any

from engine.lectura.escala import mm_por_pixel
from engine.pendientes import rutas_pendientes, texto_faltante

Punto = tuple[float, float]

CAMPOS_CUBIERTA = ("tipo", "material", "cota_base_mm", "inclinacion_deg", "azimut_deg")


def a_planta(punto_px: list[float], escala_mm_px: float, rotacion_norte_deg: float) -> Punto:
    """Píxel → (este, norte) en mm, sin trasladar el origen."""
    x = punto_px[0] * escala_mm_px
    y = -punto_px[1] * escala_mm_px
    # El norte está `r` grados en sentido horario desde "arriba": se gira `r` en sentido
    # antihorario para llevarlo a +Y.
    r = math.radians(rotacion_norte_deg)
    return (x * math.cos(r) - y * math.sin(r), x * math.sin(r) + y * math.cos(r))


def cubiertas_desde_lectura(lectura: dict[str, Any]) -> list[dict[str, Any]]:
    """Cubiertas en mm, con origen en la esquina suroeste de la vivienda."""
    s = mm_por_pixel(lectura["escala"])
    r = lectura["imagen"]["rotacion_norte_deg"]

    def convertir(contorno: list[list[float]]) -> list[Punto]:
        return [a_planta(p, s, r) for p in contorno]

    crudas = []
    for c in lectura["cubiertas"]:
        obstaculos = [(o, convertir(o["contorno_px"])) for o in c["obstaculos"]]
        crudas.append((c, convertir(c["contorno_px"]), obstaculos))

    todos = [p for _, contorno, _ in crudas for p in contorno]
    x0 = min(p[0] for p in todos)
    y0 = min(p[1] for p in todos)

    def trasladar(contorno: list[Punto]) -> list[list[int]]:
        return [[round(x - x0), round(y - y0)] for x, y in contorno]

    cubiertas = []
    for c, contorno, obstaculos in crudas:
        cubierta: dict[str, Any] = {"id": c["id"]}
        for campo in CAMPOS_CUBIERTA[:2]:
            cubierta[campo] = c.get(campo)
        cubierta["contorno_mm"] = trasladar(contorno)
        for campo in CAMPOS_CUBIERTA[2:]:
            cubierta[campo] = c.get(campo)
        cubierta["obstaculos"] = [
            {
                "id": o["id"],
                "tipo": o["tipo"],
                "contorno_mm": trasladar(cont),
                "altura_mm": o.get("altura_mm"),
            }
            for o, cont in obstaculos
        ]
        cubiertas.append(cubierta)
    return cubiertas


def proponer_proyecto(proyecto: dict[str, Any], lectura: dict[str, Any]) -> dict[str, Any]:
    """Copia del proyecto con las cubiertas del trazado. No modifica el original.

    Las entradas de informacion_faltante generadas automáticamente (las que empiezan por una
    ruta de dato pendiente) se recalculan; las escritas a mano se conservan.
    """
    propuesta = copy.deepcopy(proyecto)
    propuesta["vivienda"]["cubiertas"] = cubiertas_desde_lectura(lectura)

    rutas_viejas = set(rutas_pendientes(proyecto))
    manuales = [
        f
        for f in proyecto.get("informacion_faltante", [])
        if not any(f.startswith(f"{r}:") for r in rutas_viejas) and not f.startswith("cubierta-")
    ]
    automaticas = [texto_faltante(r) for r in rutas_pendientes(propuesta)]
    propuesta["informacion_faltante"] = automaticas + manuales
    return propuesta


def medidas_de_lados(contorno_mm: list[list[int]]) -> list[float]:
    """Longitud de cada lado en metros (para comparar con medidas de obra)."""
    n = len(contorno_mm)
    return [round(math.dist(contorno_mm[i], contorno_mm[(i + 1) % n]) / 1000, 2) for i in range(n)]
