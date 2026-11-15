"""Distribución de módulos en zonas de instalación (Paso 4).

Algoritmo determinista, sin IA:

1. Ejes locales de la zona: ``u`` a lo largo de la fila (horizontal, perpendicular al azimut) y
   ``v`` en la dirección de la pendiente (hacia donde miran los módulos).
2. Huella del módulo en planta: a lo largo de la fila mide igual; en la pendiente se acorta
   por cos(inclinación). La separación entre módulos se proyecta igual.
3. La zona se reduce por el retiro y se prueba una grilla con desplazamientos de 0 al paso,
   cada ``paso_busqueda_mm``. Se elige la que más módulos completos deja dentro; en empate,
   el menor desplazamiento.

Unidades: mm. Rumbos y azimut desde el norte, en sentido horario. Ejes: X este, Y norte.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from shapely.geometry import Polygon, box
from shapely.prepared import prep

PASO_BUSQUEDA_MM = 50
TOLERANCIA_MM = 1  # absorbe el redondeo de las esquinas a mm enteros


def direccion(rumbo_deg: float) -> tuple[float, float]:
    """Vector unitario (este, norte) de un rumbo."""
    r = math.radians(rumbo_deg)
    return (math.sin(r), math.cos(r))


@dataclass(frozen=True)
class Colocado:
    centro: tuple[float, float]  # (x, y) en mm del proyecto
    fila: int
    columna: int


def huella_mm(modulo: dict[str, Any], zona: dict[str, Any]) -> tuple[float, float, float, float]:
    """(ancho_u, largo_v, separacion_u, separacion_v) en planta."""
    dims = modulo["dimensiones"]
    largo, corto = max(dims["alto_mm"], dims["ancho_mm"]), min(dims["alto_mm"], dims["ancho_mm"])
    cos_i = math.cos(math.radians(zona["inclinacion_deg"]))
    if zona["orientacion_modulo"] == "vertical":
        du, dv = corto, largo * cos_i
    else:
        du, dv = largo, corto * cos_i
    return du, dv, zona["separacion_mm"], zona["separacion_mm"] * cos_i


def ejes(zona: dict[str, Any]) -> tuple[tuple[float, float], tuple[float, float], float]:
    """Vectores u (fila) y v (pendiente) y rumbo de la fila."""
    rumbo_fila = (zona["azimut_deg"] - 90) % 360
    return direccion(rumbo_fila), direccion(zona["azimut_deg"]), rumbo_fila


def colocar(
    zona: dict[str, Any], modulo: dict[str, Any], paso: int = PASO_BUSQUEDA_MM
) -> list[Colocado]:
    u, v, _ = ejes(zona)
    a_local = lambda p: (p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1])  # noqa: E731
    zona_local = Polygon([a_local(p) for p in zona["contorno_mm"]])
    util = (
        zona_local.buffer(-zona["retiro_mm"], join_style="mitre")
        if zona["retiro_mm"]
        else zona_local
    )
    if util.is_empty:
        return []
    util_p = prep(util.buffer(TOLERANCIA_MM, join_style="mitre"))
    du, dv, gu, gv = huella_mm(modulo, zona)
    pu, pv = du + gu, dv + gv
    umin, vmin, umax, vmax = util.bounds

    mejor: list[tuple[float, float, int, int]] = []
    for ou in range(0, int(pu), paso):
        for ov in range(0, int(pv), paso):
            celdas = []
            nu = int((umax - umin - ou + gu) // pu)
            nv = int((vmax - vmin - ov + gv) // pv)
            for j in range(nv):
                v0 = vmin + ov + j * pv
                for i in range(nu):
                    u0 = umin + ou + i * pu
                    if util_p.contains(box(u0, v0, u0 + du, v0 + dv)):
                        celdas.append((u0 + du / 2, v0 + dv / 2, j, i))
            if len(celdas) > len(mejor):
                mejor = celdas

    # De local a proyecto: p = cu·u + cv·v (u y v son ortonormales).
    filas = sorted({c[2] for c in mejor})
    colocados = []
    for cu, cv, j, i in sorted(mejor, key=lambda c: (c[2], c[3])):
        x = cu * u[0] + cv * v[0]
        y = cu * u[1] + cv * v[1]
        columnas = sorted(c[3] for c in mejor if c[2] == j)
        colocados.append(Colocado((x, y), filas.index(j) + 1, columnas.index(i) + 1))
    return colocados


def huella_poligono(
    centro: tuple[float, float], zona: dict[str, Any], modulo: dict[str, Any]
) -> list[tuple[float, float]]:
    """Esquinas del módulo en planta (mm del proyecto)."""
    u, v, _ = ejes(zona)
    du, dv, _, _ = huella_mm(modulo, zona)
    pts = []
    for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        a, b = su * du / 2, sv * dv / 2
        pts.append((centro[0] + a * u[0] + b * v[0], centro[1] + a * u[1] + b * v[1]))
    return pts


def equipos_modulos(
    zonas: list[dict[str, Any]], modulo: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Equipos modulo-001… para todas las zonas, y la cantidad por zona."""
    equipos, por_zona, n = [], {}, 0
    for zona in zonas:
        _, _, rumbo_fila = ejes(zona)
        colocados = colocar(zona, modulo)
        por_zona[zona["id"]] = len(colocados)
        for c in colocados:
            n += 1
            equipos.append(
                {
                    "id": f"modulo-{n:03d}",
                    "tipo": "modulo",
                    "componente_ref": modulo["id"],
                    "colocacion": {
                        "zona_ref": zona["id"],
                        "centro_mm": [round(c.centro[0]), round(c.centro[1])],
                        "rumbo_fila_deg": round(rumbo_fila, 2),
                        "orientacion": zona["orientacion_modulo"],
                        "inclinacion_deg": zona["inclinacion_deg"],
                        "azimut_deg": zona["azimut_deg"],
                        "fila": c.fila,
                        "columna": c.columna,
                    },
                }
            )
    return equipos, por_zona
