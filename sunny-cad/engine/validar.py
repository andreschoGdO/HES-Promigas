"""Validación de los contratos de datos de sunny-cad.

Valida los componentes de ``library/`` y los proyectos de ``projects/`` contra sus
esquemas JSON y aplica comprobaciones que JSON Schema no puede expresar:

- el ``id`` coincide con el nombre del archivo (componentes) o de la carpeta (proyectos);
- cada ``componente_ref`` existe en la biblioteca y su ``tipo`` coincide;
- los ``id`` de equipos y cubiertas no se repiten;
- los contornos son polígonos válidos y los obstáculos quedan dentro de su cubierta;
- un proyecto real (``es_ejemplo: false``) no usa componentes de ejemplo;
- cada batería indica una configuración (número de módulos) que existe en su ficha;
- la tipología (T1/T2) corresponde a las fases del inversor;
- cada batería es compatible con el inversor según las fichas;
- los datos de cada componente son coherentes (``engine.biblioteca``);
- si existe ``projects/<vivienda>/privado/datos_privados.json``, cumple su esquema.

Uso::

    python -m engine.validar            # valida todo library/ y projects/
    python -m engine.validar RUTA ...   # valida solo los archivos indicados
"""

from __future__ import annotations

import json
import sys
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from shapely.geometry import Polygon

from engine.biblioteca import (
    FASES_POR_TIPOLOGIA,
    coherencia_componente,
    compatibilidad_inversor_bateria,
)
from engine.pendientes import errores_pendientes, errores_privacidad

RAIZ = Path(__file__).resolve().parent.parent
DIR_ESQUEMAS = RAIZ / "engine" / "esquemas"
DIR_BIBLIOTECA = RAIZ / "library"
DIR_PROYECTOS = RAIZ / "projects"


def cargar_json(ruta: Path) -> Any:
    with ruta.open(encoding="utf-8") as f:
        return json.load(f)


@cache
def validador(nombre_esquema: str) -> Draft202012Validator:
    esquema = cargar_json(DIR_ESQUEMAS / f"{nombre_esquema}.schema.json")
    Draft202012Validator.check_schema(esquema)
    return Draft202012Validator(esquema)


def errores_esquema(datos: Any, nombre_esquema: str) -> list[str]:
    errores = sorted(validador(nombre_esquema).iter_errors(datos), key=lambda e: list(e.path))
    return [f"{'/'.join(map(str, e.path)) or '(raiz)'}: {e.message}" for e in errores]


def cargar_biblioteca(dir_biblioteca: Path = DIR_BIBLIOTECA) -> dict[str, dict[str, Any]]:
    """Devuelve {id: componente} con todos los JSON de la biblioteca."""
    return {
        datos["id"]: datos
        for ruta in sorted(dir_biblioteca.rglob("*.json"))
        if isinstance(datos := cargar_json(ruta), dict) and "id" in datos
    }


def validar_componente(datos: Any, ruta: Path | None = None) -> list[str]:
    errores = errores_esquema(datos, "componente")
    if errores:
        return errores
    errores += coherencia_componente(datos, RAIZ)
    if ruta is not None and isinstance(datos, dict) and datos.get("id") != ruta.stem:
        errores.append(f"id: '{datos.get('id')}' no coincide con el archivo '{ruta.name}'")
    return errores


def _errores_contorno(puntos: list[list[float]], donde: str) -> tuple[Polygon | None, list[str]]:
    poligono = Polygon(puntos)
    if not poligono.is_valid or poligono.area <= 0:
        return None, [f"{donde}: el contorno no es un polígono válido (cruzado o sin área)"]
    return poligono, []


def validar_proyecto(
    datos: Any,
    ruta: Path | None = None,
    biblioteca: dict[str, dict[str, Any]] | None = None,
) -> list[str]:
    errores = errores_esquema(datos, "proyecto")
    if errores:
        # Las comprobaciones siguientes suponen que la estructura es correcta.
        return errores

    errores += errores_pendientes(datos)
    errores += errores_privacidad(datos)

    if ruta is not None and datos["id"] != ruta.parent.name:
        errores.append(f"id: '{datos['id']}' no coincide con la carpeta '{ruta.parent.name}'")

    # Geometría de cubiertas y obstáculos.
    ids_cubiertas: set[str] = set()
    for i, cubierta in enumerate(datos["vivienda"]["cubiertas"]):
        donde = f"vivienda/cubiertas/{i}"
        if cubierta["id"] in ids_cubiertas:
            errores.append(f"{donde}/id: '{cubierta['id']}' repetido")
        ids_cubiertas.add(cubierta["id"])
        poligono, errs = _errores_contorno(cubierta["contorno_mm"], f"{donde}/contorno_mm")
        errores += errs
        for j, obstaculo in enumerate(cubierta["obstaculos"]):
            donde_obs = f"{donde}/obstaculos/{j}/contorno_mm"
            poligono_obs, errs = _errores_contorno(obstaculo["contorno_mm"], donde_obs)
            errores += errs
            if poligono and poligono_obs and not poligono.covers(poligono_obs):
                errores.append(f"{donde_obs}: el obstáculo se sale de la cubierta")

    # Equipos y referencias a la biblioteca.
    if biblioteca is None:
        biblioteca = cargar_biblioteca()
    ids_equipos: set[str] = set()
    for i, equipo in enumerate(datos["equipos"]):
        donde = f"equipos/{i}"
        if equipo["id"] in ids_equipos:
            errores.append(f"{donde}/id: '{equipo['id']}' repetido")
        ids_equipos.add(equipo["id"])
        componente = biblioteca.get(equipo["componente_ref"])
        if componente is None:
            errores.append(
                f"{donde}/componente_ref: '{equipo['componente_ref']}' no existe en library/"
            )
            continue
        if componente.get("tipo") != equipo["tipo"]:
            errores.append(
                f"{donde}/tipo: '{equipo['tipo']}' no coincide con el componente "
                f"'{componente['id']}' (tipo '{componente.get('tipo')}')"
            )
        if not datos["es_ejemplo"] and componente.get("es_ejemplo", False):
            errores.append(
                f"{donde}/componente_ref: un proyecto real no puede usar el componente "
                f"de ejemplo '{componente['id']}'"
            )
        errores += _errores_configuracion(equipo, componente, donde)
    if not errores:
        errores += _errores_sistema(datos, biblioteca)
        errores += _errores_distribucion(datos, biblioteca)
    return errores


def _errores_distribucion(
    datos: dict[str, Any], biblioteca: dict[str, dict[str, Any]]
) -> list[str]:
    """Zonas dentro de su cubierta; módulos dentro de su zona y sin traslaparse."""
    from engine.distribucion.colocacion import huella_poligono

    errores: list[str] = []
    cubiertas = {c["id"]: Polygon(c["contorno_mm"]) for c in datos["vivienda"]["cubiertas"]}
    zonas = {z["id"]: z for z in datos["vivienda"].get("zonas_instalacion", [])}
    for zid, z in zonas.items():
        cub = cubiertas.get(z["cubierta_ref"])
        if cub is None:
            errores.append(f"{zid}/cubierta_ref: '{z['cubierta_ref']}' no existe")
        elif not cub.buffer(1).covers(Polygon(z["contorno_mm"])):
            errores.append(f"{zid}: la zona se sale de {z['cubierta_ref']}")
    huellas = []
    for e in datos["equipos"]:
        col = e.get("colocacion")
        if col is None:
            continue
        if e["tipo"] != "modulo":
            errores.append(f"{e['id']}/colocacion: solo aplica a módulos")
            continue
        zona = zonas.get(col["zona_ref"])
        if zona is None:
            errores.append(f"{e['id']}/colocacion: la zona '{col['zona_ref']}' no existe")
            continue
        huella = Polygon(
            huella_poligono(tuple(col["centro_mm"]), zona, biblioteca[e["componente_ref"]])
        )
        if not Polygon(zona["contorno_mm"]).buffer(2).covers(huella):
            errores.append(f"{e['id']}: se sale de {zona['id']}")
        huellas.append((e["id"], huella))
    for i, (id_a, a) in enumerate(huellas):
        for id_b, b in huellas[i + 1 :]:
            if a.intersection(b).area > 100:  # > 1 cm² (redondeo de centros a mm)
                errores.append(f"{id_a} y {id_b} se traslapan")
    return errores


def _errores_sistema(datos: dict[str, Any], biblioteca: dict[str, dict[str, Any]]) -> list[str]:
    """Reglas entre equipos: tipología vs fases del inversor y compatibilidad inversor-batería."""
    errores: list[str] = []
    tipologia = datos["sistema"]["tipologia"]  # None = pendiente: no se revisan las fases
    inversores = [
        (e, biblioteca[e["componente_ref"]]) for e in datos["equipos"] if e["tipo"] == "inversor"
    ]
    baterias = [
        (e, biblioteca[e["componente_ref"]]) for e in datos["equipos"] if e["tipo"] == "bateria"
    ]
    for equipo, inversor in inversores:
        fases = inversor["electrico"]["fases"]
        if tipologia is not None and fases not in FASES_POR_TIPOLOGIA[tipologia]:
            errores.append(
                f"{equipo['id']}: un inversor {fases} no corresponde a la tipología {tipologia}"
            )
        for equipo_bat, bateria in baterias:
            for problema in compatibilidad_inversor_bateria(
                inversor, bateria, equipo_bat["configuracion"]
            ):
                errores.append(f"{equipo['id']} + {equipo_bat['id']}: {problema}")
    return errores


def _errores_configuracion(
    equipo: dict[str, Any], componente: dict[str, Any], donde: str
) -> list[str]:
    """Las baterías deben indicar una configuración existente; los demás equipos, ninguna."""
    config = equipo.get("configuracion")
    if componente.get("tipo") != "bateria":
        return [
            f"{donde}/{campo}: solo aplica a baterías"
            for campo in ("configuracion", "sistemas_en_paralelo")
            if campo in equipo
        ]
    disponibles = [c["id"] for c in componente.get("electrico", {}).get("configuraciones", [])]
    errores: list[str] = []
    paralelo = equipo.get("sistemas_en_paralelo", 1)
    maximo = componente["electrico"].get("max_sistemas_paralelo", 1)
    if paralelo > maximo:
        errores.append(
            f"{donde}/sistemas_en_paralelo: {paralelo} supera el máximo de "
            f"'{componente['id']}' ({maximo})"
        )
    if config is None:
        return errores + [f"{donde}/configuracion: falta; opciones: {', '.join(disponibles)}"]
    max_mod = componente["electrico"].get("max_modulos_por_sistema_en_paralelo")
    conf = next((c for c in componente["electrico"]["configuraciones"] if c["id"] == config), None)
    if paralelo > 1 and max_mod is not None and conf and conf["modulos_bateria"] > max_mod:
        errores.append(
            f"{donde}/configuracion: con {paralelo} sistemas en paralelo, cada uno admite máximo "
            f"{max_mod} módulos ('{config}' tiene {conf['modulos_bateria']})"
        )
    if config not in disponibles:
        errores.append(
            f"{donde}/configuracion: '{config}' no existe en '{componente['id']}'; "
            f"opciones: {', '.join(disponibles)}"
        )
    return errores


def validar_datos_privados(datos: Any) -> list[str]:
    return errores_esquema(datos, "datos_privados")


def validar_archivo(ruta: Path) -> list[str]:
    datos = cargar_json(ruta)
    if ruta.name == "proyecto.json":
        return validar_proyecto(datos, ruta)
    if ruta.name == "datos_privados.json":
        return validar_datos_privados(datos)
    if ruta.name == "lectura.json":
        return errores_esquema(datos, "lectura")
    return validar_componente(datos, ruta)


def archivos_por_defecto() -> list[Path]:
    return (
        sorted(DIR_BIBLIOTECA.rglob("*.json"))
        + sorted(DIR_PROYECTOS.glob("*/proyecto.json"))
        + sorted(DIR_PROYECTOS.glob("*/privado/datos_privados.json"))
        + sorted(DIR_PROYECTOS.glob("*/insumos/lectura.json"))
    )


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    rutas = [Path(a).resolve() for a in argv] or archivos_por_defecto()
    total_errores = 0
    for ruta in rutas:
        etiqueta = ruta.relative_to(RAIZ) if ruta.is_relative_to(RAIZ) else ruta
        try:
            errores = validar_archivo(ruta)
        except (OSError, json.JSONDecodeError) as exc:
            errores = [f"no se pudo leer: {exc}"]
        if errores:
            total_errores += len(errores)
            print(f"ERROR {etiqueta}")
            for error in errores:
                print(f"  - {error}")
        else:
            print(f"OK    {etiqueta}")
    print(f"\n{len(rutas)} archivo(s) revisado(s), {total_errores} error(es).")
    return 1 if total_errores else 0


if __name__ == "__main__":
    raise SystemExit(main())
