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
from shapely.geometry import Point, Polygon

from engine.distribucion.colocacion import direccion, ejes

ESPESOR_LOSA_MM = 200
SECCION_PERFIL_MM = 100

COLORES = {
    "losa": (190, 190, 185, 255),
    "volumen": (200, 160, 130, 255),
    "modulo": (18, 32, 70, 255),
    "estructura": (150, 155, 160, 255),
    "madera": (139, 94, 60, 255),
    "buitron": (196, 160, 135, 255),
    "muro": (196, 160, 135, 255),
    "canalizacion_dc": (226, 110, 30, 255),
    "canalizacion_ac": (60, 90, 170, 255),
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
            muros = [Polygon(c["contorno_mm"]) for c in viv["cubiertas"] if _cota(c) > cota_min]
            out += _pergola(zona, _cota(cubiertas[zona["cubierta_ref"]]), planos[zid], muros)

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

    if (
        entrada_electrica
        and entrada_electrica.get("muro_equipos", {}).get("modelar", True) is not False
        and "muro_equipos" in entrada_electrica
    ):
        out.append(muro(entrada_electrica["muro_equipos"], viv["cubiertas"]))
    if entrada_electrica and "buitron" in entrada_electrica:
        out.append(
            buitron(entrada_electrica["buitron"], entrada_electrica["rumbo_muro_equipos_deg"])
        )
    if entrada_electrica and "muro_equipos" in entrada_electrica:
        out += canalizaciones(proyecto, entrada_electrica, out)
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


def _viga(p0, p1, ancho: float, alto: float) -> trimesh.Trimesh:
    """Viga de sección ancho × alto entre dos puntos 3D (el alto queda vertical)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    largo = float(np.linalg.norm(p1 - p0))
    eje = (p1 - p0) / largo
    caja = trimesh.creation.box(extents=(largo, ancho, alto))
    horizontal = np.array([eje[0], eje[1], 0.0])
    giro = math.atan2(horizontal[1], horizontal[0])
    pendiente = math.asin(max(-1.0, min(1.0, eje[2])))
    caja.apply_transform(trimesh.transformations.rotation_matrix(-pendiente, (0, 1, 0)))
    caja.apply_transform(trimesh.transformations.rotation_matrix(giro, (0, 0, 1)))
    return caja.apply_translation((p0 + p1) / 2)


def _pergola(zona: dict[str, Any], z_piso: float, z_plano, muros: list[Polygon]) -> list[Elemento]:
    """Pérgola de madera esquemática.

    - Lados contra un muro (a menos de 50 mm de un volumen elevado): viga durmiente anclada al
      muro, sin columnas.
    - Lados libres: columnas de 150 × 150 mm donde se juntan dos lados libres y a mitad de los
      lados libres de más de 5 m.
    - Vigas perimetrales de 100 × 250 mm y correas de 75 × 150 mm bajo cada borde de fila de
      módulos, en la dirección de las filas.
    """
    col, viga_a, viga_h, cor_a, cor_h = 150, 100, 250, 75, 150
    pts = [np.array(p, float) for p in zona["contorno_mm"]]
    n = len(pts)
    adosado = []
    for i in range(n):
        medio = (pts[i] + pts[(i + 1) % n]) / 2
        adosado.append(any(m.exterior.distance(Point(*medio)) < 50 for m in muros))
    props = {"material": "madera", "es_esquematico": True}
    out: list[Elemento] = []

    # Columnas en los vértices que tocan algún lado libre, y a mitad de los lados libres largos.
    apoyos = []
    for i in range(n):
        if not adosado[i - 1] and not adosado[i]:
            apoyos.append(pts[i])
        a, b = pts[i], pts[(i + 1) % n]
        if not adosado[i] and np.linalg.norm(b - a) > 5000:
            apoyos.append((a + b) / 2)
    # Las columnas se meten hacia adentro media sección para no salirse de la zona.
    centro = np.mean(pts, axis=0)
    for k, p in enumerate(apoyos):
        q = p + (centro - p) / np.linalg.norm(centro - p) * col * 0.75
        z_top = z_plano(*q) - cor_h - viga_h / 2
        caja = trimesh.creation.box(extents=(col, col, z_top - z_piso))
        out.append(
            Elemento(
                f"{zona['id']}-columna-{k + 1}",
                "madera",
                caja.apply_translation((q[0], q[1], (z_top + z_piso) / 2)),
                props,
            )
        )

    # Vigas perimetrales (durmiente en los lados contra el muro).
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        za = z_plano(*a) - cor_h - viga_h / 2
        zb = z_plano(*b) - cor_h - viga_h / 2
        nombre = "durmiente" if adosado[i] else "viga"
        out.append(
            Elemento(
                f"{zona['id']}-{nombre}-{i + 1}",
                "madera",
                _viga((*a, za), (*b, zb), viga_a, viga_h),
                props,
            )
        )

    # Correas en la dirección de las filas, en cada borde de fila de módulos.
    u, v, _ = ejes(zona)
    us = [p[0] * u[0] + p[1] * u[1] for p in pts]
    vs = [p[0] * v[0] + p[1] * v[1] for p in pts]
    paso = 2290  # largo inclinado de una fila de módulos verticales (≈ 2269 + separación)
    vv = min(vs)
    k = 0
    while vv <= max(vs) + 1:
        a = np.array(u) * min(us) + np.array(v) * vv
        b = np.array(u) * max(us) + np.array(v) * vv
        za, zb = z_plano(*a) - cor_h / 2, z_plano(*b) - cor_h / 2
        k += 1
        out.append(
            Elemento(
                f"{zona['id']}-correa-{k}", "madera", _viga((*a, za), (*b, zb), cor_a, cor_h), props
            )
        )
        vv += paso
    return out


def muro(datos: dict[str, Any], cubiertas: list[dict[str, Any]]) -> Elemento:
    """Muro sobre un borde de la cubierta, con el espesor hacia afuera de ella."""
    a, b = np.array(datos["de"], float), np.array(datos["a"], float)
    d = (b - a) / np.linalg.norm(b - a)
    n = np.array([-d[1], d[0]])
    medio = (a + b) / 2
    if any(Polygon(c["contorno_mm"]).contains(Point(*(medio + n * 10))) for c in cubiertas):
        n = -n  # el espesor va hacia afuera de las cubiertas
    e = datos["espesor_mm"]
    contorno = [a, b, b + n * e, a + n * e]
    return Elemento(
        "muro-equipos",
        "muro",
        _prisma([list(p) for p in contorno], 0, datos["alto_mm"]),
        {"descripcion": "Muro de los equipos", "es_supuesto": datos.get("es_supuesto", True)},
    )


def _tubo(ruta: list[list[float]], radio: float) -> trimesh.Trimesh:
    piezas = []
    for p0, p1 in zip(ruta[:-1], ruta[1:], strict=True):
        if np.linalg.norm(np.subtract(p1, p0)) > 1:
            piezas.append(trimesh.creation.cylinder(radius=radio, segment=[p0, p1], sections=12))
    return trimesh.util.concatenate(piezas)


def canalizaciones(
    proyecto: dict[str, Any], entrada: dict[str, Any], elems: list[Elemento]
) -> list[Elemento]:
    """Rutas de cableado esquemáticas (borrador): módulos, inversor, batería, tablero, buitrón.

    Todas parten de la esquina de la terraza alta donde está el muro de equipos ("de" del muro).
    DC: de cada zona de módulos al inversor rodeando la esquina; batería: bajo el inversor;
    AC: inversor → tablero FV, y tablero FV → buitrón por encima de los equipos (baja N pisos).
    """
    muro = entrada["muro_equipos"]
    esquina = np.array(muro["de"], float)
    w = np.subtract(muro["a"], muro["de"])
    w = w / np.linalg.norm(w)
    r = math.radians(entrada["rumbo_muro_equipos_deg"] - 90)
    n = np.array([math.sin(r), math.cos(r)])  # hacia afuera del muro
    ub = entrada["ubicaciones"]

    def s_de(p):  # posición a lo largo del muro
        return float(np.dot(np.subtract(p, esquina), w))

    def en_muro(s_mm, z, salida=100):
        q = esquina + w * s_mm + n * salida
        return [float(q[0]), float(q[1]), float(z)]

    por_id = {e.id: e for e in elems}
    inv = por_id.get("inversor-01")
    bat = por_id.get("bateria-01")
    if inv is None:
        return []
    s_inv = s_de(ub["inversor-01"]["punto"])
    z_inv_top, z_inv_bot = float(inv.malla.bounds[1][2]), float(inv.malla.bounds[0][2])
    out = []
    viv = proyecto["vivienda"]
    cubs = {c["id"]: c for c in viv["cubiertas"]}
    for z in viv.get("zonas_instalacion", []):
        cota = cubs[z["cubierta_ref"]]["cota_base_mm"] or 0
        plano = plano_zona(z, cota + (z.get("altura_estructura_mm") or 0))
        v = min(z["contorno_mm"], key=lambda p: np.linalg.norm(np.subtract(p, esquina)))
        if z["estructura"] == "pergola":
            zr = plano(*v) - 450  # bajo las vigas
            hacia = np.subtract(v, esquina)
            hacia = hacia / (np.linalg.norm(hacia) or 1)
            codo = esquina + n * 120 + hacia * 120
            ruta = [
                [v[0], v[1], zr],
                [float(codo[0]), float(codo[1]), zr],
                en_muro(s_inv, zr),
                en_muro(s_inv, z_inv_top),
            ]
        else:
            zr = cota + 60
            borde_in = esquina + w * 250 - n * 150
            ruta = [
                [v[0], v[1], zr],
                [float(borde_in[0]), float(borde_in[1]), zr],
                en_muro(250, zr),
                en_muro(250, z_inv_top + 100),
                en_muro(s_inv - 150, z_inv_top + 100),
                en_muro(s_inv - 150, z_inv_top),
            ]
        out.append(
            Elemento(
                f"ruta-dc-{z['id']}",
                "canalizacion_dc",
                _tubo(ruta, 20),
                {
                    "circuito": "DC",
                    "descripcion": f"Canalización DC desde {z['id']} al inversor",
                    "ruta_mm": ruta,
                    "es_esquematico": True,
                },
            )
        )
    if bat is not None:
        s_bat = s_de(ub["bateria-01"]["punto"])
        z_bat = float(bat.malla.bounds[1][2])
        ruta = [
            en_muro(s_inv - 200, z_inv_bot),
            en_muro(s_inv - 200, z_bat + 60),
            en_muro(s_bat, z_bat + 60),
            en_muro(s_bat, z_bat),
        ]
        out.append(
            Elemento(
                "ruta-dc-bateria",
                "canalizacion_dc",
                _tubo(ruta, 25),
                {
                    "circuito": "DC",
                    "descripcion": "Cable de batería al inversor",
                    "ruta_mm": ruta,
                    "es_esquematico": True,
                },
            )
        )
    tab = ub.get("tablero-fv")
    if tab:
        s_tab = s_de(tab["punto"])
        z_ac = z_inv_top - 120
        ruta = [en_muro(s_inv + 250, z_ac), en_muro(s_tab - 150, z_ac)]
        out.append(
            Elemento(
                "ruta-ac-inversor",
                "canalizacion_ac",
                _tubo(ruta, 25),
                {
                    "circuito": "AC",
                    "descripcion": "AC inversor ↔ tablero FV (red y respaldo)",
                    "ruta_mm": ruta,
                    "es_esquematico": True,
                },
            )
        )
        b = entrada.get("buitron")
        if b:
            s_b = s_de(b["punto"])
            sal_b = float(np.dot(np.subtract(b["punto"], esquina), n))
            z_alto = z_inv_top + 180
            z_tab_top = tab["z_mm"] + entrada.get("tablero_fv", {}).get("alto_mm", 800) / 2
            ruta = [
                en_muro(s_tab, z_tab_top),
                en_muro(s_tab, z_alto),
                en_muro(s_b, z_alto),
                en_muro(s_b, z_alto, sal_b),
                en_muro(s_b, b["alto_mm"], sal_b),
            ]
            out.append(
                Elemento(
                    "ruta-ac-buitron",
                    "canalizacion_ac",
                    _tubo(ruta, 25),
                    {
                        "circuito": "AC",
                        "descripcion": (
                            "AC tablero FV → buitrón; baja "
                            f"{entrada.get('pisos_hasta_tablero_existente', '?')} "
                            "pisos al tablero existente"
                        ),
                        "ruta_mm": ruta,
                        "es_esquematico": True,
                    },
                )
            )
    return out


def buitron(datos: dict[str, Any], rumbo_deg: float) -> Elemento:
    caja = _caja(datos["ancho_mm"], datos["profundidad_mm"], datos["alto_mm"])
    malla = _colocar(caja, (*datos["punto"], datos["z_mm"] + datos["alto_mm"] / 2), rumbo_deg)
    return Elemento(
        "buitron-01",
        "buitron",
        malla,
        {"descripcion": "Buitrón del cableado al tablero existente", "es_supuesto": True},
    )


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
