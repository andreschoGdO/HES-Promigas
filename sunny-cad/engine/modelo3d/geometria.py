"""Geometría 3D del proyecto (Paso 6), generada solo desde proyecto.json y la biblioteca.

Unidades mm; X este, Y norte, Z arriba (convenciones de CLAUDE.md). Cada elemento es una malla
de trimesh con su tipo, color y propiedades, que luego se exporta a glTF (visor y renders) e IFC.

Simplificaciones (borrador): cubiertas como losas de 200 mm; la terraza alta como un volumen
macizo hasta su cota; pérgola esquemática (columnas en las esquinas y vigas perimetrales);
equipos como cajas con las medidas de su ficha. Sin pretiles: no hay datos de su altura.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import trimesh
from shapely.geometry import Polygon

from engine.distribucion.colocacion import direccion, ejes

ESPESOR_LOSA_MM = 200
SECCION_PERFIL_MM = 100

COLORES = {
    "losa": (190, 190, 185, 255),
    "volumen": (200, 160, 130, 255),
    "modulo": (18, 32, 70, 255),
    "estructura": (150, 155, 160, 255),
    "inversor": (245, 245, 245, 255),
    "bateria": (235, 235, 235, 255),
    "tablero": (200, 200, 195, 255),
}


@dataclass
class Elemento:
    id: str
    tipo: str  # losa, volumen, modulo, estructura, inversor, bateria, tablero
    malla: trimesh.Trimesh
    propiedades: dict[str, Any] = field(default_factory=dict)


def _prisma(contorno_mm: list[list[float]], z0: float, z1: float) -> trimesh.Trimesh:
    return trimesh.creation.extrude_polygon(Polygon(contorno_mm), z1 - z0).apply_translation(
        (0, 0, z0)
    )


def _caja(ancho: float, largo: float, alto: float) -> trimesh.Trimesh:
    """Caja centrada en el origen: ancho en X local, largo en Y local, alto en Z."""
    return trimesh.creation.box(extents=(ancho, largo, alto))


def _colocar(
    malla: trimesh.Trimesh,
    centro: tuple[float, float, float],
    rumbo_x_deg: float,
    inclinacion_deg: float = 0,
) -> trimesh.Trimesh:
    """Gira la malla (inclinación sobre X local, luego rumbo de X local) y la traslada."""
    m = malla.copy()
    if inclinacion_deg:
        m.apply_transform(
            trimesh.transformations.rotation_matrix(math.radians(inclinacion_deg), (1, 0, 0))
        )
    ux, uy = direccion(rumbo_x_deg)
    giro = math.atan2(uy, ux)  # ángulo desde +X (este) en sentido antihorario
    m.apply_transform(trimesh.transformations.rotation_matrix(giro, (0, 0, 1)))
    m.apply_translation(centro)
    return m


def plano_zona(zona: dict[str, Any], z_base: float):
    """Función z(x, y) del plano de los módulos: el borde más bajo (hacia el azimut) a z_base."""
    _, v, _ = ejes(zona)
    v_max = max(p[0] * v[0] + p[1] * v[1] for p in zona["contorno_mm"])
    t = math.tan(math.radians(zona["inclinacion_deg"]))

    def z(x: float, y: float) -> float:
        return z_base + (v_max - (x * v[0] + y * v[1])) * t

    return z


def _cota(cub: dict[str, Any]) -> float:
    return cub["cota_base_mm"] or 0


def elementos(
    proyecto: dict[str, Any],
    biblioteca: dict[str, dict[str, Any]],
    entrada_electrica: dict[str, Any] | None = None,
) -> list[Elemento]:
    viv = proyecto["vivienda"]
    cubiertas = {c["id"]: c for c in viv["cubiertas"]}
    cota_min = min(_cota(c) for c in viv["cubiertas"])
    out: list[Elemento] = []

    for c in viv["cubiertas"]:
        z = _cota(c)
        if z > cota_min:  # nivel elevado: volumen macizo desde el nivel inferior
            malla, tipo = _prisma(c["contorno_mm"], cota_min - ESPESOR_LOSA_MM, z), "volumen"
        else:
            malla, tipo = _prisma(c["contorno_mm"], z - ESPESOR_LOSA_MM, z), "losa"
        out.append(Elemento(c["id"], tipo, malla, {"material": c.get("material")}))

    zonas = {z["id"]: z for z in viv.get("zonas_instalacion", [])}
    planos = {}
    for zid, zona in zonas.items():
        base = _cota(cubiertas[zona["cubierta_ref"]]) + (zona.get("altura_estructura_mm") or 0)
        planos[zid] = plano_zona(zona, base)
        if zona["estructura"] == "pergola":
            out += _pergola(zona, _cota(cubiertas[zona["cubierta_ref"]]), planos[zid])

    for e in proyecto["equipos"]:
        comp = biblioteca[e["componente_ref"]]
        if e["tipo"] == "modulo":
            col = e["colocacion"]
            zona = zonas[col["zona_ref"]]
            d = comp["dimensiones"]
            corto, largo = sorted((d["ancho_mm"], d["alto_mm"]))
            ancho_u, largo_v = (
                (corto, largo) if col["orientacion"] == "vertical" else (largo, corto)
            )
            # Caja local: X a lo largo de la fila, Y en la pendiente.
            caja = _caja(ancho_u, largo_v, d["profundidad_mm"])
            x, y = col["centro_mm"]
            zc = planos[zona["id"]](x, y) + d["profundidad_mm"] / 2
            malla = _colocar(caja, (x, y, zc), col["rumbo_fila_deg"], col["inclinacion_deg"])
            out.append(
                Elemento(
                    e["id"],
                    "modulo",
                    malla,
                    {
                        "componente_ref": comp["id"],
                        "fabricante": comp["fabricante"],
                        "modelo": comp["modelo"],
                        "potencia_w": comp["electrico"]["potencia_stc_w"],
                        "string": e.get("string"),
                        "zona": zona["id"],
                        "inclinacion_deg": col["inclinacion_deg"],
                        "azimut_deg": col["azimut_deg"],
                    },
                )
            )
        elif "ubicacion_mm" in e and entrada_electrica:
            out.append(_equipo(e, comp, entrada_electrica))

    if entrada_electrica and "tablero-fv" in entrada_electrica.get("ubicaciones", {}):
        t = entrada_electrica["tablero_fv"]
        ub = entrada_electrica["ubicaciones"]["tablero-fv"]
        caja = _caja(t["ancho_mm"], t["profundidad_mm"], t["alto_mm"])
        malla = _colocar(
            caja, (*ub["punto"], ub["z_mm"]), entrada_electrica["rumbo_muro_equipos_deg"]
        )
        out.append(
            Elemento(
                "tablero-fv",
                "tablero",
                malla,
                {"descripcion": "Tablero FV con contactor (ATS) y medidor", "es_supuesto": True},
            )
        )
    return out


def _equipo(e: dict[str, Any], comp: dict[str, Any], entrada: dict[str, Any]) -> Elemento:
    ub = e["ubicacion_mm"]
    if e["tipo"] == "bateria":
        conf = next(
            c for c in comp["electrico"]["configuraciones"] if c["id"] == e["configuracion"]
        )
        d = conf["dimensiones"]
        zc = ub["z_mm"] + d["alto_mm"] / 2  # la batería se apoya en el piso
    else:
        d = comp["dimensiones"]
        zc = ub["z_mm"]  # inversor y otros: z es el centro
    caja = _caja(d["ancho_mm"], d["profundidad_mm"], d["alto_mm"])
    malla = _colocar(caja, (*ub["punto"], zc), entrada["rumbo_muro_equipos_deg"])
    return Elemento(
        e["id"],
        e["tipo"],
        malla,
        {
            "componente_ref": comp["id"],
            "fabricante": comp["fabricante"],
            "modelo": comp["modelo"],
            "es_supuesto": ub["es_supuesto"],
        },
    )


def _pergola(zona: dict[str, Any], z_piso: float, z_plano) -> list[Elemento]:
    """Columnas en las esquinas hasta el plano de los módulos y vigas perimetrales."""
    s = SECCION_PERFIL_MM
    pts = zona["contorno_mm"]
    out = []
    for i, (x, y) in enumerate(pts):
        z_top = z_plano(x, y)
        col = trimesh.creation.box(extents=(s, s, z_top - z_piso)).apply_translation(
            (x, y, (z_top + z_piso) / 2)
        )
        out.append(
            Elemento(f"{zona['id']}-columna-{i + 1}", "estructura", col, {"es_esquematico": True})
        )
    for i in range(len(pts)):
        a, b = np.array(pts[i], float), np.array(pts[(i + 1) % len(pts)], float)
        za, zb = z_plano(*a) - s / 2, z_plano(*b) - s / 2
        p0, p1 = np.array([*a, za]), np.array([*b, zb])
        largo = float(np.linalg.norm(p1 - p0))
        viga = trimesh.creation.box(extents=(largo, s, s))
        eje = (p1 - p0) / largo
        rot = trimesh.geometry.align_vectors((1, 0, 0), eje)
        viga.apply_transform(rot).apply_translation((p0 + p1) / 2)
        out.append(
            Elemento(f"{zona['id']}-viga-{i + 1}", "estructura", viga, {"es_esquematico": True})
        )
    return out


def escena(elems: list[Elemento]) -> trimesh.Scene:
    """Escena glTF en metros, con Y arriba (convención glTF): (x, y, z)mm → (x, z, −y)m."""
    sc = trimesh.Scene()
    a_gltf = np.array([[1e-3, 0, 0, 0], [0, 0, 1e-3, 0], [0, -1e-3, 0, 0], [0, 0, 0, 1]])
    for el in elems:
        m = el.malla.copy()
        m.apply_transform(a_gltf)
        r, g, b, alfa = COLORES[el.tipo]
        material = trimesh.visual.material.PBRMaterial(
            name=el.tipo,
            baseColorFactor=[r / 255, g / 255, b / 255, alfa / 255],
            metallicFactor=0.6 if el.tipo == "estructura" else 0.0,
            roughnessFactor=0.35 if el.tipo == "modulo" else 0.8,
        )
        m.visual = trimesh.visual.TextureVisuals(material=material)
        sc.add_geometry(m, node_name=el.id, geom_name=el.id)
    return sc
