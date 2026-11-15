"""Biblioteca de componentes: coherencia interna de las fichas y compatibilidad entre equipos.

Todas las reglas son deterministas y usan solo datos de las fichas. Detectan errores de
transcripción (por ejemplo, Vmp × Imp muy distinto de Pmax) y combinaciones que la ficha
no permite (por ejemplo, una batería cuya tensión nominal se sale del rango del inversor).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

TOLERANCIA_RELATIVA = 0.01  # 1 %: margen para redondeos de la ficha

FASES_A_APLICACION = {
    "monofasica": "sistema_monofasico",
    "bifasica": "sistema_monofasico",
    "trifasica": "sistema_trifasico",
}

FASES_POR_TIPOLOGIA = {
    # T1: el Huawei SUN2000-LC0 (monofásico L/N) se usa entre dos fases en viviendas bifásicas.
    "T1": {"monofasica", "bifasica"},
    "T2": {"trifasica"},
}


def _difiere(valor: float, referencia: float) -> bool:
    return abs(valor - referencia) > TOLERANCIA_RELATIVA * abs(referencia)


def _errores_rango(rango: dict[str, float] | None, donde: str) -> list[str]:
    if rango and rango["min_v"] >= rango["max_v"]:
        return [
            f"{donde}: el mínimo ({rango['min_v']}) no es menor que el máximo ({rango['max_v']})"
        ]
    return []


def coherencia_componente(componente: dict[str, Any], raiz: Path | None = None) -> list[str]:
    """Errores de coherencia interna de un componente que ya cumple el esquema."""
    errores: list[str] = []
    archivo = componente["fuente"].get("archivo")
    if archivo and raiz is not None and not (raiz / archivo).is_file():
        errores.append(f"fuente/archivo: no existe '{archivo}'")

    tipo = componente["tipo"]
    e = componente["electrico"]
    if tipo == "modulo":
        if e["vmp_v"] >= e["voc_v"]:
            errores.append("electrico: Vmp debe ser menor que Voc")
        if e["imp_a"] >= e["isc_a"]:
            errores.append("electrico: Imp debe ser menor que Isc")
        if _difiere(e["vmp_v"] * e["imp_a"], e["potencia_stc_w"]):
            errores.append(
                f"electrico: Vmp × Imp = {e['vmp_v'] * e['imp_a']:.1f} W no coincide con "
                f"Pmax = {e['potencia_stc_w']} W (revisar transcripción)"
            )
        dims = componente["dimensiones"]
        if "eficiencia_pct" in e:
            area_m2 = dims["ancho_mm"] * dims["alto_mm"] / 1e6
            calculada = e["potencia_stc_w"] / (area_m2 * 1000) * 100
            if abs(calculada - e["eficiencia_pct"]) > 0.15:
                errores.append(
                    f"electrico: eficiencia calculada {calculada:.2f} % (Pmax / área / 1000 W/m²) "
                    f"no coincide con {e['eficiencia_pct']} %"
                )
    elif tipo == "inversor":
        errores += _errores_rango(e["rango_mppt"], "electrico/rango_mppt")
        if e["rango_mppt"]["max_v"] > e["tension_max_dc_v"]:
            errores.append("electrico/rango_mppt: el máximo supera la tensión máxima DC")
        if "bateria" in e:
            errores += _errores_rango(e["bateria"]["rango_tension"], "electrico/bateria")
        errores += _coherencia_mppt(e)
    elif tipo == "bateria":
        errores += _coherencia_bateria(e)
    return errores


def _coherencia_mppt(e: dict[str, Any]) -> list[str]:
    errores: list[str] = []
    n = e["numero_mppt"]
    for campo in (
        "strings_por_mppt",
        "corrientes_max_por_mppt_a",
        "corrientes_cortocircuito_por_mppt_a",
    ):
        if campo in e and len(e[campo]) != n:
            errores.append(f"electrico/{campo}: tiene {len(e[campo])} valores y hay {n} MPPT")
    if "strings_por_mppt" in e and sum(e["strings_por_mppt"]) != e["entradas_fv_totales"]:
        errores.append("electrico/strings_por_mppt: la suma no coincide con entradas_fv_totales")
    pares = [
        ("corrientes_max_por_mppt_a", "corriente_max_entrada_por_mppt_a"),
        ("corrientes_cortocircuito_por_mppt_a", "corriente_max_cortocircuito_por_mppt_a"),
    ]
    for lista, escalar in pares:
        if lista in e and escalar in e and max(e[lista]) != e[escalar]:
            errores.append(f"electrico/{escalar}: debe ser el mayor valor de {lista}")
    return errores


def _coherencia_bateria(e: dict[str, Any]) -> list[str]:
    errores: list[str] = []
    for i, r in enumerate(e.get("rangos_tension", [])):
        errores += _errores_rango(r, f"electrico/rangos_tension/{i}")
    modulo = e["modulo_bateria"]
    ids = [c["id"] for c in e["configuraciones"]]
    if len(ids) != len(set(ids)):
        errores.append("electrico/configuraciones: hay id repetidos")
    for i, c in enumerate(e["configuraciones"]):
        donde = f"electrico/configuraciones/{i} ({c['id']})"
        n = c["modulos_bateria"]
        energia_modulos = n * modulo["energia_kwh"]
        nominal = c.get("energia_nominal_kwh")
        if nominal is not None:
            if _difiere(energia_modulos, nominal):
                errores.append(
                    f"{donde}: {n} × {modulo['energia_kwh']} kWh = {energia_modulos:.2f} kWh "
                    f"no coincide con la energía nominal {nominal} kWh"
                )
            if c["energia_util_kwh"] > nominal:
                errores.append(f"{donde}: la energía útil supera la nominal")
        elif c["energia_util_kwh"] > energia_modulos * (1 + TOLERANCIA_RELATIVA):
            errores.append(f"{donde}: la energía útil supera {n} × energía del módulo")
        v_mod = modulo.get("tension_nominal_v")
        v_conf = c.get("tension_nominal_v")
        if v_mod is not None and v_conf is not None and _difiere(n * v_mod, v_conf):
            errores.append(
                f"{donde}: {n} × {v_mod} V = {n * v_mod:.1f} V no coincide con {v_conf} V"
            )
        rango = c.get("rango_tension")
        errores += _errores_rango(rango, f"{donde}/rango_tension")
        if rango and v_conf is not None and not rango["min_v"] <= v_conf <= rango["max_v"]:
            errores.append(
                f"{donde}: la tensión nominal {v_conf} V está fuera de su rango "
                f"{rango['min_v']}–{rango['max_v']} V"
            )
    return errores


def compatibilidad_inversor_bateria(
    inversor: dict[str, Any], bateria: dict[str, Any], configuracion: str
) -> list[str]:
    """Problemas para usar la configuración `configuracion` de `bateria` con `inversor`.

    Lista vacía = no se encontró incompatibilidad con los datos de las fichas. No reemplaza
    la verificación del fabricante ni el cálculo eléctrico del paso 5.
    """
    puerto = inversor["electrico"].get("bateria")
    if puerto is None:
        return [f"el inversor '{inversor['id']}' no tiene puerto de batería"]
    eb = bateria["electrico"]
    config = next((c for c in eb["configuraciones"] if c["id"] == configuracion), None)
    if config is None:
        return [f"la batería '{bateria['id']}' no tiene la configuración '{configuracion}'"]

    problemas: list[str] = []
    marcas = eb.get("marcas_inversor_compatibles")
    if marcas is not None and inversor["marca"] not in marcas:
        problemas.append(
            f"la batería {bateria['modelo']} solo se usa con inversores {', '.join(marcas)}; "
            f"el inversor es {inversor['marca']}"
        )
    if eb["nivel_tension"] != puerto["nivel_tension"]:
        problemas.append(
            f"nivel de tensión distinto: batería '{eb['nivel_tension']}', "
            f"inversor '{puerto['nivel_tension']}'"
        )
    compatibles = puerto.get("baterias_compatibles")
    if compatibles is not None and bateria["modelo"] not in compatibles:
        problemas.append(
            f"la ficha del inversor no lista '{bateria['modelo']}' como compatible "
            f"(lista: {', '.join(compatibles)})"
        )
    rmin, rmax = puerto["rango_tension"]["min_v"], puerto["rango_tension"]["max_v"]
    v_nominal = config.get("tension_nominal_v")
    rango_conf = config.get("rango_tension")
    if rango_conf and not (rmin <= rango_conf["min_v"] and rango_conf["max_v"] <= rmax):
        problemas.append(
            f"rango de tensión de '{configuracion}' "
            f"({rango_conf['min_v']}–{rango_conf['max_v']} V) "
            f"no cabe en el rango de batería del inversor ({rmin}–{rmax} V)"
        )
    elif v_nominal is not None and not rmin <= v_nominal <= rmax:
        problemas.append(
            f"tensión nominal de '{configuracion}' ({v_nominal} V) fuera del rango de batería "
            f"del inversor ({rmin}–{rmax} V)"
        )
    aplicacion = FASES_A_APLICACION[inversor["electrico"]["fases"]]
    for r in eb.get("rangos_tension", []):
        if r["aplicacion"] == aplicacion and not (rmin <= r["min_v"] and r["max_v"] <= rmax):
            problemas.append(
                f"rango de la batería para {aplicacion} ({r['min_v']}–{r['max_v']} V) no cabe "
                f"en el rango del inversor ({rmin}–{rmax} V)"
            )
    return problemas
