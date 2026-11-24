"""Diagramas unifilares de las casas del piloto (formato de las guías, cajetín Promigas).

Por casa solo cambian las cadenas (strings), el inversor, la potencia y el banco de baterías; los
calibres de conductores y los componentes del tablero fotovoltaico son los de la guía de cada
familia de inversor (``FAMILIAS``), tomados de los unifilares de ejemplo entregados por el usuario.

Uso::

    python -m engine.planos.unifilar_casas <Seguimiento.xlsx> --proyecto "Verde Diamante" --casa 12
    python -m engine.planos.unifilar_casas <Seguimiento.xlsx> --todas

Salida: PDF A3 por casa en ``unifilares/privado/`` (lleva el nombre del diseñador).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from engine import validar
from engine.planos import cajetin
from engine.planos.lamina import CAPAS, Lamina, a_pdf
from engine.planos.textos import fabricante_corto
from engine.simulacion import pvsyst

CAPAS.update(
    {
        "PROTECCION": (30, "#e67e22", 0.3),
        "BARRA": (5, "#2a6fb5", 1.2),
        "TIERRA": (3, "#1e9e3e", 0.25),
        "COMUNIC": (4, "#0097a7", 0.25),
        "CONTROL": (6, "#b03cb0", 0.25),
        "ROJO": (1, "#a01818", 0.25),
        "AMARILLO": (2, "#e6c200", 0.25),
    }
)

DEPARTAMENTO = {"CARTAGENA": "Bolívar", "TURBACO": "Bolívar", "CALI": "Valle del Cauca"}
MODULO_REF = "ja-solar-jam72d40-595-mb"
SALIDA = validar.RAIZ / "unifilares" / "privado"

# Valores fijos por familia, tomados de las guías (unifilares de ejemplo del usuario).
_CU_F6 = "3N° 6 AWG (F) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR"
FAMILIAS: dict[str, dict[str, Any]] = {
    "deye15kw": {
        "inversor": "deye-sun-15k-sg01hp3-us-am2",
        "bateria": "deye-gb-l",
        "bateria_txt": "DEYE GB-L",
        "tension": "220 V",
        "tablero": [
            "TABLERO FOTOVOLTAICO Y TRANSFERENCIA",
            "220V - 15 KW - 10 KA - IP66",
            "80X40X20 CM",
        ],
        "alim_inversor": [
            _CU_F6,
            "1N° 6 AWG (N) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR",
            "1N° 8 AWG (T) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR verde",
            'Coraza 1½"   L=0.6 metros',
        ],
        "alim_dps": [
            "3N° 8 AWG (F) Al - THHN/THWN-2 @90°C - 0.6 kV - SR",
            "1N° 8 AWG (N) Al - THHN/THWN-2 @90°C - 0.6 kV - SR",
            "1N° 8 AWG (T) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR",
        ],
        "alim_principal": [
            "3N° 4 AWG (F) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR",
            "1N° 4 AWG (N) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR",
            "1N° 8 AWG (T) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR verde",
            'Tubería IMC, Coraza ó SCH40 de 2"   L=10 metros',
        ],
        "breakers": {"dps": "3x32 A", "rele": "3x6 A", "red": "3x50 A", "carga": "3x50 A"},
        "contactor": "220V - 3X70 A",
        "cable_dc": "2xNo.4mm² PV (+),(-)",
        "cable_bateria": [
            "Cable que viene",
            "con batería EP",
            "Cable 2.0 +/-",
            'Coraza 1"',
            "L=1.5 metros",
        ],
    },
}
FAMILIAS["livoltek10kw"] = {
    **FAMILIAS["deye15kw"],
    "inversor": "livoltek-hp3-10kl2",
    "bateria": "livoltek-bhf",
    "bateria_txt": "LIVOLTEK BHF",
    "tablero": ["TABLERO FOTOVOLTAICO", "220 V - 15 KW 10 KA IP66", "70X50X30 CM"],
    "alim_inversor": [
        "3No 6 (F) Al-AWG THHN/THWN @75°C",
        "1No 6 (N) Al-AWG THHN/THWN @75°C",
        "1No 6 (T) Al-AWG THHN/THWN @75°C",
        'TUBO IMC DE 1½"   L: 1m',
    ],
    "breakers": {"dps": "3x32 A", "rele": "2x5 A", "red": "3x50 A", "carga": "3x50 A"},
}
FAMILIAS["livoltek15kw"] = {**FAMILIAS["livoltek10kw"], "inversor": "livoltek-hp3-15kl2"}


# ------------------------------------------------------------------------------------- datos
def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]", "", s).upper()


def datos_casa(casa: dict[str, Any], fila_plan: dict[str, Any], biblioteca) -> dict[str, Any]:
    """Junta Excel + plan de strings + biblioteca en los datos que dibuja la lámina."""
    familia = pvsyst._clave_inversor(casa["inversor"])
    if familia not in FAMILIAS:
        raise ValueError(f"sin guía de unifilar para el inversor {casa['inversor']!r} (aún)")
    fam = FAMILIAS[familia]
    inv = biblioteca[fam["inversor"]]
    bat = biblioteca[fam["bateria"]]
    mod = biblioteca[MODULO_REF]
    n_bat, torres = int(casa["baterias"]), int(casa["bms"] or 1)
    mb = bat["electrico"]["modulo_bateria"]
    por_torre = n_bat / torres
    avisos = []
    if por_torre != int(por_torre):
        avisos.append(f"{n_bat} módulos de batería no se reparten parejo en {torres} torres")
    if por_torre > bat["electrico"]["max_modulos_por_sistema_en_paralelo"]:
        avisos.append(
            f"{por_torre:g} módulos por torre > máximo "
            f"{bat['electrico']['max_modulos_por_sistema_en_paralelo']} de la ficha"
        )
    strings = [int(x) for x in str(fila_plan["strings"]).split("+")]
    pan = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    tmin = pvsyst.TMIN_C.get(casa["ciudad"], 10.0)
    me = mod["electrico"]
    ie = inv["electrico"]
    return {
        **casa,
        "familia": familia,
        "fam": fam,
        "inversor_modelo": inv["modelo"],
        "inv": ie,
        "modulo": mod,
        "strings": strings,
        "tmin": tmin,
        "voc_tmin": [round(n * pan.voc_a(tmin), 1) for n in strings],
        "vmp_60": [round(n * pan.vmp_a(60), 1) for n in strings],
        "vmp_20": [round(n * pan.vmp_a(20), 1) for n in strings],
        "isc": me["isc_a"],
        "imp": me["imp_a"],
        "kwp": round(casa["modulos"] * me["potencia_stc_w"] / 1000, 2),
        "ratio": round(casa["modulos"] * me["potencia_stc_w"] / ie["potencia_nominal_ac_w"], 2),
        "bat": {
            "marca": fabricante_corto(bat),
            "texto": fam["bateria_txt"],
            "modulo": mb["modelo"],
            "kwh_modulo": mb["energia_kwh"],
            "v_modulo": mb["tension_nominal_v"],
            "n": n_bat,
            "torres": torres,
            "por_torre": int(por_torre) if por_torre == int(por_torre) else por_torre,
            "v_sistema": round(mb["tension_nominal_v"] * por_torre, 1),
            "kwh": round(n_bat * mb["energia_kwh"], 2),
            "kwh_util": round(
                n_bat * mb["energia_kwh"] * bat["electrico"]["profundidad_descarga_pct"] / 100, 2
            ),
            "corriente": bat["electrico"]["corriente_nominal_a"],
            "dod": bat["electrico"]["profundidad_descarga_pct"],
        },
        "avisos": avisos,
    }


# ------------------------------------------------------------------------------------- símbolos
def _breaker(lam: Lamina, x: float, y: float, rotulo: str, abajo=True) -> None:
    """Interruptor termomagnético horizontal entre x y x+12 a la altura y."""
    lam.polilinea(
        [(x, y + 0.9), (x + 1.4, y), (x, y - 0.9)], "PROTECCION", cerrada=True, relleno="#e67e22"
    )
    lam.linea((x + 1.4, y), (x + 3, y), "PROTECCION")
    lam.linea((x + 3, y - 0.5), (x + 8.5, y + 2), "PROTECCION")
    lam.circulo((x + 9, y), 0.6, "PROTECCION")
    lam.linea((x + 9.6, y), (x + 12, y), "PROTECCION")
    lam.rect(x + 3.2, y - 2.2, 1, 1, "PROTECCION")
    lam.linea((x + 3.7, y - 1.2), (x + 3.7, y - 0.3), "PROTECCION")
    if rotulo:
        dy = -5 if abajo else 3.4
        lam.texto((x + 6, y + dy), rotulo, 1.7, "TEXTO", "centro")
        lam.texto((x + 6, y + dy - 2.3), "Ics: 10kA - 220 VAC", 1.4, "TEXTO", "centro")


def _kwh(lam: Lamina, x: float, y: float, w=9.0, h=6.0, capa="PROTECCION") -> None:
    lam.rect(x, y, w, h, capa)
    lam.linea((x, y + h - 1.3), (x + w, y + h - 1.3), capa)
    lam.texto((x + w / 2, y + (h - 1.3) / 2), "kWh", 2.2, "TEXTO", "centro")


def _alimentador(lam: Lamina, x: float, y: float, lineas: list[str], h=1.25, capa="TEXTO") -> None:
    for i, t in enumerate(lineas):
        lam.texto((x, y - i * (h + 0.55)), t, h, capa)


def _marcas_fases(lam: Lamina, x: float, y: float, n=3) -> None:
    for i in range(n):
        lam.linea((x + i * 1.4, y - 1), (x + i * 1.4 + 1.2, y + 1), "PROTECCION")


def _tabla(lam: Lamina, x, y_top, ancho, titulo, filas, col=0.62, h=3.0) -> float:
    """Tabla de dos columnas con encabezado gris. Devuelve la y inferior."""
    lam.rect(x, y_top - h, ancho, h, "CAJETIN", relleno="#d9d9d9")
    lam.texto((x + ancho / 2, y_top - h / 2), titulo, 1.7, "TEXTO", "centro", negrita=True)
    y = y_top - h
    lam.rect(x, y - h, ancho, h, "CAJETIN", relleno="#efefef")
    lam.texto((x + ancho * col / 2, y - h / 2), "Parámetro", 1.5, "TEXTO", "centro", negrita=True)
    lam.texto((x + ancho * (1 + col) / 2, y - h / 2), "Valor", 1.5, "TEXTO", "centro", negrita=True)
    y -= h
    for k, v in filas:
        lam.texto((x + 1.2, y - h / 2), k, 1.45, "TEXTO", "izq_medio")
        tam = 1.45 if len(str(v)) <= 16 else max(1.0, 1.45 * 16 / len(str(v)))
        lam.texto((x + ancho * (1 + col) / 2, y - h / 2), str(v), tam, "TEXTO", "centro")
        lam.linea((x, y - h), (x + ancho, y - h), "NOTA")
        y -= h
    lam.rect(x, y, ancho, y_top - y, "CAJETIN")
    lam.linea((x + ancho * col, y), (x + ancho * col, y_top - h), "NOTA")
    return y


def _f(v, d=2) -> str:
    return f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


# ------------------------------------------------------------------------------------- lámina
def dibujar(lam: Lamina, d: dict[str, Any]) -> None:
    fam, ie, b = d["fam"], d["inv"], d["bat"]
    me = d["modulo"]["electrico"]
    pnom_ac = ie["potencia_nominal_ac_w"] / 1000

    lam.texto(
        (128, 258.5),
        f"DIAGRAMA UNIFILAR PROYECTO SOLAR CASA {d['casa']} - {d['proyecto'].upper()}",
        3.6,
        "TEXTO",
        "centro",
        negrita=True,
    )

    # ---------------------------------------------------------------- columna izquierda: tablas
    x0, w0 = 13, 68
    lam.texto(
        (x0 + w0 / 2, 249.5),
        "CARACTERÍSTICAS DE LA INSTALACIÓN",
        2.2,
        "TEXTO",
        "centro",
        negrita=True,
    )
    y = _tabla(
        lam,
        x0,
        247,
        w0,
        "CARACTERÍSTICAS DEL SISTEMA",
        [
            ("Número de módulos", d["modulos"]),
            ("Cantidad de inversores", 1),
            ("Potencia total AC (kW)", _f(pnom_ac)),
            ("Potencia total DC (kWp)", _f(d["kwp"])),
            ("Ratio DC/AC", _f(d["ratio"], 3)),
            ("Baterías (módulos)", b["n"]),
            ("Almacenamiento (kWh)", _f(b["kwh"])),
        ],
    )
    y = _tabla(
        lam,
        x0,
        y - 2,
        w0,
        "CARACTERÍSTICAS DE LOS MÓDULOS SOLARES",
        [
            ("Referencia", d["modulo"]["modelo"]),
            ("Potencia módulo solar", f"{me['potencia_stc_w']:g} Wp"),
            ("Isc (A)", _f(me["isc_a"])),
            ("Voc (V DC)", _f(me["voc_v"])),
            ("Vmp (V DC)", _f(me["vmp_v"])),
            ("Imp (A)", _f(me["imp_a"])),
        ],
    )
    y = _tabla(
        lam,
        x0,
        y - 2,
        w0,
        "CARACTERÍSTICAS DEL INVERSOR",
        [
            ("Referencia", d["inversor_modelo"]),
            ("Voc máx. (V)", f"{ie['tension_max_dc_v']:g}"),
            ("Rango MPPT (V)", f"{ie['rango_mppt']['min_v']:g} - {ie['rango_mppt']['max_v']:g}"),
            ("Número de MPPT", ie["numero_mppt"]),
            ("Imp máx. por MPPT (A)", f"{ie['corriente_max_entrada_por_mppt_a']:g}"),
            ("Pot. máx. AC (W)", f"{ie['potencia_nominal_ac_w']:,.0f}".replace(",", ".")),
            ("Corriente máx. AC (A)", f"{ie['corriente_max_salida_ac_a']:g}"),
        ],
    )
    y = _tabla(
        lam,
        x0,
        y - 2,
        w0,
        "CARACTERÍSTICAS DE BATERÍAS",
        [
            ("Marca / módulo", f"{b['marca']} {b['modulo']}"),
            ("Química de celda", "LiFePO4"),
            ("Energía por módulo (kWh)", _f(b["kwh_modulo"])),
            ("Voltaje nominal módulo (V)", _f(b["v_modulo"], 1)),
            ("Módulos en serie (por torre)", b["por_torre"]),
            ("Torres en paralelo (BMS)", b["torres"]),
            ("Voltaje del sistema (V)", _f(b["v_sistema"], 1)),
            ("Energía total instalada (kWh)", _f(b["kwh"])),
            (f"Energía útil ({b['dod']} % DOD) (kWh)", _f(b["kwh_util"])),
            ("Corriente nom. carga/descarga (A)", b["corriente"]),
        ],
    )
    # Configuración por MPPT con verificaciones
    yc = y - 3
    lam.texto((x0 + w0 / 2, yc), "CONFIGURACIÓN POR MPPT", 1.8, "TEXTO", "centro", negrita=True)
    cols = [
        ("MPPT", 9),
        ("Serie", 8),
        ("Wp", 11),
        ("Voc", 10),
        ("Vmp", 10),
        ("Isc", 10),
        ("Imp", 10),
    ]
    yy = yc - 2
    xx = x0
    for t, cw in cols:
        lam.rect(xx, yy - 3, cw, 3, "CAJETIN", relleno="#efefef")
        lam.texto((xx + cw / 2, yy - 1.5), t, 1.35, "TEXTO", "centro", negrita=True)
        xx += cw
    lim = ie["rango_mppt"]
    for i in range(ie["numero_mppt"]):
        yy -= 3
        n = d["strings"][i] if i < len(d["strings"]) else 0
        if n:
            ok = [
                d["voc_tmin"][i] <= ie["tension_max_dc_v"],
                d["vmp_60"][i] >= lim["min_v"] and d["vmp_20"][i] <= lim["max_v"],
                d["isc"] <= ie["corrientes_cortocircuito_por_mppt_a"][i]
                if "corrientes_cortocircuito_por_mppt_a" in ie
                else True,
                d["imp"] <= ie["corriente_max_entrada_por_mppt_a"],
            ]
            vals = [f"{i + 1}", n, f"{n * me['potencia_stc_w']:,.0f}".replace(",", ".")] + [
                "CUMPLE" if o else "NO CUMPLE" for o in ok
            ]
        else:
            vals = [f"{i + 1}", "-", "0", "-", "-", "-", "-"]
        xx = x0
        for (_, cw), v in zip(cols, vals, strict=True):
            lam.rect(xx, yy - 3, cw, 3, "CAJETIN")
            lam.texto(
                (xx + cw / 2, yy - 1.5),
                str(v),
                1.25,
                "ROJO" if v == "NO CUMPLE" else "TEXTO",
                "centro",
            )
            xx += cw
    lam.texto(
        (x0, yy - 5),
        f"Voc a {d['tmin']:g} °C (mín. del sitio); Vmp a 60 °C y 20 °C.",
        1.25,
        "NOTA",
    )
    y_conf = yy - 5

    # ---------------------------------------------------------------- inversor
    ix, iy, iw, ih = 104, 112, 58, 118
    lam.texto((ix, iy + ih + 10), "INVERSOR 1", 2.0, "TEXTO")
    lam.texto((ix, iy + ih + 7), d["inversor_modelo"], 2.0, "TEXTO")
    lam.texto((ix, iy + ih + 4), fam["tension"], 2.0, "TEXTO")
    lam.rect(ix + 36, iy + ih + 1, 22, 4, "TEXTO")
    lam.texto((ix + 47, iy + ih + 3), f"Potencia: {_f(d['kwp'])} kWp", 1.5, "TEXTO", "centro")
    lam.rect(ix, iy, iw, ih, "AC")
    # Puertos inferiores
    puertos = [
        ("PE", 7),
        ("BATERÍA\n+/-", 12),
        ("BMS\nPORT", 11),
        ("METER", 11),
        ("LOAD AC\n(CARGA CRÍTICA)", 17),
    ]
    xx = ix
    centros = {}
    for t, cw in puertos:
        lam.rect(xx, iy, cw, 10, "AC")
        for k, linea in enumerate(t.split("\n")):
            lam.texto(
                (xx + cw / 2, iy + 7.8 - k * 2.4), linea, 1.5 if cw > 7 else 1.2, "TEXTO", "centro"
            )
        centros[t.split("\n")[0]] = xx + cw / 2
        lam.circulo((xx + cw / 2, iy + 2), 0.8, "PROTECCION", relleno="#e67e22")
        xx += cw
    # DC switch y MPPT
    n_mppt = ie["numero_mppt"]
    ds_x = ix + 6
    lam.rect(ds_x, iy + 16, 6, ih - 22, "UNIFILAR")
    lam.texto((ds_x + 3, iy + 13.5), "DC SWITCH", 1.4, "ROJO", "centro", negrita=True)
    alto_m = (ih - 26) / n_mppt
    entradas_y: list[list[float]] = []
    for m in range(n_mppt):
        top = iy + ih - 6 - m * alto_m
        bx, by = ix + 17, top - alto_m * 0.62
        lam.rect(bx, by, 13, alto_m * 0.45, "UNIFILAR")
        lam.texto((bx + 6.5, by + alto_m * 0.225), f"MPPT{m + 1}", 1.5, "TEXTO", "centro")
        ys = []
        for k in range(2):
            yy = top - 2 - k * alto_m * 0.42
            lam.rect(ix - 1, yy - 0.8, 1.6, 1.6, "PROTECCION")
            lam.linea((ix + 0.6, yy), (ds_x + 3, yy), "UNIFILAR")
            lam.linea((ds_x + 3, yy), (ds_x + 5.5, yy + 1.5), "PROTECCION")
            y_in = by + alto_m * 0.45 * (0.75 if k == 0 else 0.25)
            x_q = bx - 3 + k * 1.5
            lam.linea((ds_x + 6, yy), (x_q, yy), "UNIFILAR")
            lam.linea((x_q, yy), (x_q, y_in), "UNIFILAR")
            lam.linea((x_q, y_in), (bx, y_in), "UNIFILAR")
            ys.append(yy)
        entradas_y.append(ys)
        lam.linea((bx + 13, by + alto_m * 0.3), (ix + 36, by + alto_m * 0.3), "UNIFILAR")
        lam.linea((ix + 36, by + alto_m * 0.3), (ix + 36, iy + 60), "UNIFILAR")
    # Conversor DC/AC
    cx, cy = ix + 36, iy + 50
    lam.rect(cx, cy, 13, 13, "AC")
    lam.linea((cx, cy), (cx + 13, cy + 13), "AC")
    lam.texto((cx + 3.5, cy + 10), "=", 2.2, "TEXTO", "centro")
    lam.texto((cx + 9.5, cy + 2.5), "~", 2.4, "TEXTO", "centro")
    y_red = cy + 9
    lam.linea((cx + 13, y_red), (ix + iw, y_red), "UNIFILAR")
    lam.texto((ix + iw - 1, iy + 13), f"RATIO: {_f(d['ratio'])}", 1.8, "ROJO", "der")
    lam.texto((cx + 14, cy - 3), "SPD de CA", 1.3, "TEXTO")

    # ---------------------------------------------------------------- cadenas (strings)
    for m, n in enumerate(d["strings"]):
        yy = entradas_y[m][0]
        sx = 84
        for k in range(3):
            lam.rect(sx + k * 4.2, yy + 1.3, 3.6, 2.6, "MODULO", relleno="#a8ecd8")
        lam.texto((sx + 13.2, yy + 2.6), "…", 1.4, "TEXTO")
        lam.linea((sx + 6, yy), (ix - 1, yy), "DC")
        lam.linea((sx, yy + 2.6), (sx - 1, yy + 2.6), "TIERRA")
        lam.texto((sx + 1, yy + 5.5), f"Cadena x {n} paneles en serie", 1.15, "TEXTO")
        lam.texto((sx + 15, yy + 2.2), f"S1.{m + 1}.1+/-", 1.15, "ROJO")
        lam.texto((sx + 1, yy - 2), fam["cable_dc"], 1.1, "TEXTO")
        lam.texto((sx + 1, yy - 3.9), f"Imax = {_f(d['isc'])} A", 1.1, "TEXTO")
        lam.texto(
            (sx + 1, yy - 5.8), f"Voc({d['tmin']:g}°C) = {_f(d['voc_tmin'][m], 1)} V", 1.1, "TEXTO"
        )
        lam.texto((sx + 1, yy - 7.7), f"Vmp(60°C) = {_f(d['vmp_60'][m], 1)} V", 1.1, "TEXTO")
        lam.texto((sx + 1, yy - 9.6), f"{n}x595 Wp ({_f(n * 0.595)} kWp)", 1.1, "TEXTO")
    # Notas de puesta a tierra
    for k, t in enumerate(
        [
            "Toda la estructura de los paneles se debe equipotencializar,",
            "bien sea con el cable que se indica o con otro medio que",
            "garantice la conexión sólida de estos a tierra.",
            "La conexión del cable de cobre desnudo de tierra a cualquier",
            "borna se debe realizar con terminal certificada.",
        ]
    ):
        lam.texto((x0, y_conf - 4 - k * 2.1), t, 1.15, "NOTA")
    # Tierra general (PE → estructura y batería)
    pe = centros["PE"]
    lam.linea((pe, iy + 2), (pe, iy - 6), "TIERRA")
    lam.linea((86, iy - 6), (pe, iy - 6), "TIERRA")
    lam.linea((86, iy - 6), (86, entradas_y[-1][0] + 2.6) if d["strings"] else (86, iy), "TIERRA")
    lam.texto(
        (85, iy + 2), "Puesta a tierra de los paneles · 8 AWG Cu verde", 1.15, "TIERRA", rotacion=90
    )

    # ---------------------------------------------------------------- batería
    bx, by = 120, 58
    lam.rect(bx, by, 26, 30, "AC")
    lam.texto((bx + 1, by + 27), f"{b['texto']} {_f(b['kwh'])} kWh", 1.45, "TEXTO", negrita=True)
    lam.linea((bx, by + 25), (bx + 26, by + 25), "AC")
    lam.texto((bx + 1, by + 22), f"{b['n']} módulos {b['modulo']}", 1.3, "TEXTO")
    lam.texto(
        (bx + 1, by + 19.5),
        f"{b['torres']} BMS · {b['torres']} torre(s) de {b['por_torre']}",
        1.3,
        "TEXTO",
    )
    lam.texto((bx + 1, by + 17), f"{_f(b['v_sistema'], 1)} V nominal", 1.3, "TEXTO")
    for k in range(4):
        lam.linea((bx, by + 3 + k * 3.4), (bx + 26, by + 3 + k * 3.4), "NOTA")
    xb = centros["BATERÍA"]
    lam.linea((xb, iy + 2), (xb, by + 30), "DC")
    lam.rect(xb - 2, by + 32, 4, 5, "UNIFILAR")
    lam.texto((xb + 3, by + 35), "Caja con bornas", 1.1, "TEXTO")
    lam.texto((xb + 3, by + 33), "> 60 A DC, > 500 VDC", 1.1, "TEXTO")
    for k, t in enumerate(fam["cable_bateria"]):
        lam.texto((xb - 1.5, iy - 3 - k * 2), t, 1.15, "TEXTO", "der")
    xbm = centros["BMS"]
    lam.linea((xbm, iy + 2), (xbm, by + 30), "COMUNIC", trazo="discontinuo")
    lam.texto((xbm + 1.5, iy - 6), "Cable RS485", 1.15, "TEXTO")
    lam.texto((xbm + 1.5, iy - 8), "Azul / Blanco", 1.15, "TEXTO")
    lam.texto((xbm + 1.5, iy - 10), 'Coraza ½"', 1.15, "TEXTO")
    lam.linea((86, iy - 6), (86, by + 2), "TIERRA")
    lam.linea((86, by + 2), (bx, by + 2), "TIERRA")

    # ---------------------------------------------------------------- tablero FV
    tx, ty, tw, th = 204, 103, 133, 140
    for k, t in enumerate(fam["tablero"]):
        lam.texto((tx, ty + th + 9 - k * 2.6), t, 1.8, "TEXTO")
    lam.rect(tx, ty, tw, th, "AC")
    lam.rect(tx + 2, ty + th - 9, 5, 5, "PROTECCION")
    lam.texto(
        (tx + 8, ty + th - 6),
        "Kit ventilación, anticondensación y control de humedad",
        1.25,
        "TEXTO",
    )
    b1x = tx + 52
    y_dps, y_rele, y_carga1 = ty + 118, ty + 96, y_red
    lam.rect(b1x - 1, y_carga1 - 22, 2.2, y_dps - y_carga1 + 30, "BARRA", relleno="#2a6fb5")
    for k, t in enumerate(["Bornas de barraje 1  100 A", "220 V", "5H (3F + N + T)", "60 Hz"]):
        lam.texto((b1x + 3, y_dps + 8 - k * 2.6), t, 1.6, "TEXTO")
    br = fam["breakers"]
    # DPS
    _alimentador(lam, tx + 2, y_dps + 9, fam["alim_dps"], 1.05)
    lam.linea((tx + 2, y_dps), (tx + 30, y_dps), "PROTECCION")
    lam.rect(tx + 8, y_dps - 1, 5, 2, "PROTECCION")
    for k in range(3):
        lam.linea((tx + 2 + k * 0.6, y_dps - 1.2), (tx + 2 + k * 0.6, y_dps + 1.2), "PROTECCION")
    _marcas_fases(lam, tx + 16, y_dps)
    for k, t in enumerate(
        [
            "DPS Tipo 1+2",
            "Limp: 12.5kA (10/350µs)",
            "In >= 20kA (8/20µs)",
            "Imax >= 50kA (8/20µs)",
            "Uc: 220V",
        ]
    ):
        lam.texto((tx + 10, y_dps - 3 - k * 1.9), t, 1.15, "TEXTO", "centro")
    _breaker(lam, tx + 30, y_dps, br["dps"])
    lam.linea((tx + 42, y_dps), (b1x, y_dps), "UNIFILAR")
    # Relé de mínima tensión
    lam.rect(tx + 4, y_rele - 3, 22, 6, "PROTECCION")
    lam.texto((tx + 15, y_rele + 1.2), "Relé mínima tensión", 1.25, "TEXTO", "centro")
    lam.texto((tx + 15, y_rele - 1.2), "220 V set 180 V  R1", 1.25, "TEXTO", "centro")
    lam.linea((tx + 26, y_rele), (tx + 30, y_rele), "PROTECCION")
    _breaker(lam, tx + 30, y_rele, br["rele"])
    lam.linea((tx + 42, y_rele), (b1x, y_rele), "UNIFILAR")
    # Interruptor de red del inversor (GRID) y alimentador desde el inversor
    lam.linea((ix + iw, y_carga1), (tx + 30, y_carga1), "UNIFILAR")
    _marcas_fases(lam, ix + iw + 8, y_carga1)
    _alimentador(lam, ix + iw + 2, y_carga1 - 3, fam["alim_inversor"], 1.0)
    _breaker(lam, tx + 30, y_carga1, br["red"])
    lam.linea((tx + 42, y_carga1), (b1x, y_carga1), "UNIFILAR")
    # Barraje 2 (carga crítica) e interruptor del LOAD
    y_carga2 = ty + 14
    xl = centros["LOAD AC"]
    lam.linea((xl, iy + 2), (xl, iy - 3), "UNIFILAR")
    lam.linea((xl, iy - 3), (tx - 6, iy - 3), "UNIFILAR")
    lam.linea((tx - 6, iy - 3), (tx - 6, y_carga2), "UNIFILAR")
    lam.linea((tx - 6, y_carga2), (tx + 30, y_carga2), "UNIFILAR")
    _alimentador(lam, ix + iw + 2, iy - 6, fam["alim_inversor"], 1.0)
    _breaker(lam, tx + 30, y_carga2, br["carga"])
    lam.linea((tx + 42, y_carga2), (b1x, y_carga2), "UNIFILAR")
    lam.rect(b1x - 1, y_carga2 - 6, 2.2, 12, "BARRA", relleno="#2a6fb5")
    for k, t in enumerate(["Bornas de barraje 2  100 A", "220 V", "5H (3F + N + T)", "60 Hz"]):
        lam.texto((b1x + 3, y_carga2 + 16 - k * 2.6), t, 1.6, "TEXTO")
    # Medidor del inversor (METER)
    _kwh(lam, b1x + 8, y_carga1 - 16, capa="AC")
    lam.texto((b1x + 12.5, y_carga1 - 18.5), "METER", 1.3, "TEXTO", "centro")
    lam.linea((b1x + 1, y_carga1 - 6), (b1x + 12.5, y_carga1 - 6), "UNIFILAR")
    lam.linea((b1x + 12.5, y_carga1 - 6), (b1x + 12.5, y_carga1 - 10), "UNIFILAR")
    lam.texto((b1x + 2, y_carga1 - 5), "3X10F+10N+12T Cu", 1.1, "TEXTO")
    xm = centros["METER"]
    lam.linea((xm, iy + 2), (xm, iy - 14), "CONTROL")
    lam.linea((xm, iy - 14), (tx - 9, iy - 14), "CONTROL")
    lam.linea((tx - 9, iy - 14), (tx - 9, y_carga1 - 13), "CONTROL")
    lam.linea((tx - 9, y_carga1 - 13), (b1x + 8, y_carga1 - 13), "CONTROL")
    lam.texto((xm + 2, iy - 16.5), "CABLE UTP CAT 6  L= 2 metros", 1.1, "TEXTO")
    # Medidores 1 (red) y 2 (solar), contactor K1
    m1x, m2x = tx + 78, tx + 78
    kx = tx + tw - 18
    lam.linea((b1x + 1, y_carga1 + 3), (m1x, y_carga1 + 3), "UNIFILAR")
    _kwh(lam, m1x, y_carga1, capa="PROTECCION")
    lam.texto((m1x + 4.5, y_carga1 + 10), "MEDIDOR INELCA 1", 1.4, "TEXTO", "centro")
    lam.texto((m1x + 4.5, y_carga1 + 8), "DTSY23S", 1.4, "TEXTO", "centro")
    lam.texto((m1x - 9, y_carga1 + 4.5), "CARGA", 1.6, "TEXTO", "centro")
    lam.texto((m1x + 16, y_carga1 + 4.5), "FUENTE", 1.6, "TEXTO", "centro")
    _kwh(lam, m2x, y_carga2 - 3, capa="PROTECCION")
    lam.linea((b1x + 1, y_carga2), (m2x, y_carga2), "UNIFILAR")
    lam.texto((m2x + 4.5, y_carga2 + 7), "MEDIDOR INELCA 2", 1.4, "TEXTO", "centro")
    lam.texto((m2x + 4.5, y_carga2 + 5), "DTSY23S", 1.4, "TEXTO", "centro")
    lam.texto((m2x - 9, y_carga2 + 1.5), "FUENTE", 1.6, "TEXTO", "centro")
    lam.texto((m2x + 18, y_carga2 + 1.5), "CARGA", 1.6, "TEXTO", "centro")
    # Contactor K1 (transferencia)
    k_top, k_bot = y_carga1 - 32, y_carga2 + 10
    lam.rect(kx - 5, k_bot - 4, 17, k_top - k_bot + 8, "COMUNIC", trazo="discontinuo")
    lam.rect(kx - 2, k_top - 0.6, 11, 1.2, "BARRA", relleno="#2a6fb5")
    lam.rect(kx - 2, k_bot - 0.6, 11, 1.2, "BARRA", relleno="#2a6fb5")
    lam.linea((m1x + 9, y_carga1 + 3), (kx + 3.5, y_carga1 + 3), "UNIFILAR")
    lam.linea((kx + 3.5, y_carga1 + 3), (kx + 3.5, k_top), "UNIFILAR")
    lam.linea((m2x + 9, y_carga2), (kx + 3.5, y_carga2), "UNIFILAR")
    lam.linea((kx + 3.5, y_carga2), (kx + 3.5, k_bot), "UNIFILAR")
    km = (k_top + k_bot) / 2
    lam.linea((kx + 3.5, k_top), (kx + 3.5, km + 3), "UNIFILAR")
    lam.linea((kx + 3.5, km - 3), (kx + 6.5, km + 2), "UNIFILAR")
    lam.linea((kx + 3.5, km - 3), (kx + 3.5, k_bot), "UNIFILAR")
    lam.texto((kx + 13, km + 3), "K1", 1.5, "TEXTO")
    lam.texto((kx + 13, km + 1), "CONTACTOR", 1.2, "TEXTO")
    lam.texto((kx + 13, km - 1), fam["contactor"], 1.1, "TEXTO")
    lam.texto((kx - 6, k_top + 8), "CABLE ENCAUCHETADO", 1.1, "TEXTO", "der")
    lam.texto((kx - 6, k_top + 6), "2X14 AWG - 110V / 2X14 AWG 220 V", 1.1, "TEXTO", "der")
    lam.texto((kx - 6, k_top + 4), "Señal de control (120 V +)", 1.15, "TEXTO", "der")
    lam.texto((kx - 6, k_top + 2), "va hacia bobina contactor A2", 1.15, "TEXTO", "der")
    # Modem y comunicaciones
    mx, my = tx + 95, ty + 108
    lam.rect(mx, my, 10, 12, "PROTECCION")
    lam.rect(mx + 1, my + 1, 8, 10, "PROTECCION")
    for k, t in enumerate(
        ["MODEM PULSAR", "IN1043-INELCA", "PUERTO RS485", "A: AZUL", "B: BLANCO AZUL"]
    ):
        lam.texto((mx + 5, my + 26 - k * 2.3), t, 1.4, "TEXTO", "centro")
    lam.circulo((mx + 20, my + 6), 2, "CONTROL")
    lam.linea((mx + 10, my + 6), (mx + 18, my + 6), "CONTROL")
    lam.texto((mx + 20, my + 10), "ALIMENTACIÓN 5 VDC", 1.1, "TEXTO", "centro")
    lam.texto((mx + 20, my + 1.5), "ADAPTADOR 110 VAC - 5 VDC", 1.1, "TEXTO", "centro")
    lam.linea((mx, my + 6), (m1x - 3, my + 6), "COMUNIC", trazo="discontinuo")
    lam.linea((m1x - 3, my + 6), (m1x - 3, y_carga2 + 3), "COMUNIC", trazo="discontinuo")
    lam.texto((m1x - 4, my + 2), "Cable RS485 apantallado", 1.15, "TEXTO", "der")
    lam.texto((m1x - 4, my), "Modem - Medidor", 1.15, "TEXTO", "der")

    # ---------------------------------------------------------------- red existente
    rx = 372
    lam.rect(rx - 13, 250, 26, 1.4, "UNIFILAR", relleno="#000000")
    lam.texto((rx, 253), "RED EN BAJA TENSIÓN EXISTENTE", 1.6, "TEXTO", "centro")
    lam.texto((rx - 15, 247), "Red de distribución en baja tensión", 1.15, "TEXTO", "der")
    lam.texto((rx - 15, 245), "trifásica tetrafilar del OR", 1.15, "TEXTO", "der")
    lam.rect(rx - 10, 226, 30, 21, "PROTECCION", trazo="discontinuo")
    lam.texto((rx + 6, 244), "Gabinete de medidores existente", 1.1, "TEXTO", "centro")
    lam.linea((rx, 250), (rx, 241), "UNIFILAR")
    _kwh(lam, rx - 4.5, 234, capa="UNIFILAR")
    lam.linea((rx, 234), (rx, 231), "UNIFILAR")
    lam.linea((rx, 231), (rx - 1.5, 228), "UNIFILAR")
    lam.circulo((rx, 227.6), 0.5, "UNIFILAR")
    lam.texto((rx + 3, 229.5), "BREAKER EXISTENTE", 1.15, "TEXTO")
    y_ent = ty + 103
    lam.linea((rx, 227), (rx, y_ent), "UNIFILAR")
    _marcas_fases(lam, rx - 1.4, 222)
    lam.texto((rx + 2, 218), "ALIMENTADOR PRINCIPAL", 1.15, "TEXTO")
    lam.texto((rx + 2, 216), "EXISTENTE", 1.15, "TEXTO")
    # Entra al barraje 1 del tablero FV (se interrumpe el alimentador de la vivienda)
    x_n = m1x + 24  # nodo aguas arriba del medidor 1 (lado fuente)
    lam.linea((rx, y_ent), (x_n, y_ent), "UNIFILAR")
    lam.linea((x_n, y_ent), (x_n, y_carga1 + 3), "UNIFILAR")
    lam.circulo((x_n, y_carga1 + 3), 0.6, "UNIFILAR", relleno="#000000")
    lam.texto((x_n + 1.5, y_ent - 3), "Alimentación desde la red", 1.15, "TEXTO")
    lam.texto((x_n + 1.5, y_ent - 5), "(aguas arriba del medidor 1)", 1.15, "TEXTO")
    _alimentador(
        lam,
        tx + tw + 3,
        y_ent - 4,
        ["En la misma tubería van:"] + fam["alim_principal"][:3],
        1.05,
        "TIERRA",
    )
    lam.texto((tx + tw + 3, y_ent - 13), fam["alim_principal"][3], 1.05, "TEXTO")
    for k, t in enumerate(
        [
            "Se debe interrumpir el alimentador",
            "principal de la vivienda que viene",
            "del OR y llevarlo hasta el tablero",
            "agrupador fotovoltaico.",
        ]
    ):
        lam.texto((tx + tw + 3, y_ent - 18 - k * 2.2), t, 1.35, "ROJO", negrita=True)

    # ---------------------------------------------------------------- tablero existente del cliente
    ex, ey, ew, eh = 262, 56, 96, 38
    lam.rect(ex, ey, ew, eh, "PROTECCION", trazo="discontinuo")
    lam.texto(
        (ex + ew / 2, ey + eh + 1.5),
        "Tablero existente general del cliente",
        1.8,
        "PROTECCION",
        "centro",
    )
    lam.rect(ex + 6, ey + eh - 8, ew - 12, 1.2, "UNIFILAR", relleno="#000000")
    lam.texto((ex + ew / 2 - 10, ey + eh - 5), "220V", 1.5, "TEXTO", "centro")
    lam.texto((ex + ew / 2 + 10, ey + eh - 5), "60Hz", 1.5, "TEXTO", "centro")
    lam.linea((kx + 3.5, k_bot), (kx + 3.5, ey + eh - 6.8), "UNIFILAR")
    lam.texto((kx + 5, ty - 4), "Alimentador de la vivienda (cargas)", 1.15, "TEXTO")
    for k in range(12):
        x = ex + 7 + k * 7.5
        lam.linea((x, ey + eh - 8), (x, ey + eh - 12), "PROTECCION")
        lam.linea((x, ey + eh - 12), (x + 1.2, ey + eh - 16), "PROTECCION")
        lam.linea((x, ey + eh - 16.5), (x, ey + 8), "PROTECCION")
        lam.polilinea(
            [(x - 0.9, ey + 9), (x + 0.9, ey + 9), (x, ey + 7)],
            "PROTECCION",
            cerrada=True,
            relleno="#e67e22",
        )
        lam.texto((x + 1.2, ey + eh - 11), "2x20A" if k % 3 != 2 else "1x20A", 0.9, "TEXTO")
    lam.texto((ex + ew / 2, ey + 3), "CARGAS GENERALES DE LA CASA", 1.4, "TEXTO", "centro")

    # ---------------------------------------------------------------- circuito de control
    cx0, cy0 = 160, 56
    lam.rect(cx0, cy0, 96, 38, "NOTA")
    lam.texto(
        (cx0 + 48, cy0 + 35), "CIRCUITO DE CONTROL 220V 2L", 1.8, "TEXTO", "centro", negrita=True
    )
    lam.texto((cx0 + 3, cy0 + 29), "L1", 1.8, "TEXTO", negrita=True)
    lam.texto((cx0 + 3, cy0 + 4), "L2", 1.8, "TEXTO", negrita=True)
    lam.linea((cx0 + 8, cy0 + 29.5), (cx0 + 88, cy0 + 29.5), "ROJO")
    lam.linea((cx0 + 8, cy0 + 4.5), (cx0 + 88, cy0 + 4.5), "AC")
    lam.texto((cx0 + 3, cy0 + 26.5), "Aguas arriba medidor 1", 1.05, "NOTA")
    lam.texto((cx0 + 3, cy0 + 7), "De O.R (fuente)", 1.05, "NOTA")
    ramas = [
        ("Vigilante de tensión", "R1", "NC", "11-12", "bobina"),
        ("Operando red (O.R)", "K1", "NA", "53-54", "amarillo"),
        ("Operando solar", "K1", "NC", "61-62", "verde"),
    ]
    for k, (titulo, eq, tipo, bornas, carga) in enumerate(ramas):
        x = cx0 + 22 + k * 28
        lam.texto((x, cy0 + 31.5), titulo, 1.2, "TEXTO", "centro")
        lam.linea((x, cy0 + 29.5), (x, cy0 + 23), "ROJO")
        lam.linea((x, cy0 + 23), (x + 2, cy0 + 19), "ROJO")
        if tipo == "NC":
            lam.linea((x - 1, cy0 + 21.5), (x + 1.5, cy0 + 21.5), "ROJO")
        lam.linea((x, cy0 + 18.5), (x, cy0 + 15), "ROJO")
        lam.texto((x - 2.5, cy0 + 21), eq, 1.5, "TEXTO", "der")
        lam.texto((x + 3, cy0 + 21), f"{tipo} ({bornas})", 1.2, "TEXTO")
        if carga == "bobina":
            lam.rect(x - 3, cy0 + 10, 6, 4.5, "UNIFILAR")
            lam.texto((x - 4, cy0 + 12), "K1", 1.4, "TEXTO", "der")
            lam.texto((x + 4, cy0 + 13.5), "A1", 1.0, "TEXTO")
            lam.texto((x + 4, cy0 + 10), "A2", 1.0, "TEXTO")
            lam.linea((x, cy0 + 15), (x, cy0 + 14.5), "ROJO")
            lam.linea((x, cy0 + 10), (x, cy0 + 4.5), "AC")
        else:
            lam.circulo(
                (x, cy0 + 12),
                2.2,
                "AMARILLO" if carga == "amarillo" else "TIERRA",
                relleno="#f2d600" if carga == "amarillo" else "#2fbf4a",
            )
            lam.linea((x, cy0 + 15), (x, cy0 + 14.2), "ROJO")
            lam.linea((x, cy0 + 9.8), (x, cy0 + 4.5), "AC")

    # ---------------------------------------------------------------- convenciones (esquina)
    vx, vy, vw, vh = 361, 56, 44, 38
    lam.rect(vx, vy, vw, vh, "CAJETIN")
    lam.texto((vx + vw / 2, vy + vh - 2.6), "CONVENCIONES", 1.6, "TEXTO", "centro", negrita=True)
    lam.linea((vx, vy + vh - 4.6), (vx + vw, vy + vh - 4.6), "CAJETIN")
    conv = [
        ("UNIFILAR", "Cableado de potencia"),
        ("DC", "Cableado DC (strings / batería)"),
        ("CONTROL", "Cableado de control / medición"),
        ("TIERRA", "Cableado de tierra"),
        ("COMUNIC", "Cableado de comunicaciones"),
    ]
    for k, (capa, t) in enumerate(conv):
        yv = vy + vh - 7.5 - k * 3
        trazo = "discontinuo" if capa == "COMUNIC" else "continuo"
        lam.linea((vx + 2, yv), (vx + 9, yv), capa, trazo=trazo)
        lam.texto((vx + 11, yv - 0.5), t, 1.1, "TEXTO")
    yv = vy + vh - 7.5 - len(conv) * 3
    _breaker(lam, vx + 0.5, yv - 0.5, "")
    lam.texto((vx + 14, yv - 1), "Protección termomagnética", 1.1, "TEXTO")
    _kwh(lam, vx + 3, yv - 9, 6, 4.5)
    lam.texto((vx + 11, yv - 7.3), "Medidor de energía", 1.1, "TEXTO")
    for k in range(2):
        lam.rect(vx + 2.5 + k * 3.2, yv - 14.5, 2.8, 2.2, "MODULO", relleno="#a8ecd8")
    lam.texto((vx + 11, yv - 14), "String de paneles", 1.1, "TEXTO")


def materiales(d: dict[str, Any]) -> list[dict[str, Any]]:
    b = d["bat"]
    filas = [
        (f"Módulo FV {d['modulo']['modelo']} 595 Wp", d["modulos"], "und"),
        (f"Inversor híbrido {d['inversor_modelo']}", 1, "und"),
        (f"Batería {b['texto']} módulo {b['modulo']}", b["n"], "und"),
        ("BMS / caja de control de batería", b["torres"], "und"),
        ("Tablero FV con transferencia (K1)", 1, "und"),
        ("Medidor DTSY23S (red / solar)", 2, "und"),
        ("Modem Pulsar IN1043-INELCA", 1, "und"),
    ]
    return [
        {"item": i, "descripcion": t, "cantidad": c, "unidad": u, "material": "—"}
        for i, (t, c, u) in enumerate(filas, 1)
    ]


def notas(d: dict[str, Any]) -> list[str]:
    s = d["strings"]
    return [
        f"Sistema de {d['modulos']} módulos de 595 Wp ({_f(d['kwp'])} kWp) "
        f"y un inversor {d['inversor_modelo']}.",
        f"Al inversor le llega(n) {len(s)} string(s): "
        + " + ".join(f"{n} módulos" for n in s)
        + ".",
        "Cable FV tipo PV-PVC-SR-DB-FR-90°C-Cu-TC-AD7, 1.8 kVdc, para los conductores DC.",
        "Interruptores del inversor: corriente máx. de salida AC × 1,25.",
        "Strings numerados INVERSOR.MPPT.STRING (polaridad).",
        "Equipos y materiales según RETIE vigente; calibres según condiciones de cada obra.",
    ]


def lamina_casa(d: dict[str, Any], fecha: str, disenador: str = "") -> Lamina:
    plantilla = validar.cargar_json(validar.RAIZ / "templates" / "cajetin.json")
    codigo = f"PRO-ELE-{_slug(d['proyecto'])[:10]}-C{_slug(str(d['casa']))}-UNI-001"
    lam = Lamina(
        1, codigo, "Diagrama unifilar", disciplina="ELE", tipo="UNI", escala="N/A", unidad="N/A"
    )
    lam.notas = notas(d)
    datos = {
        "revisiones": [
            {
                "revision": "A",
                "fecha": fecha,
                "descripcion": "EMISIÓN PARA REVISIÓN",
                "zona": "",
                "revisado": "",
                "aprobado": "",
            }
        ],
        "materiales": materiales(d),
        "notas": lam.notas,
        "dibujado_por": plantilla["dibujado_por"],
        "disenado_por": disenador,
        "localizacion": f"{d['ciudad'].title()}, {DEPARTAMENTO.get(d['ciudad'], '')} "
        f"({d['lat']:.2f}, {d['lon']:.2f})",
        "archivo": f"{codigo}.pdf",
        "tolerancia": "N/A",
        "proyecto": (
            f"Solar FV + BESS {d['proyecto'].title()} – Casa {d['casa']} – {_f(d['kwp'])} kWp"
        ),
        "contenido": "Diagrama unifilar",
        "tamano": lam.formato,
        "codigo": codigo,
        "rev": "A",
        "escala": "N/A",
        "unidad": "N/A",
        "hoja": "1/1",
    }
    cajetin.dibujar(lam, plantilla, datos, validar.RAIZ)
    dibujar(lam, d)
    return lam


def _disenador() -> str:
    ruta = validar.RAIZ / "unifilares" / "privado" / "datos_privados.json"
    if ruta.is_file():
        return json.loads(ruta.read_text(encoding="utf-8")).get("disenador", "")
    return ""


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m engine.planos.unifilar_casas")
    p.add_argument("excel", type=Path)
    p.add_argument("--proyecto")
    p.add_argument("--casa")
    p.add_argument("--todas", action="store_true")
    p.add_argument("--fecha", default=dt.date.today().isoformat())
    p.add_argument("--salida", type=Path, default=SALIDA)
    args = p.parse_args(argv)
    bib = validar.cargar_biblioteca()
    casas = pvsyst.leer_casas(args.excel)
    modulo = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, _ = pvsyst.plan(casas, modulo)
    sel = [
        (c, f)
        for c, f in zip(casas, filas, strict=True)
        if args.todas
        or (
            args.proyecto
            and _slug(args.proyecto) in _slug(c["proyecto"])
            and (args.casa is None or _slug(args.casa) == _slug(str(c["casa"])))
        )
    ]
    if not sel:
        print("Ninguna casa coincide.")
        return 1
    args.salida.mkdir(parents=True, exist_ok=True)
    for c, f in sel:
        try:
            d = datos_casa(c, f, bib)
        except ValueError as e:
            print(f"OMITIDA {c['proyecto']} {c['casa']}: {e}")
            continue
        lam = lamina_casa(d, args.fecha, _disenador())
        ruta = a_pdf([lam], args.salida / f"{lam.codigo}.pdf")
        print(
            f"{c['proyecto']} {c['casa']}: {ruta}"
            + (f"  AVISOS: {'; '.join(d['avisos'])}" if d["avisos"] else "")
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
