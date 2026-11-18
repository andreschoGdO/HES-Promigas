"""Traducción de una instrucción en lenguaje natural a operaciones de edición (Paso 8).

Claude recibe un resumen de la vivienda (zonas, módulos, equipos, biblioteca) y devuelve, con
salida estructurada (JSON Schema), una lista de operaciones de ``engine.edicion.operaciones``.
Claude NO edita archivos ni calcula: solo propone operaciones; el código las aplica y valida.

La clave se lee del entorno (``ANTHROPIC_API_KEY`` u otra credencial que el SDK encuentre);
nunca se guarda en el repositorio.
"""

from __future__ import annotations

import json
import math
from typing import Any

MODELO = "claude-opus-5-5"
NUM = {"type": ["number", "null"]}

_ESQUEMA_OPS = [
    {
        "type": "object",
        "description": "Cambia un campo EXISTENTE (no equipos ni zonas de proyecto.json).",
        "properties": {
            "op": {"type": "string", "enum": ["establecer"]},
            "archivo": {"type": "string", "enum": ["proyecto", "electrico", "zonas"]},
            "ruta": {
                "type": "string",
                "description": "p. ej. sistema.arquitectura, buitron.alto_mm",
            },
            "valor_json": {"type": "string", "description": "valor nuevo codificado en JSON"},
        },
        "required": ["op", "archivo", "ruta", "valor_json"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "description": "Mueve un equipo sobre el muro de equipos.",
        "properties": {
            "op": {"type": "string", "enum": ["mover_equipo"]},
            "id": {"type": "string"},
            "a_lo_largo_mm": {"type": "number"},
            "subir_mm": {"type": "number"},
        },
        "required": ["op", "id", "a_lo_largo_mm", "subir_mm"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "description": "Cambia el inversor, la batería o el medidor por otro de la biblioteca.",
        "properties": {
            "op": {"type": "string", "enum": ["cambiar_equipo"]},
            "tipo": {"type": "string", "enum": ["inversor", "bateria", "medidor"]},
            "componente": {"type": "string"},
            "configuracion": {"type": ["string", "null"]},
            "sistemas_en_paralelo": {"type": ["integer", "null"]},
        },
        "required": ["op", "tipo", "componente", "configuracion", "sistemas_en_paralelo"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "description": "Fija módulos por string, o null para que el motor elija.",
        "properties": {
            "op": {"type": "string", "enum": ["cambiar_strings"]},
            "strings": {"type": ["array", "null"], "items": {"type": "integer"}},
        },
        "required": ["op", "strings"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "description": "Cambia una zona y redistribuye sus módulos (null = no cambia).",
        "properties": {
            "op": {"type": "string", "enum": ["cambiar_zona"]},
            "zona": {"type": "string"},
            "inclinacion_deg": NUM,
            "azimut_deg": NUM,
            "orientacion_modulo": {
                "type": ["string", "null"],
                "enum": ["vertical", "horizontal", None],
            },
            "separacion_mm": NUM,
            "retiro_mm": NUM,
            "altura_estructura_mm": NUM,
        },
        "required": [
            "op",
            "zona",
            "inclinacion_deg",
            "azimut_deg",
            "orientacion_modulo",
            "separacion_mm",
            "retiro_mm",
            "altura_estructura_mm",
        ],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "description": "Quita módulos concretos por id.",
        "properties": {
            "op": {"type": "string", "enum": ["quitar_modulos"]},
            "ids": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["op", "ids"],
        "additionalProperties": False,
    },
]

ESQUEMA_RESPUESTA = {
    "type": "object",
    "properties": {
        "operaciones": {"type": "array", "items": {"anyOf": _ESQUEMA_OPS}},
        "explicacion": {
            "type": "string",
            "description": "Qué entendiste y qué supusiste, en español, 1 a 3 frases.",
        },
        "preguntas": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Preguntas al usuario si la instrucción es ambigua o falta un dato.",
        },
    },
    "required": ["operaciones", "explicacion", "preguntas"],
    "additionalProperties": False,
}

SISTEMA = """Eres el asistente de edición de sunny-cad, una herramienta de diseño de sistemas \
solares fotovoltaicos con baterías en viviendas de Colombia (proyecto Sunny, Promigas).

Tu única tarea: traducir la instrucción del usuario a una lista de operaciones de edición. \
No calculas nada ni escribes archivos: el código aplica las operaciones sobre una copia, \
recalcula la distribución de módulos y la parte eléctrica, valida y muestra la diferencia \
al usuario, que decide si se aplica.

Reglas:
- Usa solo ids, zonas, componentes y configuraciones que aparezcan en el contexto.
- Unidades: mm para distancias, grados para ángulos. Azimut desde el norte en sentido \
horario (180 = sur), hacia donde cae el agua.
- En mover_equipo, a_lo_largo_mm positivo va del extremo "de" del muro de equipos hacia el \
extremo "a". Visto de frente, "de" queda a la derecha: "a la izquierda" es positivo y \
"a la derecha" es negativo. subir_mm positivo sube el equipo.
- Cada batería solo es compatible con inversores de su misma marca: si el usuario cambia de \
marca de inversor, cambia también la batería o pregunta.
- No inventes datos de equipos ni requisitos normativos. Si falta un dato o la instrucción es \
ambigua, deja operaciones vacía y escribe la pregunta en preguntas.
- Con establecer, valor_json es el valor en JSON (por ejemplo "\\"paralelo\\"" o "1700"); solo \
puede cambiar campos que existen.
- Responde la explicación en español, breve."""


def _s_muro(entrada: dict[str, Any], punto: list[float]) -> float:
    m = entrada["muro_equipos"]
    dx, dy = m["a"][0] - m["de"][0], m["a"][1] - m["de"][1]
    largo = math.hypot(dx, dy)
    return round(((punto[0] - m["de"][0]) * dx + (punto[1] - m["de"][1]) * dy) / largo)


def contexto(estado: dict[str, Any], biblioteca: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Resumen compacto de la vivienda para el modelo (sin datos personales)."""
    p = estado["proyecto"]
    mods = [e for e in p["equipos"] if e["tipo"] == "modulo"]
    por_zona: dict[str, list[str]] = {}
    for e in mods:
        por_zona.setdefault(e["colocacion"]["zona_ref"], []).append(
            f"{e['id']} (fila {e['colocacion']['fila']}, string {e.get('string')})"
        )
    ctx: dict[str, Any] = {
        "proyecto": {k: p.get(k) for k in ("id", "nombre", "sistema")},
        "cubiertas": [
            {k: c.get(k) for k in ("id", "tipo", "material", "cota_base_mm")}
            for c in p["vivienda"]["cubiertas"]
        ],
        "zonas": estado.get("zonas")
        and [
            {k: z.get(k) for k in ("id", "cubierta_ref", "estructura", *_CAMPOS_ZONA)}
            for z in estado["zonas"]
        ],
        "modulos_por_zona": por_zona,
        "equipos": [
            {k: e.get(k) for k in ("id", "tipo", "componente_ref", "configuracion")}
            for e in p["equipos"]
            if e["tipo"] != "modulo"
        ],
    }
    entrada = estado.get("electrico")
    if entrada:
        ctx["electrico"] = {
            "strings": entrada.get("strings"),
            "largo_muro_equipos_mm": round(
                math.dist(entrada["muro_equipos"]["de"], entrada["muro_equipos"]["a"])
            ),
            "ubicaciones": {
                k: {"a_lo_largo_mm_desde_de": _s_muro(entrada, u["punto"]), "z_mm": u["z_mm"]}
                for k, u in entrada.get("ubicaciones", {}).items()
            },
            "campos_editables": sorted(
                k for k, v in entrada.items() if not isinstance(v, dict | list) or k == "buitron"
            ),
            "buitron": entrada.get("buitron"),
        }
    ctx["biblioteca"] = [
        {
            "id": c["id"],
            "tipo": c["tipo"],
            "fabricante": c["fabricante"],
            "modelo": c["modelo"],
            **(
                {"configuraciones": [x["id"] for x in c["electrico"]["configuraciones"]]}
                if c["tipo"] == "bateria"
                else {}
            ),
        }
        for c in biblioteca.values()
        if c["tipo"] in ("inversor", "bateria", "medidor", "modulo") and not c.get("es_ejemplo")
    ]
    return ctx


_CAMPOS_ZONA = (
    "inclinacion_deg",
    "azimut_deg",
    "orientacion_modulo",
    "separacion_mm",
    "retiro_mm",
    "altura_estructura_mm",
)


def normalizar(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pasa la salida estructurada del modelo al formato de engine.edicion.operaciones."""
    out = []
    for op in ops:
        op = dict(op)
        if op["op"] == "establecer":
            op["valor"] = json.loads(op.pop("valor_json"))
        elif op["op"] == "cambiar_zona":
            op["campos"] = {k: op.pop(k) for k in _CAMPOS_ZONA if op.get(k) is not None}
            for k in _CAMPOS_ZONA:
                op.pop(k, None)
        elif op["op"] == "cambiar_equipo":
            op = {k: v for k, v in op.items() if v is not None}
        out.append(op)
    return out


class ErrorInterprete(RuntimeError):
    pass


def interpretar(
    instruccion: str,
    estado: dict[str, Any],
    biblioteca: dict[str, dict[str, Any]],
    cliente: Any = None,
) -> dict[str, Any]:
    """Devuelve {"operaciones": [...], "explicacion": str, "preguntas": [...]}."""
    if cliente is None:
        import anthropic

        cliente = anthropic.Anthropic()
    mensaje = (
        "Contexto de la vivienda (JSON):\n"
        + json.dumps(contexto(estado, biblioteca), ensure_ascii=False)
        + f"\n\nInstrucción del usuario:\n{instruccion}"
    )
    respuesta = cliente.beta.messages.create(
        model=MODELO,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SISTEMA,
        output_config={
            "effort": "medium",
            "format": {"type": "json_schema", "schema": ESQUEMA_RESPUESTA},
        },
        messages=[{"role": "user", "content": mensaje}],
    )
    if respuesta.stop_reason == "refusal":
        raise ErrorInterprete("el modelo no procesó la instrucción (refusal)")
    if respuesta.stop_reason == "max_tokens":
        raise ErrorInterprete("respuesta incompleta (max_tokens)")
    texto = next((b.text for b in respuesta.content if b.type == "text"), None)
    if texto is None:
        raise ErrorInterprete("respuesta sin texto")
    datos = json.loads(texto)
    datos["operaciones"] = normalizar(datos["operaciones"])
    return datos
