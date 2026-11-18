"""Operaciones de edición (Paso 8): cambios deterministas sobre los datos de una vivienda.

La IA solo traduce la instrucción del usuario a una lista de estas operaciones; aquí se aplican
con código, sobre una copia del estado, y luego se recalculan distribución y parte eléctrica.

Estado = {"proyecto": proyecto.json, "electrico": insumos/electrico.json | None,
          "zonas": insumos/zonas.json | None}

Cada operación es un dict {"op": <nombre>, ...}. Las funciones devuelven una frase en español
que describe el cambio y marcan en ``estado["_recalcular"]`` qué motores hay que volver a correr.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

ARCHIVOS = ("proyecto", "electrico", "zonas")
CAMPOS_ZONA = {
    "inclinacion_deg": (int, float),
    "azimut_deg": (int, float),
    "orientacion_modulo": str,
    "separacion_mm": (int, float),
    "retiro_mm": (int, float),
    "altura_estructura_mm": (int, float),
    "estructura": str,
}
# Rutas de proyecto.json que no se editan a mano: las calculan los motores.
RUTAS_DERIVADAS = ("equipos", "vivienda.zonas_instalacion")


class ErrorOperacion(ValueError):
    """La operación no se puede aplicar (dato inexistente, valor inválido…)."""


# ----------------------------------------------------------------------------- rutas
_PASO = re.compile(r"([^.\[\]]+)|\[(\d+)\]|\[id=([^\]]+)\]")


def _pasos(ruta: str) -> list[str | int | tuple[str, str]]:
    """'a.b[0].c' → ['a', 'b', 0, 'c'];  'equipos[id=inversor-01]' → ['equipos', ('id', …)]."""
    pasos: list[str | int | tuple[str, str]] = []
    pos = 0
    for m in _PASO.finditer(ruta):
        if m.start() != pos and ruta[pos : m.start()] != ".":
            raise ErrorOperacion(f"ruta mal escrita: {ruta!r}")
        pos = m.end()
        if m.group(1) is not None:
            pasos.append(int(m.group(1)) if m.group(1).isdigit() else m.group(1))
        elif m.group(2) is not None:
            pasos.append(int(m.group(2)))
        else:
            pasos.append(("id", m.group(3)))
    if not pasos or pos != len(ruta):
        raise ErrorOperacion(f"ruta mal escrita: {ruta!r}")
    return pasos


def _bajar(nodo: Any, paso: str | int | tuple[str, str], ruta: str) -> Any:
    if isinstance(paso, tuple):
        if not isinstance(nodo, list):
            raise ErrorOperacion(f"{ruta}: [id=…] solo aplica a listas")
        for x in nodo:
            if isinstance(x, dict) and x.get("id") == paso[1]:
                return x
        raise ErrorOperacion(f"{ruta}: no existe el id {paso[1]!r}")
    if isinstance(paso, int):
        if not isinstance(nodo, list) or not -len(nodo) <= paso < len(nodo):
            raise ErrorOperacion(f"{ruta}: índice {paso} fuera de rango")
        return nodo[paso]
    if not isinstance(nodo, dict) or paso not in nodo:
        raise ErrorOperacion(f"{ruta}: no existe el campo {paso!r}")
    return nodo[paso]


def establecer(estado: dict[str, Any], archivo: str, ruta: str, valor: Any) -> str:
    """Cambia un campo existente. No crea campos nuevos (así un error de la IA no pasa
    inadvertido) ni toca lo que calculan los motores (equipos, zonas en proyecto.json)."""
    if archivo not in ARCHIVOS or estado.get(archivo) is None:
        raise ErrorOperacion(f"archivo desconocido o inexistente: {archivo!r}")
    if archivo == "proyecto" and any(
        ruta == r or ruta.startswith((r + ".", r + "[")) for r in RUTAS_DERIVADAS
    ):
        raise ErrorOperacion(
            f"{ruta} lo calculan los motores: usa las operaciones de equipos, módulos o zonas"
        )
    pasos = _pasos(ruta)
    nodo = estado[archivo]
    for p in pasos[:-1]:
        nodo = _bajar(nodo, p, ruta)
    ultimo = pasos[-1]
    anterior = _bajar(nodo, ultimo, ruta)  # exige que exista
    if isinstance(ultimo, tuple):
        raise ErrorOperacion(f"{ruta}: no se reemplaza un elemento completo")
    nodo[ultimo] = valor
    if archivo == "zonas":
        estado["_recalcular"].add("distribucion")
    estado["_recalcular"].add("electrico")
    nuevo, viejo = (json.dumps(x, ensure_ascii=False) for x in (valor, anterior))
    return f"{archivo}: {ruta} = {nuevo} (antes {viejo})"


# ----------------------------------------------------------------------------- equipos
def _electrico(estado: dict[str, Any]) -> dict[str, Any]:
    if estado.get("electrico") is None:
        raise ErrorOperacion("esta vivienda aún no tiene insumos/electrico.json (Paso 5)")
    return estado["electrico"]


def _ejes_muro(entrada: dict[str, Any]) -> tuple[list[float], list[float]]:
    m = entrada["muro_equipos"]
    dx, dy = m["a"][0] - m["de"][0], m["a"][1] - m["de"][1]
    largo = math.hypot(dx, dy)
    return [dx / largo, dy / largo], [m["de"][0], m["de"][1]]


def mover_equipo(
    estado: dict[str, Any],
    id: str,
    a_lo_largo_mm: float = 0,
    subir_mm: float = 0,
) -> str:
    """Mueve un equipo sobre el muro de equipos: a lo largo del muro (+ hacia el extremo "a")
    y en altura."""
    entrada = _electrico(estado)
    ub = entrada.get("ubicaciones", {})
    if id not in ub:
        raise ErrorOperacion(f"no hay ubicación para {id!r}; existen: {', '.join(ub)}")
    if not a_lo_largo_mm and not subir_mm:
        raise ErrorOperacion("mover_equipo sin desplazamiento")
    w, _ = _ejes_muro(entrada)
    p = ub[id]["punto"]
    ub[id]["punto"] = [round(p[0] + w[0] * a_lo_largo_mm), round(p[1] + w[1] * a_lo_largo_mm)]
    nuevo_z = ub[id]["z_mm"] + subir_mm
    if nuevo_z < 0:
        raise ErrorOperacion(f"{id} quedaría bajo el piso (z = {nuevo_z:.0f} mm)")
    ub[id]["z_mm"] = nuevo_z
    estado["_recalcular"].add("electrico")
    partes = []
    if a_lo_largo_mm:
        partes.append(f"{a_lo_largo_mm:+.0f} mm a lo largo del muro")
    if subir_mm:
        partes.append(f"{subir_mm:+.0f} mm en altura")
    return f"{id}: se mueve {' y '.join(partes)}"


def cambiar_equipo(
    estado: dict[str, Any],
    tipo: str,
    componente: str,
    configuracion: str | None = None,
    sistemas_en_paralelo: int | None = None,
    biblioteca: dict[str, dict[str, Any]] | None = None,
) -> str:
    """Cambia el inversor, la batería (y su configuración) o el medidor por otro de la biblioteca.

    Solo con componentes de la biblioteca (fichas citadas)."""
    entrada = _electrico(estado)
    bib = biblioteca or {}
    comp = bib.get(componente)
    if comp is None:
        raise ErrorOperacion(f"{componente!r} no está en la biblioteca")
    if comp["tipo"] != tipo:
        raise ErrorOperacion(f"{componente!r} es un {comp['tipo']}, no un {tipo}")
    if tipo == "inversor":
        antes = entrada["inversor"]
        entrada["inversor"] = componente
    elif tipo == "medidor":
        antes = entrada.get("medidor")
        entrada["medidor"] = componente
    elif tipo == "bateria":
        b = entrada["bateria"]
        antes = f"{b['componente']} {b['configuracion']}"
        confs = [c["id"] for c in comp["electrico"]["configuraciones"]]
        conf = configuracion or (b["configuracion"] if b["componente"] == componente else None)
        if conf not in confs:
            raise ErrorOperacion(
                f"configuración {conf!r} no existe en {componente}; opciones: {', '.join(confs)}"
            )
        b["componente"], b["configuracion"] = componente, conf
        if sistemas_en_paralelo is not None:
            b["sistemas_en_paralelo"] = sistemas_en_paralelo
    else:
        raise ErrorOperacion(f"tipo de equipo no editable: {tipo!r} (inversor, bateria, medidor)")
    estado["_recalcular"].add("electrico")
    return f"{tipo}: {antes} → {componente}" + (f" ({configuracion})" if configuracion else "")


def cambiar_strings(estado: dict[str, Any], strings: list[int] | None) -> str:
    """Fija los módulos por string (por ejemplo [4, 4]) o, con None, los deja al motor."""
    entrada = _electrico(estado)
    if strings is not None and (not strings or any(int(n) < 1 for n in strings)):
        raise ErrorOperacion(f"strings inválidos: {strings}")
    antes = entrada.get("strings")
    entrada["strings"] = strings
    estado["_recalcular"].add("electrico")
    return f"strings: {antes} → {strings if strings is not None else 'automático'}"


# ----------------------------------------------------------------------------- módulos
def cambiar_zona(estado: dict[str, Any], zona: str, campos: dict[str, Any]) -> str:
    """Cambia parámetros de una zona de instalación y redistribuye sus módulos."""
    zonas = estado.get("zonas")
    if zonas is None:
        raise ErrorOperacion("esta vivienda aún no tiene insumos/zonas.json (Paso 4)")
    z = next((x for x in zonas if x["id"] == zona), None)
    if z is None:
        raise ErrorOperacion(
            f"no existe la zona {zona!r}; existen: {', '.join(x['id'] for x in zonas)}"
        )
    if not campos:
        raise ErrorOperacion("cambiar_zona sin campos")
    cambios = []
    for k, v in campos.items():
        if k not in CAMPOS_ZONA:
            raise ErrorOperacion(f"campo de zona no editable: {k!r} ({', '.join(CAMPOS_ZONA)})")
        if not isinstance(v, CAMPOS_ZONA[k]) or isinstance(v, bool):
            raise ErrorOperacion(f"{k}: valor inválido {v!r}")
        cambios.append(f"{k} {z.get(k)} → {v}")
        z[k] = v
    estado["_recalcular"].update({"distribucion", "electrico"})
    return f"{zona}: " + ", ".join(cambios) + " (se redistribuyen los módulos)"


def quitar_modulos(estado: dict[str, Any], ids: list[str]) -> str:
    """Quita módulos concretos (por ejemplo por sombra). Se hace después de redistribuir."""
    if not ids:
        raise ErrorOperacion("quitar_modulos sin ids")
    existentes = {e["id"] for e in estado["proyecto"]["equipos"] if e["tipo"] == "modulo"}
    faltan = [i for i in ids if i not in existentes]
    if faltan:
        raise ErrorOperacion(f"no existen los módulos: {', '.join(faltan)}")
    estado["_quitar_modulos"].update(ids)
    estado["_recalcular"].add("electrico")
    return f"se quitan {len(ids)} módulo(s): {', '.join(sorted(ids))}"


OPERACIONES = {
    "establecer": establecer,
    "mover_equipo": mover_equipo,
    "cambiar_equipo": cambiar_equipo,
    "cambiar_strings": cambiar_strings,
    "cambiar_zona": cambiar_zona,
    "quitar_modulos": quitar_modulos,
}


def aplicar(
    estado: dict[str, Any], ops: list[dict[str, Any]], biblioteca: dict[str, Any]
) -> list[str]:
    """Aplica las operaciones en orden sobre ``estado`` (que se modifica). Devuelve el resumen."""
    estado.setdefault("_recalcular", set())
    estado.setdefault("_quitar_modulos", set())
    resumen = []
    for i, op in enumerate(ops, 1):
        datos = dict(op)
        nombre = datos.pop("op", None)
        f = OPERACIONES.get(nombre)
        if f is None:
            raise ErrorOperacion(
                f"operación {i}: desconocida {nombre!r} ({', '.join(OPERACIONES)})"
            )
        if nombre == "cambiar_equipo":
            datos["biblioteca"] = biblioteca
        try:
            resumen.append(f(estado, **datos))
        except TypeError as e:
            raise ErrorOperacion(f"operación {i} ({nombre}): parámetros inválidos ({e})") from e
        except ErrorOperacion as e:
            raise ErrorOperacion(f"operación {i} ({nombre}): {e}") from e
    return resumen
