"""Edición por lenguaje natural con aprobación (Paso 8).

Uso::

    python -m engine.edicion proponer <id> "sube el inversor 20 cm"   # Claude → operaciones
    python -m engine.edicion proponer <id> --operaciones ops.json     # sin IA (operaciones a mano)
    python -m engine.edicion ver <id>                                 # propuesta y diferencia
    python -m engine.edicion aplicar <id> [--regenerar]               # aplica (y rehace 3D, planos)
    python -m engine.edicion descartar <id>
    python -m engine.edicion operaciones                              # lista de operaciones

Nada cambia en proyecto.json ni en los insumos hasta ``aplicar``. La propuesta (archivos
editados, ``cambios.diff`` y ``propuesta.json``) queda en ``projects/<id>/propuestas/edicion/``.
"""

from __future__ import annotations

import argparse
import inspect
import json
import sys
from pathlib import Path

from engine import validar
from engine.edicion import flujo, operaciones


def _proponer(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    if not (carpeta / "proyecto.json").is_file():
        print(f"ERROR: no existe el proyecto {args.id!r}")
        return 1
    explicacion = ""
    if args.operaciones:
        ops = json.loads(Path(args.operaciones).read_text(encoding="utf-8"))
        instruccion = args.instruccion or f"(operaciones de {args.operaciones})"
    elif args.instruccion:
        from engine.edicion import interprete

        instruccion = args.instruccion
        try:
            r = interprete.interpretar(
                instruccion, flujo.cargar_estado(carpeta), validar.cargar_biblioteca()
            )
        except Exception as e:  # credenciales, red o respuesta inválida
            print(f"ERROR al interpretar la instrucción: {e}")
            print("Revise ANTHROPIC_API_KEY, o pase las operaciones con --operaciones.")
            return 1
        ops, explicacion = r["operaciones"], r["explicacion"]
        if r["preguntas"]:
            print("Antes de proponer, hace falta aclarar:")
            for q in r["preguntas"]:
                print(f"  - {q}")
        if not ops:
            print(f"\nSin operaciones. {explicacion}")
            return 2
    else:
        print("ERROR: escriba la instrucción o use --operaciones")
        return 1
    try:
        p = flujo.proponer(args.id, ops, instruccion, explicacion)
    except operaciones.ErrorOperacion as e:
        print(f"ERROR: {e}\nNo se creó ninguna propuesta.")
        return 1
    print(flujo.texto_propuesta(p))
    destino = carpeta / flujo.CARPETA_PROPUESTA
    print(f"\nDiferencia: {destino / 'cambios.diff'}")
    if p["valida"]:
        print(f"Revisar y aplicar con: python -m engine.edicion aplicar {args.id}")
        return 0
    return 1


def _ver(args: argparse.Namespace) -> int:
    p = flujo.leer_propuesta(args.id)
    if p is None:
        print("No hay propuesta de edición pendiente.")
        return 1
    print(flujo.texto_propuesta(p))
    diff = validar.DIR_PROYECTOS / args.id / flujo.CARPETA_PROPUESTA / "cambios.diff"
    print("\n" + diff.read_text(encoding="utf-8"))
    return 0


def _aplicar(args: argparse.Namespace) -> int:
    try:
        p = flujo.aplicar(args.id)
    except operaciones.ErrorOperacion as e:
        print(f"ERROR: {e}")
        return 1
    print("Propuesta aplicada: " + ", ".join(p["archivos"]))
    if args.regenerar:
        from engine.modelo3d.__main__ import main as modelo3d
        from engine.planos.__main__ import main as planos

        modelo3d(["generar", args.id])
        planos(["generar", args.id])
    else:
        print(
            "Para rehacer el modelo 3D, los renders y los planos:\n"
            f"  python -m engine.modelo3d generar {args.id} --render\n"
            f"  python -m engine.planos generar {args.id}"
        )
    return 0


def _descartar(args: argparse.Namespace) -> int:
    print("Propuesta descartada." if flujo.descartar(args.id) else "No había propuesta.")
    return 0


def _operaciones(_args: argparse.Namespace) -> int:
    for nombre, f in operaciones.OPERACIONES.items():
        params = [p for p in inspect.signature(f).parameters if p not in ("estado", "biblioteca")]
        print(f"{nombre}({', '.join(params)})\n    {(f.__doc__ or '').strip().splitlines()[0]}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.edicion")
    sub = parser.add_subparsers(dest="orden", required=True)
    p = sub.add_parser("proponer")
    p.add_argument("id")
    p.add_argument("instruccion", nargs="?")
    p.add_argument("--operaciones", help="JSON con la lista de operaciones (sin IA)")
    p.set_defaults(funcion=_proponer)
    for nombre, f in (("ver", _ver), ("descartar", _descartar)):
        q = sub.add_parser(nombre)
        q.add_argument("id")
        q.set_defaults(funcion=f)
    q = sub.add_parser("aplicar")
    q.add_argument("id")
    q.add_argument("--regenerar", action="store_true", help="rehace modelo 3D y planos")
    q.set_defaults(funcion=_aplicar)
    sub.add_parser("operaciones").set_defaults(funcion=_operaciones)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
