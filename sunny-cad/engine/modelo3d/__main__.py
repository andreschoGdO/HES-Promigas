"""Modelo 3D, visor y renders (Paso 6).

Uso::

    python -m engine.modelo3d generar <id>            # IFC + glTF + visor HTML
    python -m engine.modelo3d generar <id> --render   # además renders con Blender

Todo se genera desde proyecto.json y la biblioteca; los archivos de salidas/ nunca se editan
a mano (principio de CLAUDE.md).
"""

from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from shapely.geometry import Point, Polygon

from engine import validar
from engine.modelo3d import geometria, ifc

PLANTILLA_VISOR = Path(__file__).with_name("visor.html")


def _rel(ruta: Path) -> Path:
    return ruta.relative_to(validar.RAIZ) if ruta.is_relative_to(validar.RAIZ) else ruta


def vistas(
    elems: list[geometria.Elemento],
    entrada: dict[str, Any] | None,
    proyecto: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Cámaras en metros (X este, Y norte, Z arriba)."""
    modulos = [e for e in elems if e.tipo == "modulo"]
    todo = np.vstack([e.malla.bounds for e in elems]) / 1000
    centro = (todo.min(axis=0) + todo.max(axis=0)) / 2
    radio = float(np.linalg.norm(todo.max(axis=0) - todo.min(axis=0)))
    c_mod = np.vstack([e.malla.bounds for e in modulos]).mean(axis=0) / 1000 if modulos else centro
    out = [
        {
            "nombre": "aerea_sur",
            "camara": [centro[0] + 0.15 * radio, centro[1] - 0.9 * radio, centro[2] + 0.8 * radio],
            "objetivo": list(c_mod),
            "lente_mm": 40,
        },
        {
            "nombre": "aerea_oeste",
            "camara": [centro[0] - 0.9 * radio, centro[1] + 0.1 * radio, centro[2] + 0.6 * radio],
            "objetivo": list(c_mod),
            "lente_mm": 40,
        },
    ]
    equipos = [e for e in elems if e.tipo in ("inversor", "bateria", "tablero")]  # sin el buitrón
    if equipos and entrada:
        b = np.vstack([e.malla.bounds for e in equipos]) / 1000
        obj = (b.min(axis=0) + b.max(axis=0)) / 2
        r = np.radians(entrada["rumbo_muro_equipos_deg"] - 90)  # hacia afuera del muro
        frente = np.array([np.sin(r), np.cos(r), 0])
        r2 = np.radians(entrada["rumbo_muro_equipos_deg"] + 180)  # hacia la esquina (derecha)
        derecha = np.array([np.sin(r2), np.cos(r2), 0])
        out.append(
            {
                "nombre": "equipos",
                "camara": list(obj + 3.4 * frente + 0.3 * derecha + [0, 0, 0.6]),
                "objetivo": list(obj + 0.2 * derecha),
                "lente_mm": 24,
            }
        )
    # Vista superior ortográfica (planta fotográfica) e isométrica desde el suroeste
    extension = float(max(todo.max(axis=0)[:2] - todo.min(axis=0)[:2]))
    out.append(
        {
            "nombre": "superior",
            "camara": [centro[0], centro[1] + 0.01, centro[2] + 60],
            "objetivo": list(centro),
            "ortho_m": extension * 1.12,
        }
    )
    out.append(
        {
            "nombre": "isometrica",
            "camara": list(centro + np.array([-0.42, -0.42, 0.36]) * radio),
            "objetivo": list(c_mod),
            "lente_mm": 35,
        }
    )
    rutas = [e for e in elems if e.tipo.startswith("canalizacion")]
    if rutas and equipos and entrada:
        b = np.vstack([e.malla.bounds for e in rutas + equipos]) / 1000
        obj = (b.min(axis=0) + b.max(axis=0)) / 2
        ext = float(max(b.max(axis=0)[:2] - b.min(axis=0)[:2]))
        r = np.radians(entrada["rumbo_muro_equipos_deg"] - 90)
        frente = np.array([np.sin(r), np.cos(r), 0])
        r2 = np.radians(entrada["rumbo_muro_equipos_deg"] + 180)
        derecha = np.array([np.sin(r2), np.cos(r2), 0])
        out.append(
            {
                "nombre": "cableado",
                # Plano medio elevado que encuadre todo el recorrido (crece con su extensión)
                "camara": list(
                    obj
                    + (0.75 * ext + 2.2) * frente
                    + (0.35 * ext + 1.2) * derecha
                    + [0, 0, 0.55 * ext + 2.0]
                ),
                "objetivo": list(obj),
                "lente_mm": 26,
            }
        )
    amb = ambientacion(proyecto) if proyecto else None
    if amb and equipos:
        amb["evitar"] = [[float(v) for v in e.malla.centroid[:2] / 1000] for e in equipos]
    if amb:
        c = np.array(amb["centro"])
        ux, uy = np.array([*amb["ux"], 0]), np.array([*amb["uy"], 0])
        medio = c + uy * amb["fondo_m"] / 2
        out.append(
            {
                "nombre": "terraza",
                "camara": list(medio + uy * (amb["fondo_m"] / 2 + 5.0) - ux * 1.2 + [0, 0, 1.6]),
                "objetivo": list(medio + [0, 0, 0.9]),
                "lente_mm": 24,
            }
        )
    vs = [
        {
            **v,
            "camara": [float(x) for x in v["camara"]],
            "objetivo": [float(x) for x in v["objetivo"]],
        }
        for v in out
    ]
    return {"vistas": vs, "ambientacion": amb}


def ambientacion(proyecto: dict[str, Any]) -> dict[str, Any] | None:
    """Marco de la pérgola para amoblarla en el render (centro del lado del muro, ejes, medidas)."""
    viv = proyecto["vivienda"]
    zona = next((z for z in viv.get("zonas_instalacion", []) if z["estructura"] == "pergola"), None)
    if zona is None:
        return None
    cubs = {c["id"]: c for c in viv["cubiertas"]}
    cota = cubs[zona["cubierta_ref"]]["cota_base_mm"] or 0
    muros = [Polygon(c["contorno_mm"]) for c in viv["cubiertas"] if (c["cota_base_mm"] or 0) > cota]
    pts = [np.array(p, float) for p in zona["contorno_mm"]]
    n = len(pts)
    lado = next(
        (
            i
            for i in range(n)
            if any(m.exterior.distance(Point(*(pts[i] + pts[(i + 1) % n]) / 2)) < 50 for m in muros)
        ),
        None,
    )
    if lado is None:
        return None
    a, b = pts[lado], pts[(lado + 1) % n]
    ux = (b - a) / np.linalg.norm(b - a)
    centro_lado = (a + b) / 2
    centroide = np.mean(pts, axis=0)
    uy = np.array([-ux[1], ux[0]])
    if np.dot(centroide - centro_lado, uy) < 0:
        uy = -uy
    fondo = max(np.dot(p - centro_lado, uy) for p in pts)
    z_plano = geometria.plano_zona(zona, cota + (zona.get("altura_estructura_mm") or 0))
    z_min = min(z_plano(*p) for p in pts)
    return {
        "centro": [float(v) for v in (*(centro_lado / 1000), cota / 1000)],
        "ux": [float(v) for v in ux],
        "uy": [float(v) for v in uy],
        "largo_m": float(np.linalg.norm(b - a) / 1000),
        "fondo_m": float(fondo / 1000),
        "z_luces_m": float((z_min - 450) / 1000),
    }


def generar(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    proyecto = validar.cargar_json(carpeta / "proyecto.json")
    errores = validar.validar_proyecto(proyecto, carpeta / "proyecto.json")
    if errores:
        print("ERROR: el proyecto no es válido; corregirlo antes de generar el modelo:")
        for e in errores:
            print(f"  - {e}")
        return 1
    biblioteca = validar.cargar_biblioteca()
    ruta_e = carpeta / "insumos" / "electrico.json"
    entrada = validar.cargar_json(ruta_e) if ruta_e.exists() else None
    elems = geometria.elementos(proyecto, biblioteca, entrada)
    salidas = carpeta / "salidas"
    salidas.mkdir(exist_ok=True)

    ruta_ifc = ifc.exportar(proyecto, elems, salidas / "modelo.ifc")
    ruta_glb = salidas / "modelo.glb"
    geometria.escena(elems).export(ruta_glb)
    datos = base64.b64encode(ruta_glb.read_bytes()).decode()
    titulo = f"{proyecto['nombre']} — modelo 3D (borrador)"
    html = (
        PLANTILLA_VISOR.read_text(encoding="utf-8")
        .replace("__TITULO__", titulo)
        .replace("__GLB_BASE64__", datos)
    )
    ruta_html = salidas / "visor_3d.html"
    ruta_html.write_text(html, encoding="utf-8")
    from collections import Counter

    print(f"Elementos: {dict(Counter(e.tipo for e in elems))}")
    for r in (ruta_ifc, ruta_glb, ruta_html):
        print(f"  {_rel(r)} ({r.stat().st_size / 1024:.0f} kB)")

    if args.render:
        blender = shutil.which("blender")
        if not blender:
            print("AVISO: Blender no está instalado; no se generan renders.")
            return 0
        with tempfile.TemporaryDirectory() as tmp:
            ruta_vistas = Path(tmp) / "vistas.json"
            ruta_vistas.write_text(json.dumps(vistas(elems, entrada, proyecto)))
            script = Path(__file__).with_name("render_blender.py")
            r = subprocess.run(
                [
                    blender,
                    "-b",
                    "--factory-startup",
                    "--python",
                    str(script),
                    "--",
                    str(ruta_glb),
                    str(ruta_vistas),
                    str(salidas),
                    *map(str, args.resolucion),
                    str(args.muestras),
                ],
                capture_output=True,
                text=True,
            )
            if r.returncode != 0 or "Error" in r.stderr:
                print(r.stdout[-2000:], r.stderr[-2000:])
                return 1
        for png in sorted(salidas.glob("render_*.png")):
            print(f"  {_rel(png)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.modelo3d")
    sub = parser.add_subparsers(dest="orden", required=True)
    p = sub.add_parser("generar")
    p.add_argument("id")
    p.add_argument("--render", action="store_true")
    p.add_argument("--resolucion", type=int, nargs=2, default=(2400, 1500))
    p.add_argument("--muestras", type=int, default=32)
    p.set_defaults(funcion=generar)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
