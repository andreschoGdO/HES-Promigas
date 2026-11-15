"""Lámina de diagrama unifilar, desde el cálculo eléctrico (salidas/calculo_electrico.json).

Esquema para arquitectura en serie con contactor de transferencia (ATS / bypass) en el tablero FV:
red → medidor → protección → (a) puerto de red del inversor, (b) contactor de bypass → cargas;
puerto de respaldo del inversor → protección → cargas (tablero existente). Es un borrador:
el ingeniero responsable verifica protecciones, DPS, puesta a tierra y enclavamientos.
"""

from __future__ import annotations

from typing import Any

from engine.planos.lamina import Lamina


def _caja(lam, x, y, w, h, titulo, lineas=(), capa="UNIFILAR", trazo="continuo", relleno=None):
    lam.rect(x, y, w, h, capa, relleno=relleno, trazo=trazo)
    lam.texto((x + w / 2, y + h - 4), titulo, 2.4, "TEXTO", "centro", negrita=True)
    for i, linea in enumerate(lineas):
        lam.texto((x + w / 2, y + h - 8.5 - i * 3.6), linea, 1.9, "TEXTO", "centro")


def _interruptor(lam, x, y, etiqueta, capa="AC", vertical=False):
    """Símbolo de interruptor termomagnético sobre una línea horizontal en (x, y)."""
    lam.circulo((x - 2, y), 0.6, capa)
    lam.circulo((x + 2, y), 0.6, capa)
    lam.linea((x - 1.6, y + 0.4), (x + 2.4, y + 2.6), capa)
    lam.texto((x, y + 4), etiqueta, 1.8, "TEXTO", "centro")


def _cable(lam, a, b, capa, etiqueta=None, arriba=True):
    lam.linea(a, b, capa)
    if etiqueta:
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        lam.texto((mx, my + (1.5 if arriba else -3.5)), etiqueta, 1.7, capa, "centro")


def dibujar(lam: Lamina, area, proyecto: dict[str, Any], calc: dict[str, Any], biblioteca) -> None:
    x0, y0, aw, ah = area
    eq = {e["tipo"]: e for e in proyecto["equipos"] if e["tipo"] != "modulo"}
    inv = biblioteca[eq["inversor"]["componente_ref"]]
    bat = biblioteca[eq["bateria"]["componente_ref"]]
    med = biblioteca[eq["medidor"]["componente_ref"]] if "medidor" in eq else None
    circ = {c["id"]: c for c in calc["circuitos"]}
    # Textos de red, respaldo y conmutación desde el proyecto (no fijos)
    sis = proyecto["sistema"]
    v_linea = min(inv["electrico"]["tensiones_nominales_ac_v"])
    if sis.get("fases_red") == "trifasica":
        red_txt = f"3F {round(v_linea / 3**0.5)}/{v_linea:g} V"
    elif sis.get("fases_red") == "bifasica":
        red_txt = f"2F {v_linea:g} V"
    else:
        red_txt = f"1F {v_linea:g} V"
    resp_txt = {
        "respaldo_total": "respaldo total",
        "cargas_criticas_eps": "cargas críticas (EPS)",
    }.get(sis.get("respaldo"), "respaldo por definir")
    conm_txt = {"ats": "ATS", "bypass": "bypass", "smartguard": "SmartGuard"}.get(
        sis.get("conmutacion"), "por definir"
    )
    mod = next(e for e in proyecto["equipos"] if e["tipo"] == "modulo")
    modulo = biblioteca[mod["componente_ref"]]

    # --- Generador FV: un bloque por string
    sx, sw, sh = x0 + 4, 52, 20
    ys = []
    for i, s in enumerate(calc["strings"]):
        y = y0 + ah - 34 - i * (sh + 12)
        ys.append(y + sh / 2)
        _caja(
            lam,
            sx,
            y,
            sw,
            sh,
            f"STRING {s['string']}",
            [
                f"{s['modulos']} × {modulo['modelo']}",
                f"Voc frío {s['voc_frio_v']} V · Isc {s['isc_a']} A",
            ],
            "DC",
            relleno="#eef3fb",
        )

    # --- Inversor
    ix, iy, iw, ih = x0 + 120, y0 + ah - 112, 62, 84
    _caja(
        lam,
        ix,
        iy,
        iw,
        ih,
        "INVERSOR HÍBRIDO",
        [
            f"{inv['fabricante']} {inv['modelo']}",
            f"{inv['electrico']['potencia_nominal_ac_w'] / 1000:g} kW · "
            f"{inv['electrico']['conexion_red']}",
        ],
        relleno="#fbfbfb",
    )
    for i, (s, y) in enumerate(zip(calc["strings"], ys, strict=True)):
        c = circ[f"DC-{s['string']}"]
        yi = iy + ih - 22 - i * 9
        _cable(
            lam,
            (sx + sw, y),
            (ix - 20, y),
            "DC",
            f"{c['calibre_awg']} AWG Cu FV · L≈{c['longitud_estimada_m']} m",
        )
        lam.linea((ix - 20, y), (ix - 20, yi), "DC")
        lam.linea((ix - 20, yi), (ix, yi), "DC")
        lam.texto((ix + 2, yi), f"MPPT {s['mppt']}", 1.8, "TEXTO", "izq_medio")

    # --- Batería
    b = circ["DC-BAT"]
    conf = calc["bateria"]
    bx, by = ix + 2, y0 + 6
    _caja(
        lam,
        bx,
        by,
        iw - 4,
        26,
        "BATERÍA (BESS + BMS)",
        [
            f"{bat['fabricante']} {conf['configuracion'].upper()}",
            f"{conf['tension_nominal_v']} V · {conf['energia_util_kwh']} kWh útiles",
        ],
        "DC",
        relleno="#eef3fb",
    )
    xb = ix + iw / 2
    lam.linea((xb, by + 26), (xb, iy), "DC")
    _interruptor(lam, xb, (by + 26 + iy) / 2, "", "DC")
    lam.texto((xb + 4, (by + 26 + iy) / 2 - 3), f"{b['proteccion'].split(' (')[0]}", 1.8, "TEXTO")
    lam.texto(
        (xb + 4, (by + 26 + iy) / 2 - 6.5),
        f"{b['calibre_awg']} AWG Cu · L≈{b['longitud_estimada_m']} m",
        1.8,
        "DC",
    )
    lam.texto((ix + 2, iy + 6), "BAT", 1.8, "TEXTO", "izq_medio")

    # --- Tablero FV (punteado) con medidor, protecciones y contactor de bypass (ATS)
    tx, ty, tw, th = ix + iw + 34, iy - 6, 118, ih + 26
    lam.rect(tx, ty, tw, th, "UNIFILAR", trazo="discontinuo")
    lam.texto(
        (tx + 3, ty + th - 4),
        f"TABLERO FV (conmutación {conm_txt} + medidor)",
        2.3,
        "TEXTO",
        negrita=True,
    )
    red_y = ty + th - 18
    carga_y = ty + 22
    a_red, a_carga = circ["AC-RED"], circ["AC-CARGA"]
    # Puerto de red del inversor ← barra de red
    yr = iy + ih - 12
    lam.texto((ix + iw - 2, yr), "RED", 1.8, "TEXTO", "der")
    _cable(lam, (ix + iw, yr), (tx + 30, yr), "AC", f"3F+N+T {a_red['calibre_awg']} AWG")
    lam.linea((tx + 30, yr), (tx + 30, red_y), "AC")
    _interruptor(lam, tx + 30, (yr + red_y) / 2 + 3, "")
    lam.texto((tx + 33, (yr + red_y) / 2 + 1), a_red["proteccion"].replace("interruptor ", ""), 1.8)
    # Puerto de respaldo del inversor → barra de cargas
    yl = iy + 14
    lam.texto((ix + iw - 2, yl), "CARGA", 1.8, "TEXTO", "der")
    _cable(
        lam,
        (ix + iw, yl),
        (tx + 30, yl),
        "AC",
        f"3F+N+T {a_carga['calibre_awg']} AWG",
        arriba=False,
    )
    lam.linea((tx + 30, yl), (tx + 30, carga_y), "AC")
    _interruptor(lam, tx + 30, (yl + carga_y) / 2, "")
    lam.texto(
        (tx + 33, (yl + carga_y) / 2 - 2), a_carga["proteccion"].replace("interruptor ", ""), 1.8
    )
    # Barras
    lam.linea((tx + 10, red_y), (tx + tw - 8, red_y), "AC")
    lam.texto((tx + 10, red_y + 1.5), f"Barra red {red_txt}", 1.7, "AC")
    lam.linea((tx + 10, carga_y), (tx + tw - 8, carga_y), "AC")
    lam.texto((tx + 42, carga_y - 4), f"Barra cargas ({resp_txt})", 1.7, "AC")
    # Contactor de bypass (ATS) entre barras
    kx = tx + 78
    lam.linea((kx, red_y), (kx, carga_y), "AC")
    lam.rect(kx - 6, (red_y + carga_y) / 2 - 5, 12, 10, "UNIFILAR", relleno="#ffffff")
    lam.texto((kx, (red_y + carga_y) / 2), "K1", 2.4, "TEXTO", "centro", negrita=True)
    lam.texto((kx + 8, (red_y + carga_y) / 2 + 2), "Contactor de", 1.7)
    lam.texto((kx + 8, (red_y + carga_y) / 2 - 1.5), "transferencia /", 1.7)
    lam.texto((kx + 8, (red_y + carga_y) / 2 - 5), f"bypass ({conm_txt})", 1.7)
    # Medidor en la acometida
    my_ = red_y + 9
    lam.linea((tx + tw - 8, red_y), (tx + tw - 8, my_), "AC")
    lam.circulo((tx + tw - 8, my_ + 4), 4, "UNIFILAR", relleno="#ffffff")
    lam.texto((tx + tw - 8, my_ + 4), "kWh", 1.8, "TEXTO", "centro")
    if med:
        lam.texto(
            (tx + tw - 14, my_ + 4),
            f"{med['marca'].upper()} {med['modelo'].split(' ')[0]}",
            1.7,
            "TEXTO",
            "der",
        )
    # Red del operador (dentro del área de dibujo)
    lam.linea((tx + tw - 8, my_ + 8), (tx + tw - 8, y0 + ah - 2), "AC")
    lam.texto(
        (tx + tw - 11, y0 + ah - 4),
        f"RED DEL OPERADOR {red_txt}",
        2.0,
        "TEXTO",
        "der",
        negrita=True,
    )
    # Tablero existente
    e = circ["AC-EXISTENTE"]
    lam.linea((tx + tw - 8, carga_y), (tx + tw - 8, y0 + 8), "AC")
    largo = f"L≈{e['longitud_estimada_m']} m" if e["longitud_estimada_m"] else "longitud pendiente"
    lam.texto(
        (tx + tw - 6, (carga_y + y0 + 8) / 2),
        f"{e['calibre_awg']} AWG · baja por buitrón · {largo}",
        1.7,
        "AC",
        rotacion=90,
    )
    _caja(lam, tx + tw - 40, y0, 46, 9, "TABLERO EXISTENTE", relleno="#ffffff")

    # --- Cuadro de características (como en los planos de referencia)
    filas = [
        ("Módulo", modulo["modelo"]),
        ("Potencia DC", f"{calc['potencia_fv_w'] / 1000:.2f} kWp"),
        ("Potencia AC", f"{inv['electrico']['potencia_nominal_ac_w'] / 1000:g} kW"),
        ("Cantidad de módulos", str(sum(s["modulos"] for s in calc["strings"]))),
        ("Isc de diseño (bifacial)", f"{calc['strings'][0]['isc_a']} A"),
        ("Voc máx. por string", f"{max(s['voc_frio_v'] for s in calc['strings'])} V"),
        ("Corriente AC máx.", f"{a_red['corriente_max_a']} A"),
        ("Relación DC/AC", str(calc["relacion_dc_ac"])),
    ]
    cx, cy = x0 + 4, y0 + 6
    lam.rect(cx, cy, 104, 7 + 5 * len(filas), "CAJETIN")
    lam.texto((cx + 3, cy + 3 + 5 * len(filas)), "CARACTERÍSTICAS ELÉCTRICAS", 2.4, negrita=True)
    for i, (k, v) in enumerate(reversed(filas)):
        lam.texto((cx + 3, cy + 2 + i * 5), k, 2.0, "NOTA")
        lam.texto((cx + 58, cy + 2 + i * 5), v, 2.0)
    lam.texto(
        (cx, cy - 4),
        "Criterios de cálculo por confirmar contra NTC 2050 y RETIE (templates/criterios_electricos.json).",
        1.7,
        "NOTA",
    )
