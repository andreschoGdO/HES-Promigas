"""Flujo de edición con aprobación (Paso 8).

1. ``proponer``: aplica las operaciones a una COPIA de proyecto.json e insumos, recalcula la
   distribución (si cambió una zona) y la parte eléctrica, valida y guarda todo en
   ``projects/<id>/propuestas/edicion/`` con la diferencia (``cambios.diff``) y un resumen.
2. El usuario revisa la diferencia.
3. ``aplicar``: copia la propuesta encima de los archivos reales (solo si es válida), escribe
   las salidas eléctricas y deja constancia en ``historial_ediciones.json``.
   ``descartar`` borra la propuesta sin tocar nada.
"""

from __future__ import annotations

import copy
import datetime as dt
import difflib
import shutil
from pathlib import Path
from typing import Any

from engine import jsonfmt, validar
from engine.edicion import operaciones
from engine.pendientes import rutas_pendientes, texto_faltante

CARPETA_PROPUESTA = Path("propuestas") / "edicion"
INSUMOS = {"electrico": "electrico.json", "zonas": "zonas.json"}


def _rutas(carpeta: Path) -> dict[str, Path]:
    return {
        "proyecto": carpeta / "proyecto.json",
        **{k: carpeta / "insumos" / v for k, v in INSUMOS.items()},
    }


def cargar_estado(carpeta: Path) -> dict[str, Any]:
    return {
        k: (validar.cargar_json(r) if r.is_file() else None) for k, r in _rutas(carpeta).items()
    }


def _redistribuir(estado: dict[str, Any], biblioteca) -> None:
    from engine.distribucion import colocacion

    proyecto = estado["proyecto"]
    refs = [e["componente_ref"] for e in proyecto["equipos"] if e["tipo"] == "modulo"]
    if not refs:
        raise operaciones.ErrorOperacion("no hay módulos para saber qué referencia redistribuir")
    nuevos, _ = colocacion.equipos_modulos(estado["zonas"], biblioteca[refs[0]])
    proyecto["vivienda"]["zonas_instalacion"] = copy.deepcopy(estado["zonas"])
    proyecto["equipos"] = [e for e in proyecto["equipos"] if e["tipo"] != "modulo"] + nuevos
    proyecto["informacion_faltante"] = [
        f for f in proyecto["informacion_faltante"] if not f.startswith("zona-")
    ] + [texto_faltante(r) for r in rutas_pendientes(proyecto) if r.startswith("zona-")]


def recalcular(
    estado: dict[str, Any], biblioteca, criterios
) -> tuple[dict[str, Any] | None, list[str], list[str]]:
    """Corre los motores sobre el estado editado → (resultado eléctrico, avisos, errores)."""
    from engine.electrico.__main__ import calcular

    avisos: list[str] = []
    rec = estado.get("_recalcular", set())
    if "distribucion" in rec:
        _redistribuir(estado, biblioteca)
    quitar = estado.get("_quitar_modulos") or set()
    if quitar:
        p = estado["proyecto"]
        faltan = quitar - {e["id"] for e in p["equipos"]}
        if faltan:
            raise operaciones.ErrorOperacion(
                f"tras redistribuir ya no existen: {', '.join(sorted(faltan))}; "
                "pide quitar módulos en una edición aparte"
            )
        p["equipos"] = [e for e in p["equipos"] if e["id"] not in quitar]
    entrada = estado.get("electrico")
    if entrada is None or "electrico" not in rec:
        return None, avisos, []
    n_mod = sum(1 for e in estado["proyecto"]["equipos"] if e["tipo"] == "modulo")
    fijos = entrada.get("strings")
    if fijos and sum(fijos) != n_mod:
        avisos.append(
            f"los strings fijados {fijos} suman {sum(fijos)} módulos y ahora hay {n_mod}: "
            "el motor eléctrico elige los strings"
        )
        entrada["strings"] = None
    try:
        calc = calcular(estado["proyecto"], entrada, biblioteca, criterios)
    except ValueError as e:
        return None, avisos, [f"cálculo eléctrico: {e}"]
    estado["proyecto"] = calc["propuesta"]
    return calc["resultado"], avisos, list(calc["resultado"]["errores"])


def _diff(antes: Any, despues: Any, nombre: str) -> str:
    a = jsonfmt.dumps(antes).splitlines(keepends=True) if antes is not None else []
    b = jsonfmt.dumps(despues).splitlines(keepends=True) if despues is not None else []
    return "".join(difflib.unified_diff(a, b, f"a/{nombre}", f"b/{nombre}", n=2))


def _resumen_sistema(proyecto: dict[str, Any], biblioteca, r: dict[str, Any] | None) -> dict:
    mods = [e for e in proyecto["equipos"] if e["tipo"] == "modulo"]
    kwp = (
        len(mods) * biblioteca[mods[0]["componente_ref"]]["electrico"]["potencia_stc_w"] / 1000
        if mods
        else 0
    )
    eq = {e["tipo"]: e for e in proyecto["equipos"] if e["tipo"] != "modulo"}
    out = {
        "modulos": len(mods),
        "potencia_kwp": round(kwp, 2),
        "inversor": eq.get("inversor", {}).get("componente_ref"),
        "bateria": (
            f"{eq['bateria']['componente_ref']} {eq['bateria'].get('configuracion')}"
            if "bateria" in eq
            else None
        ),
    }
    if r:
        out["strings"] = [s["modulos"] for s in r["strings"]]
    return out


def proponer(
    proyecto_id: str, ops: list[dict[str, Any]], instruccion: str = "", explicacion: str = ""
) -> dict[str, Any]:
    """Crea la propuesta de edición. No toca los archivos reales."""
    from engine.electrico.__main__ import CRITERIOS

    carpeta = validar.DIR_PROYECTOS / proyecto_id
    if not (carpeta / "proyecto.json").is_file():
        raise operaciones.ErrorOperacion(f"no existe el proyecto {proyecto_id!r}")
    biblioteca = validar.cargar_biblioteca()
    original = cargar_estado(carpeta)
    estado = copy.deepcopy(original)
    resumen = operaciones.aplicar(estado, ops, biblioteca)
    resultado, avisos, errores = recalcular(estado, biblioteca, validar.cargar_json(CRITERIOS))
    errores = (
        validar.validar_proyecto(estado["proyecto"], carpeta / "proyecto.json", biblioteca)
        + errores
    )

    ruta_calc = carpeta / "salidas" / "calculo_electrico.json"
    calc_antes = validar.cargar_json(ruta_calc) if ruta_calc.is_file() else None
    destino = carpeta / CARPETA_PROPUESTA
    if destino.exists():
        shutil.rmtree(destino)
    (destino / "insumos").mkdir(parents=True)
    diffs = []
    cambiados = []
    for k, ruta in _rutas(carpeta).items():
        if estado.get(k) is None or estado[k] == original[k]:
            continue
        rel = ruta.relative_to(carpeta)
        (destino / rel).write_text(jsonfmt.dumps(estado[k]), encoding="utf-8")
        diffs.append(_diff(original[k], estado[k], str(rel)))
        cambiados.append(str(rel))
    if resultado is not None:
        (destino / "calculo_electrico.json").write_text(jsonfmt.dumps(resultado), encoding="utf-8")
    (destino / "cambios.diff").write_text("".join(diffs), encoding="utf-8")
    propuesta = {
        "proyecto": proyecto_id,
        "fecha": dt.datetime.now().isoformat(timespec="seconds"),
        "instruccion": instruccion,
        "explicacion": explicacion,
        "operaciones": ops,
        "resumen": resumen,
        "avisos": avisos,
        "errores": errores,
        "valida": not errores,
        "archivos": cambiados,
        "sistema_antes": _resumen_sistema(original["proyecto"], biblioteca, calc_antes),
        "sistema_despues": _resumen_sistema(estado["proyecto"], biblioteca, resultado),
    }
    (destino / "propuesta.json").write_text(jsonfmt.dumps(propuesta), encoding="utf-8")
    return propuesta


def leer_propuesta(proyecto_id: str) -> dict[str, Any] | None:
    ruta = validar.DIR_PROYECTOS / proyecto_id / CARPETA_PROPUESTA / "propuesta.json"
    return validar.cargar_json(ruta) if ruta.is_file() else None


def aplicar(proyecto_id: str) -> dict[str, Any]:
    """Aplica la propuesta pendiente (solo si es válida) y la registra en el historial."""
    from engine.electrico.__main__ import memoria

    carpeta = validar.DIR_PROYECTOS / proyecto_id
    origen = carpeta / CARPETA_PROPUESTA
    propuesta = leer_propuesta(proyecto_id)
    if propuesta is None:
        raise operaciones.ErrorOperacion("no hay una propuesta de edición pendiente")
    if not propuesta["valida"]:
        raise operaciones.ErrorOperacion(
            "la propuesta no es válida y no se aplica: " + "; ".join(propuesta["errores"])
        )
    for rel in propuesta["archivos"]:
        shutil.copyfile(origen / rel, carpeta / rel)
    calc = origen / "calculo_electrico.json"
    if calc.is_file():
        (carpeta / "salidas").mkdir(exist_ok=True)
        shutil.copyfile(calc, carpeta / "salidas" / "calculo_electrico.json")
        proyecto = validar.cargar_json(carpeta / "proyecto.json")
        entrada = validar.cargar_json(carpeta / "insumos" / "electrico.json")
        (carpeta / "salidas" / "memoria_electrica.md").write_text(
            memoria(proyecto, validar.cargar_json(calc), validar.cargar_biblioteca(), entrada),
            encoding="utf-8",
        )
    historial = carpeta / "historial_ediciones.json"
    registros = validar.cargar_json(historial) if historial.is_file() else []
    registros.append(
        {k: propuesta[k] for k in ("fecha", "instruccion", "operaciones", "resumen", "archivos")}
        | {"aplicada": dt.datetime.now().isoformat(timespec="seconds")}
    )
    historial.write_text(jsonfmt.dumps(registros), encoding="utf-8")
    shutil.rmtree(origen)
    if not any((carpeta / "propuestas").iterdir()):
        (carpeta / "propuestas").rmdir()
    return propuesta


def descartar(proyecto_id: str) -> bool:
    carpeta = validar.DIR_PROYECTOS / proyecto_id
    origen = carpeta / CARPETA_PROPUESTA
    if not origen.exists():
        return False
    shutil.rmtree(origen)
    if not any((carpeta / "propuestas").iterdir()):
        (carpeta / "propuestas").rmdir()
    return True


def texto_propuesta(p: dict[str, Any]) -> str:
    """Resumen legible de la propuesta (para la consola y para la futura interfaz)."""
    lineas = []
    if p.get("instruccion"):
        lineas.append(f"Instrucción: {p['instruccion']}")
    if p.get("explicacion"):
        lineas.append(f"Interpretación: {p['explicacion']}")
    lineas.append("Operaciones:")
    lineas += [f"  {i}. {r}" for i, r in enumerate(p["resumen"], 1)]
    a, d = p["sistema_antes"], p["sistema_despues"]
    cambios = [f"  {k}: {a.get(k)} → {d.get(k)}" for k in d if a.get(k) != d.get(k)]
    if cambios:
        lineas.append("Sistema:")
        lineas += cambios
    lineas += [f"AVISO: {x}" for x in p["avisos"]]
    lineas.append("Archivos que cambian: " + (", ".join(p["archivos"]) or "ninguno"))
    if p["errores"]:
        lineas.append("La propuesta NO es válida:")
        lineas += [f"  - {e}" for e in p["errores"]]
    return "\n".join(lineas)


__all__ = ["proponer", "aplicar", "descartar", "leer_propuesta", "texto_propuesta"]
