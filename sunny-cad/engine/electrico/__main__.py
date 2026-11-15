"""Motor eléctrico (Paso 5).

Uso::

    python -m engine.electrico proponer <id>            # propuesta + memoria de cálculo
    python -m engine.electrico proponer <id> --aplicar

Lee ``insumos/electrico.json`` (equipos elegidos y su ubicación), arma la propuesta (equipos,
string de cada módulo), calcula strings, conductores, protecciones y caídas de tensión con
los criterios de ``templates/criterios_electricos.json`` (por confirmar) y escribe
``salidas/calculo_electrico.json`` y ``salidas/memoria_electrica.md``.
"""

from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path
from typing import Any

from engine import jsonfmt, validar
from engine.electrico import circuitos, strings

CRITERIOS = validar.RAIZ / "templates" / "criterios_electricos.json"


def _rel(ruta: Path) -> Path:
    return ruta.relative_to(validar.RAIZ) if ruta.is_relative_to(validar.RAIZ) else ruta


def _equipos_base(entrada: dict[str, Any]) -> list[dict[str, Any]]:
    ub = entrada["ubicaciones"]
    eq = [
        {"id": "inversor-01", "tipo": "inversor", "componente_ref": entrada["inversor"]},
        {
            "id": "bateria-01",
            "tipo": "bateria",
            "componente_ref": entrada["bateria"]["componente"],
            "configuracion": entrada["bateria"]["configuracion"],
            "sistemas_en_paralelo": entrada["bateria"].get("sistemas_en_paralelo", 1),
        },
    ]
    if entrada.get("medidor"):
        eq.append({"id": "medidor-01", "tipo": "medidor", "componente_ref": entrada["medidor"]})
    for e in eq:
        if e["id"] in ub:
            e["ubicacion_mm"] = ub[e["id"]]
        texto = entrada.get("ubicacion_texto")
        if texto:
            e["ubicacion_texto"] = texto
    return eq


def _z_modulo(modulo_eq: dict[str, Any], proyecto: dict[str, Any]) -> float:
    zona = next(
        z
        for z in proyecto["vivienda"]["zonas_instalacion"]
        if z["id"] == modulo_eq["colocacion"]["zona_ref"]
    )
    cub = next(c for c in proyecto["vivienda"]["cubiertas"] if c["id"] == zona["cubierta_ref"])
    return (cub["cota_base_mm"] or 0) + (zona.get("altura_estructura_mm") or 0)


def calcular(
    proyecto: dict[str, Any], entrada: dict[str, Any], biblioteca, criterios
) -> dict[str, Any]:
    """Propuesta (copia del proyecto) + resultados del cálculo."""
    propuesta = copy.deepcopy(proyecto)
    inversor = biblioteca[entrada["inversor"]]
    bateria = biblioteca[entrada["bateria"]["componente"]]
    modulos = [e for e in propuesta["equipos"] if e["tipo"] == "modulo"]
    modulo = biblioteca[modulos[0]["componente_ref"]]
    cond = propuesta["condiciones_diseno"]
    t = strings.temperaturas(cond, modulo, criterios)
    lim = strings.limites_string(modulo, inversor, t)
    validas = strings.opciones(len(modulos), lim, inversor)
    elegida = entrada.get("strings") or strings.elegir(
        validas, criterios["strings_preferidos"]["valor"]
    )
    if elegida is None:
        raise ValueError(f"no hay configuración de strings válida para {len(modulos)} módulos")
    filas, errores = strings.verificar(elegida, modulo, inversor, t, criterios)

    # Asignación: en el orden de numeración (por zona, fila y columna).
    i = 0
    for fila in filas:
        for m in modulos[i : i + fila["modulos"]]:
            m["string"] = fila["string"]
        i += fila["modulos"]
    propuesta["equipos"] = _equipos_base(entrada) + modulos

    inv_e = inversor["electrico"]
    f_cont = criterios["corriente_continua"]["factor"]
    f_fv = criterios["corriente_maxima_fv"]["factor"]
    amb = cond["temperatura_max_ambiente_c"]
    lim_dc = criterios["caida_tension_max_pct"]["dc"]
    lim_ac = criterios["caida_tension_max_pct"]["ac"]
    ub_inv = entrada["ubicaciones"]["inversor-01"]
    rumbo = entrada["rumbo_edificio_deg"]
    circuitos_out = []

    # Circuitos DC de strings
    for fila in filas:
        mods = [m for m in modulos if m["string"] == fila["string"]]
        largo = max(
            circuitos.longitud_ruta_m(
                tuple(m["colocacion"]["centro_mm"]),
                _z_modulo(m, propuesta),
                tuple(ub_inv["punto"]),
                ub_inv["z_mm"],
                rumbo,
                criterios,
            )
            for m in mods
        )
        i_max = fila["isc_a"] * f_fv
        i_req = i_max * f_cont
        cal = circuitos.calibre_por_ampacidad(
            i_req, criterios, amb, criterios["calibre_minimo_awg"]["dc_fv"]
        )
        v_op = fila["modulos"] * modulo["electrico"]["vmp_v"]
        caida = circuitos.caida_dc_pct(largo, fila["imp_a"], v_op, cal, criterios)
        n_str_mppt = 1
        circuitos_out.append(
            {
                "id": f"DC-{fila['string']}",
                "tramo": f"string {fila['string']} → inversor (MPPT {fila['mppt']})",
                "corriente_max_a": round(i_max, 2),
                "corriente_requerida_conductor_a": round(i_req, 2),
                "calibre_awg": cal,
                "longitud_estimada_m": round(largo, 1),
                "tension_operacion_v": round(v_op, 1),
                "caida_pct": round(caida, 2),
                "limite_caida_pct": lim_dc,
                "proteccion": (
                    "sin fusible de string (≤ "
                    f"{criterios['fusibles_string']['max_strings_sin_fusible_por_mppt']} strings por MPPT; "
                    f"fusible máximo del módulo {modulo['electrico'].get('fusible_max_serie_a')} A)"
                    if n_str_mppt
                    <= criterios["fusibles_string"]["max_strings_sin_fusible_por_mppt"]
                    else "fusible de string requerido"
                ),
            }
        )

    # Batería
    eb = bateria["electrico"]
    conf = next(c for c in eb["configuraciones"] if c["id"] == entrada["bateria"]["configuracion"])
    i_bat = min(
        eb.get("corriente_pico_descarga_a", 1e9),
        inv_e["bateria"].get("corriente_max_descarga_a", 1e9),
    )
    i_bat_req = i_bat * f_cont
    ub_bat = entrada["ubicaciones"].get("bateria-01")
    largo_bat = (
        circuitos.longitud_ruta_m(
            tuple(ub_bat["punto"]),
            ub_bat["z_mm"],
            tuple(ub_inv["punto"]),
            ub_inv["z_mm"],
            rumbo,
            criterios,
        )
        if ub_bat
        else None
    )
    cal_bat = circuitos.calibre_por_ampacidad(
        i_bat_req, criterios, amb, criterios["calibre_minimo_awg"]["dc_fv"]
    )
    circuitos_out.append(
        {
            "id": "DC-BAT",
            "tramo": f"batería {bateria['modelo']} ({conf['id']}) → inversor",
            "corriente_max_a": i_bat,
            "corriente_requerida_conductor_a": round(i_bat_req, 2),
            "calibre_awg": cal_bat,
            "longitud_estimada_m": round(largo_bat, 1) if largo_bat else None,
            "tension_operacion_v": conf.get("tension_nominal_v"),
            "caida_pct": round(
                circuitos.caida_dc_pct(
                    largo_bat, i_bat, conf["tension_nominal_v"], cal_bat, criterios
                ),
                2,
            )
            if largo_bat and conf.get("tension_nominal_v")
            else None,
            "limite_caida_pct": lim_dc,
            "proteccion": f"interruptor DC {circuitos.interruptor(i_bat_req, criterios)} A (verificar si el fabricante lo integra)",
        }
    )

    # Salidas AC del inversor (red y respaldo)
    i_ac = inv_e["corriente_max_salida_ac_a"]
    i_ac_req = i_ac * f_cont
    cal_ac = circuitos.calibre_por_ampacidad(
        i_ac_req, criterios, amb, criterios["calibre_minimo_awg"]["ac"]
    )
    v_linea = min(inv_e["tensiones_nominales_ac_v"])
    ub_tab = entrada["ubicaciones"].get("tablero-fv")
    largo_tab = (
        circuitos.longitud_ruta_m(
            tuple(ub_inv["punto"]),
            ub_inv["z_mm"],
            tuple(ub_tab["punto"]),
            ub_tab["z_mm"],
            rumbo,
            criterios,
        )
        if ub_tab
        else None
    )
    for cid, tramo, largo in (
        (
            "AC-RED",
            "inversor (puerto red) → tablero FV (contactor / ATS)",
            entrada.get("longitud_ac_red_m", largo_tab),
        ),
        (
            "AC-CARGA",
            "inversor (puerto respaldo) → tablero FV",
            entrada.get("longitud_ac_carga_m", largo_tab),
        ),
        (
            "AC-EXISTENTE",
            "tablero FV → tablero existente de la vivienda",
            entrada.get("longitud_ac_existente_m"),
        ),
    ):
        circuitos_out.append(
            {
                "id": cid,
                "tramo": tramo,
                "corriente_max_a": i_ac,
                "corriente_requerida_conductor_a": round(i_ac_req, 2),
                "calibre_awg": cal_ac,
                "longitud_estimada_m": round(largo, 1) if largo else None,
                "tension_operacion_v": v_linea,
                "caida_pct": round(
                    circuitos.caida_ac3f_pct(largo, i_ac, v_linea, cal_ac, criterios), 2
                )
                if largo
                else None,
                "limite_caida_pct": lim_ac,
                "proteccion": f"interruptor {circuitos.interruptor(i_ac_req, criterios)} A tripolar",
            }
        )

    for c in circuitos_out:
        if c["caida_pct"] is not None and c["caida_pct"] > c["limite_caida_pct"]:
            errores.append(f"{c['id']}: caída {c['caida_pct']} % > {c['limite_caida_pct']} %")

    p_fv = len(modulos) * modulo["electrico"]["potencia_stc_w"]
    if p_fv > inv_e.get("potencia_fv_max_conectable_w", float("inf")):
        errores.append(
            f"potencia FV {p_fv} W > máxima conectable {inv_e['potencia_fv_max_conectable_w']} W"
        )

    resultado = {
        "temperaturas_c": {
            "minima": t.minima_c,
            "max_ambiente": t.max_ambiente_c,
            "max_celda": round(t.max_celda_c, 2),
        },
        "limites_string": {
            "voc_frio_por_modulo_v": round(lim.voc_frio_v, 2),
            "vmp_caliente_por_modulo_v": round(lim.vmp_caliente_v, 2),
            "n_min": lim.n_min,
            "n_max": lim.n_max,
            "motivo_n_max": lim.motivo_n_max,
        },
        "opciones_strings": validas,
        "strings": filas,
        "potencia_fv_w": p_fv,
        "relacion_dc_ac": round(p_fv / inv_e["potencia_nominal_ac_w"], 3),
        "bateria": {
            "configuracion": conf["id"],
            "tension_nominal_v": conf.get("tension_nominal_v"),
            "energia_util_kwh": conf["energia_util_kwh"],
            "potencia_nominal_w": conf.get("potencia_nominal_w"),
            "potencia_max_w": conf.get("potencia_max_w"),
        },
        "circuitos": circuitos_out,
        "errores": errores,
        "criterios": {
            "archivo": "templates/criterios_electricos.json",
            "estado": criterios["estado"],
        },
    }
    return {"propuesta": propuesta, "resultado": resultado}


def memoria(proyecto: dict[str, Any], r: dict[str, Any], biblioteca, entrada) -> str:
    inv = biblioteca[entrada["inversor"]]
    bat = biblioteca[entrada["bateria"]["componente"]]
    lineas = [
        f"# Memoria de cálculo eléctrico — {proyecto['nombre']}",
        "",
        "> **Borrador técnico.** Los factores, tablas y límites vienen de `templates/criterios_electricos.json`, "
        f"en estado **{r['criterios']['estado']}**: el ingeniero responsable debe confirmarlos contra NTC 2050 y RETIE.",
        "",
        "## Equipos",
        f"- Inversor: {inv['fabricante']} {inv['modelo']} ({inv['electrico']['potencia_nominal_ac_w'] / 1000:g} kW)",
        f"- Batería: {bat['fabricante']} {bat['modelo']}, configuración {r['bateria']['configuracion']}: "
        f"{r['bateria']['tension_nominal_v']} V, {r['bateria']['energia_util_kwh']} kWh útiles",
        f"- Generador FV: {r['potencia_fv_w'] / 1000:.2f} kWp; relación DC/AC {r['relacion_dc_ac']}",
        "",
        "## Temperaturas de diseño",
        f"- Mínima: {r['temperaturas_c']['minima']} °C · Ambiente máxima: {r['temperaturas_c']['max_ambiente']} °C · "
        f"Celda máxima (NOCT): {r['temperaturas_c']['max_celda']} °C",
        "",
        "## Strings",
        f"- Por módulo: Voc en frío {r['limites_string']['voc_frio_por_modulo_v']} V; "
        f"Vmp en caliente {r['limites_string']['vmp_caliente_por_modulo_v']} V",
        f"- Módulos por string: entre {r['limites_string']['n_min']} y {r['limites_string']['n_max']} "
        f"(máximo por {r['limites_string']['motivo_n_max']})",
        f"- Opciones válidas (1 string por MPPT): {r['opciones_strings']}",
        "",
        "| String | MPPT | Módulos | Voc frío (V) | Vmp caliente (V) | Isc (A) | Imp (A) |",
        "|---|---|---|---|---|---|---|",
    ]
    for f in r["strings"]:
        lineas.append(
            f"| {f['string']} | {f['mppt']} | {f['modulos']} | {f['voc_frio_v']} | {f['vmp_caliente_v']} | {f['isc_a']} | {f['imp_a']} |"
        )
    lineas += [
        "",
        "## Circuitos",
        "",
        "| Circuito | Tramo | I máx (A) | I conductor (A) | Calibre Cu (AWG) | Longitud est. (m) | Caída (%) | Protección |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for c in r["circuitos"]:
        lon = c["longitud_estimada_m"] if c["longitud_estimada_m"] is not None else "pendiente"
        caida = (
            f"{c['caida_pct']} (máx {c['limite_caida_pct']})"
            if c["caida_pct"] is not None
            else "pendiente"
        )
        lineas.append(
            f"| {c['id']} | {c['tramo']} | {c['corriente_max_a']} | {c['corriente_requerida_conductor_a']} | "
            f"{c['calibre_awg']} | {lon} | {caida} | {c['proteccion']} |"
        )
    lineas += ["", "## Resultado", ""]
    lineas += [f"- ❌ {e}" for e in r["errores"]] or [
        "- ✅ Sin errores con los criterios actuales."
    ]
    lineas += ["", "## Información faltante", ""] + [
        f"- {f}" for f in proyecto["informacion_faltante"]
    ]
    return "\n".join(lineas) + "\n"


def proponer(args: argparse.Namespace) -> int:
    carpeta = validar.DIR_PROYECTOS / args.id
    ruta = carpeta / "proyecto.json"
    proyecto = validar.cargar_json(ruta)
    entrada = validar.cargar_json(carpeta / "insumos" / "electrico.json")
    biblioteca = validar.cargar_biblioteca()
    criterios = validar.cargar_json(CRITERIOS)
    if proyecto.get("condiciones_diseno", {}).get("temperatura_min_c") is None:
        print("ERROR: faltan las temperaturas de diseño (condiciones_diseno)")
        return 1
    calc = calcular(proyecto, entrada, biblioteca, criterios)
    propuesta, r = calc["propuesta"], calc["resultado"]
    errores = validar.validar_proyecto(propuesta, ruta, biblioteca) + r["errores"]

    (carpeta / "salidas").mkdir(exist_ok=True)
    (carpeta / "salidas" / "calculo_electrico.json").write_text(jsonfmt.dumps(r), encoding="utf-8")
    (carpeta / "salidas" / "memoria_electrica.md").write_text(
        memoria(propuesta, r, biblioteca, entrada), encoding="utf-8"
    )
    (carpeta / "proyecto.propuesta.json").write_text(jsonfmt.dumps(propuesta), encoding="utf-8")

    print(
        f"Strings: {[f['modulos'] for f in r['strings']]} (opciones válidas: {r['opciones_strings']})"
    )
    for f in r["strings"]:
        print(
            f"  {f['string']}: {f['modulos']} módulos, Voc frío {f['voc_frio_v']} V, Vmp caliente {f['vmp_caliente_v']} V"
        )
    for c in r["circuitos"]:
        print(
            f"  {c['id']:12} {c['calibre_awg']:>4} AWG  {c['proteccion']}  caída {c['caida_pct']} %"
        )
    print(f"Memoria: {_rel(carpeta / 'salidas' / 'memoria_electrica.md')}")
    if errores:
        print("\nLa propuesta NO es válida:")
        for e in errores:
            print(f"  - {e}")
        return 1
    if args.aplicar:
        ruta.write_text(jsonfmt.dumps(propuesta), encoding="utf-8")
        (carpeta / "proyecto.propuesta.json").unlink()
        print("\nPropuesta aplicada a proyecto.json.")
    else:
        print("\nPropuesta válida. Revisar y aplicar con --aplicar.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.electrico")
    sub = parser.add_subparsers(dest="orden", required=True)
    p = sub.add_parser("proponer")
    p.add_argument("id")
    p.add_argument("--aplicar", action="store_true")
    p.set_defaults(funcion=proponer)
    args = parser.parse_args(argv)
    return args.funcion(args)


if __name__ == "__main__":
    sys.exit(main())
