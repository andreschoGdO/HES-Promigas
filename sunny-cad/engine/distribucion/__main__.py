"""Distribución de módulos (Paso 4).

Uso::

    python -m engine.distribucion proponer <id> --modulo ja-solar-jam72d40-595-mb
    python -m engine.distribucion proponer <id> --modulo … --aplicar

Lee las zonas de ``insumos/zonas.json`` (lista de zonas, esquema ``zona_instalacion`` de
proyecto.schema.json), coloca los módulos, valida, dibuja ``salidas/verificacion_distribucion.png``
y muestra un resumen. Solo modifica proyecto.json con --aplicar.
"""

from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path

from shapely.geometry import Polygon

from engine import jsonfmt, validar
from engine.distribucion import colocacion, dibujo
from engine.pendientes import rutas_pendientes, texto_faltante


def _rel(ruta: Path) -> Path:
    return ruta.relative_to(validar.RAIZ) if ruta.is_relative_to(validar.RAIZ) else ruta


def proponer(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    ruta_proyecto = carpeta / "proyecto.json"
    proyecto = validar.cargar_json(ruta_proyecto)
    biblioteca = validar.cargar_biblioteca()
    modulo = biblioteca.get(args.modulo)
    if modulo is None or modulo["tipo"] != "modulo":
        print(f"ERROR: '{args.modulo}' no es un módulo de la biblioteca")
        return 1
    if modulo["es_ejemplo"] and not proyecto["es_ejemplo"]:
        print("ERROR: un proyecto real no puede usar un módulo de ejemplo")
        return 1
    zonas = validar.cargar_json(carpeta / "insumos" / "zonas.json")

    propuesta = copy.deepcopy(proyecto)
    propuesta["vivienda"]["zonas_instalacion"] = zonas
    nuevos, por_zona = colocacion.equipos_modulos(zonas, modulo)
    otros = [e for e in propuesta["equipos"] if e["tipo"] != "modulo"]
    propuesta["equipos"] = otros + nuevos

    propuesta["informacion_faltante"] = [
        f for f in propuesta["informacion_faltante"] if not f.startswith("zona-")
    ] + [texto_faltante(r) for r in rutas_pendientes(propuesta) if r.startswith("zona-")]

    errores = validar.validar_proyecto(propuesta, ruta_proyecto, biblioteca)
    (carpeta / "proyecto.propuesta.json").write_text(jsonfmt.dumps(propuesta), encoding="utf-8")

    potencia = modulo["electrico"]["potencia_stc_w"]
    total = len(nuevos)
    print(f"Módulo: {modulo['modelo']} ({potencia} W)\n")
    print(f"{'zona':10}{'área m²':>9}{'módulos':>9}{'kWp':>8}  estructura / orientación")
    for z in zonas:
        area = Polygon(z["contorno_mm"]).area / 1e6
        n = por_zona[z["id"]]
        marca = "  ← SUPUESTO" if z["es_supuesto"] else ""
        print(
            f"{z['id']:10}{area:9.1f}{n:9d}{n * potencia / 1000:8.2f}  {z['estructura']}, "
            f"{z['inclinacion_deg']}° hacia {z['azimut_deg']}°, {z['orientacion_modulo']}{marca}"
        )
    print(f"{'TOTAL':10}{'':9}{total:9d}{total * potencia / 1000:8.2f}")
    antes = sum(1 for e in proyecto["equipos"] if e["tipo"] == "modulo")
    print(f"\nMódulos en proyecto.json: {antes} → propuesta: {total}")

    titulo = (
        f"{proyecto['nombre']}: {total} x {modulo['modelo']} = {total * potencia / 1000:.2f} kWp"
    )
    salida = dibujo.generar(
        propuesta, biblioteca, carpeta / "salidas" / "verificacion_distribucion.png", titulo=titulo
    )
    print(f"Planta de verificación: {_rel(salida)}")

    if errores:
        print("\nLa propuesta NO es válida:")
        for e in errores:
            print(f"  - {e}")
        return 1
    if args.aplicar:
        ruta_proyecto.write_text(jsonfmt.dumps(propuesta), encoding="utf-8")
        (carpeta / "proyecto.propuesta.json").unlink()
        print("\nPropuesta aplicada a proyecto.json.")
    else:
        print("\nPropuesta válida. Revisar y aplicar con --aplicar.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.distribucion")
    sub = parser.add_subparsers(dest="orden", required=True)
    p = sub.add_parser("proponer", help="distribuye los módulos en las zonas de insumos/zonas.json")
    p.add_argument("id")
    p.add_argument("--modulo", required=True, help="id del módulo en la biblioteca")
    p.add_argument("--aplicar", action="store_true")
    p.set_defaults(funcion=proponer)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
