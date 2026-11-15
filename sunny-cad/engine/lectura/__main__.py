"""Lectura de la vivienda desde fotos y una vista superior (Google Maps).

Uso::

    python -m engine.lectura nuevo <id> --nombre "…" --municipio Cali \
        --departamento "Valle del Cauca" [--lat 3.3 --lon -76.5]
    python -m engine.lectura proponer <id>            # crea proyecto.propuesta.json y la imagen
    python -m engine.lectura proponer <id> --aplicar  # aplica la propuesta si es válida

Flujo (principio de CLAUDE.md): todo cambio se arma primero en una copia, se valida y se
muestra la diferencia; solo se aplica a proyecto.json con --aplicar, tras la aprobación.
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path
from typing import Any

from engine import validar
from engine.lectura import fotos, superposicion, trazado
from engine.pendientes import rutas_pendientes, texto_faltante

PLANTILLA = validar.RAIZ / "templates" / "proyecto.plantilla.json"


def _rel(ruta: Path) -> Path:
    return ruta.relative_to(validar.RAIZ) if ruta.is_relative_to(validar.RAIZ) else ruta


def _escribir(ruta: Path, datos: Any) -> None:
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def nuevo(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    if (carpeta / "proyecto.json").exists():
        print(f"ERROR: ya existe {carpeta / 'proyecto.json'}")
        return 1
    proyecto = validar.cargar_json(PLANTILLA)
    proyecto.update(id=args.id, nombre=args.nombre)
    proyecto["ubicacion"].update(municipio=args.municipio, departamento=args.departamento)
    if args.lat is not None and args.lon is not None:
        proyecto["ubicacion"]["latitud_deg"] = round(args.lat, 2)
        proyecto["ubicacion"]["longitud_deg"] = round(args.lon, 2)
    proyecto["informacion_faltante"] = [texto_faltante(r) for r in rutas_pendientes(proyecto)]

    for sub in ("insumos", "salidas", "privado/fotos"):
        (carpeta / sub).mkdir(parents=True, exist_ok=True)
    _escribir(carpeta / "proyecto.json", proyecto)
    if args.lat is not None and args.lon is not None:
        privados = carpeta / "privado" / "datos_privados.json"
        datos = validar.cargar_json(privados) if privados.exists() else {"version_esquema": "1.1.0"}
        datos["ubicacion_exacta"] = {"latitud_deg": args.lat, "longitud_deg": args.lon}
        _escribir(privados, datos)

    errores = validar.validar_archivo(carpeta / "proyecto.json")
    print(f"Proyecto creado en {_rel(carpeta)}")
    print("Copiar las fotos en privado/fotos/ y la captura de Maps en privado/.")
    _imprimir_pendientes(proyecto)
    return 1 if errores else 0


def _imprimir_pendientes(proyecto: dict[str, Any]) -> None:
    if proyecto["informacion_faltante"]:
        print("\nInformación faltante:")
        for f in proyecto["informacion_faltante"]:
            print(f"  - {f}")


def proponer(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    ruta_proyecto = carpeta / "proyecto.json"
    proyecto = validar.cargar_json(ruta_proyecto)
    propuesta = json.loads(json.dumps(proyecto))

    ruta_lectura = carpeta / "insumos" / "lectura.json"
    lectura = None
    if ruta_lectura.exists():
        lectura = validar.cargar_json(ruta_lectura)
        errores = validar.errores_esquema(lectura, "lectura")
        if errores:
            print("ERROR en insumos/lectura.json:")
            for e in errores:
                print(f"  - {e}")
            return 1
        propuesta = trazado.proponer_proyecto(propuesta, lectura)

    registradas = fotos.insumos_de_fotos(carpeta)
    if registradas:
        otros = [
            i for i in propuesta.get("insumos", []) if not i["archivo"].startswith("privado/fotos/")
        ]
        propuesta["insumos"] = otros + registradas

    errores = validar.validar_proyecto(propuesta, ruta_proyecto)
    _escribir(carpeta / "proyecto.propuesta.json", propuesta)

    if lectura is not None:
        imagen = carpeta / lectura["imagen"]["archivo"]
        if imagen.exists():
            salida = superposicion.generar(
                lectura, imagen, carpeta / "privado" / "verificacion_trazado.png"
            )
            print(f"Imagen de verificación: {_rel(salida)}")
        else:
            print(f"AVISO: no se encontró la imagen {lectura['imagen']['archivo']}")
        print("\nMedidas de los lados (m), para comparar con la obra:")
        for c in propuesta["vivienda"]["cubiertas"]:
            print(f"  {c['id']}: {trazado.medidas_de_lados(c['contorno_mm'])}")

    antes = json.dumps(proyecto, ensure_ascii=False, indent=2).splitlines()
    despues = json.dumps(propuesta, ensure_ascii=False, indent=2).splitlines()
    diferencia = list(
        difflib.unified_diff(antes, despues, "proyecto.json", "propuesta", lineterm="")
    )
    print("\nDiferencia con proyecto.json:")
    print("\n".join(diferencia) if diferencia else "  (sin cambios)")
    _imprimir_pendientes(propuesta)

    if errores:
        print("\nLa propuesta NO es válida:")
        for e in errores:
            print(f"  - {e}")
        return 1
    if args.aplicar:
        _escribir(ruta_proyecto, propuesta)
        (carpeta / "proyecto.propuesta.json").unlink()
        print("\nPropuesta aplicada a proyecto.json.")
    else:
        print("\nPropuesta válida. Revisar y aplicar con --aplicar.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m engine.lectura", description=__doc__.split("\n")[0]
    )
    sub = parser.add_subparsers(dest="orden", required=True)
    p_nuevo = sub.add_parser("nuevo", help="crea la carpeta y el proyecto.json de una vivienda")
    p_nuevo.add_argument("id")
    p_nuevo.add_argument("--nombre", required=True)
    p_nuevo.add_argument("--municipio", required=True)
    p_nuevo.add_argument("--departamento", required=True)
    p_nuevo.add_argument("--lat", type=float)
    p_nuevo.add_argument("--lon", type=float)
    p_nuevo.set_defaults(funcion=nuevo)
    p_prop = sub.add_parser("proponer", help="arma la propuesta desde el trazado y las fotos")
    p_prop.add_argument("id")
    p_prop.add_argument("--aplicar", action="store_true")
    p_prop.set_defaults(funcion=proponer)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
