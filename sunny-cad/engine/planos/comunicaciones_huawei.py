"""Plano de comunicaciones de las casas bifásicas Huawei (hoja 2 del unifilar).

Bornes y señales según el plano de referencia del usuario (SSFV_CASA_CONJUNTO_RES.LAS_PALMERAS_
COMUNICACIÓN): SmartGuard-63A-S0 ↔ conector COM del SUN2000-10K-LC0 ↔ torre 1 de LUNA2000-7-E1 y,
si hay dos torres, torre 1 ↔ torre 2. Solo cambia con el número de torres (una o dos).
"""

from __future__ import annotations

from typing import Any

from engine.planos.lamina import Lamina

# (borne de origen, borne de destino, señal, capa de color)
SMARTGUARD_INVERSOR = [
    ("1", "2", "485A1", "PROTECCION"),
    ("2", "1", "485B1", "PROTECCION"),
    ("3", "8", "D12+", "AC"),
    ("4", "9", "GND", "AC"),
    ("PE", "10", "PE", "NOTA"),
]
# Confirmado por el usuario: inversor 4/3/10/6 → batería 2/3/1/4 (el borne 5 no se usa).
INVERSOR_BATERIA = [
    ("4", "2", "485A2", "ROJO"),
    ("3", "3", "485B2", "ROJO"),
    ("6", "4", "EN (enable)", "COMUNIC"),
    ("10", "1", "PE", "NOTA"),
]
# Confirmado por el usuario: entre torres solo 7, 8, 9 y 10.
BATERIA_BATERIA = [
    ("7", "7", "485A2", "PROTECCION"),
    ("8", "8", "485B2", "PROTECCION"),
    ("9", "9", "EN (enable)", "COMUNIC"),
    ("10", "10", "GND", "COMUNIC"),
]

SG_BORNES = ["1", "2", "3", "4", "5", "6", "PE", "PE", "PE", "PE", "PE", "PE"]
INV_BORNES = [str(i) for i in range(1, 11)]
BAT_BORNES = [str(i) for i in range(1, 13)]


def lamina(d: dict[str, Any]) -> Lamina:
    from engine.planos.unifilar_casas import codigo_plano

    lam = Lamina(
        2,
        codigo_plano(d, "COM", 2),
        "Plano de comunicaciones",
        disciplina="ELE",
        tipo="COM",
        escala="N/A",
        unidad="N/A",
    )
    torres = d["bat"]["torres"]
    lam.notas = [
        "Conexiones de comunicación según el plano de referencia y el manual de Huawei.",
        "SmartGuard ↔ inversor por RS485 (485A1/485B1), D12+ y GND; inversor ↔ batería "
        "por RS485 (485A2/485B2), enable y PE.",
        (
            "La torre 2 se enlaza a la torre 1 con RS485 (485A2/485B2), enable y GND."
            if len(torres) > 1
            else "Una sola torre de baterías: sin enlace entre torres."
        ),
        "Verificar la numeración de bornes en el equipo antes de conectar.",
    ]
    return lam


def _bornera(lam: Lamina, x: float, y: float, bornes: list[str], paso: float, alto=6.0) -> dict:
    """Bornera horizontal; devuelve la x de cada borne (por índice)."""
    lam.rect(x, y, paso * len(bornes), alto, "UNIFILAR", relleno="#eeeeee")
    xs = {}
    for i, b in enumerate(bornes):
        xi = x + paso * (i + 0.5)
        lam.rect(x + paso * i + 0.4, y + 0.6, paso - 0.8, alto - 1.2, "UNIFILAR", relleno="#ffffff")
        lam.texto(
            (xi, y + alto / 2), b, 1.15 if len(b) < 3 else 0.95, "TEXTO", "centro", negrita=True
        )
        lam.circulo((xi, y + 0.6), 0.45, "UNIFILAR")
        xs[i] = xi
    return xs


def _equipo(lam: Lamina, x, y, w, h, titulo: list[str], color="TEXTO") -> None:
    lam.rect(x, y, w, h, "UNIFILAR")
    lam.rect(x + 1.5, y + 1.5, w - 3, h - 3, "NOTA")
    for k, t in enumerate(titulo):
        lam.texto(
            (x + w / 2, y + h + 6 - k * 2.6),
            t,
            2.0 if k else 2.2,
            color if k == 0 else "TEXTO",
            "centro",
            negrita=True,
        )


def _cable(lam, x0, y0, x1, y1, y_lane, capa, etiqueta, x_etq) -> None:
    lam.linea((x0, y0), (x0, y_lane), capa)
    lam.linea((x0, y_lane), (x1, y_lane), capa)
    lam.linea((x1, y_lane), (x1, y1), capa)
    lam.texto((x_etq, y_lane + 0.5), etiqueta, 1.15, capa, "centro", negrita=True)


def dibujar(lam: Lamina, d: dict[str, Any]) -> None:
    from engine.planos.unifilar_casas import _f, _tabla

    torres = d["bat"]["torres"]
    lam.texto(
        (150, 258.5),
        f"PLANO DE COMUNICACIONES – CASA {d['casa']} - {d['proyecto'].upper()}",
        3.6,
        "TEXTO",
        "centro",
        negrita=True,
    )
    # Equipos
    paso_sg, paso_inv, paso_bat = 4.4, 4.4, 4.6
    sgx, invx, y_eq = 22, 100, 200
    _equipo(lam, sgx, y_eq, paso_sg * 12, 40, ["SMARTGUARD 63A", "SmartGuard-63A-S0"])
    for k, t in enumerate(["RED", "COM", "INVERSOR 1", "INVERSOR 2", "CARGA"]):
        lam.texto((sgx + 5 + k * 10.5, y_eq + 3), t, 0.9, "NOTA", "centro")
    _equipo(
        lam,
        invx,
        y_eq,
        paso_inv * 10 + 8,
        40,
        ["INVERSOR 1", f"HUAWEI {d['inversor_modelo']}"],
        "AC",
    )
    lam.texto((invx + 26, y_eq + 3), "Conector COM", 1.1, "NOTA", "centro")
    y_bor = y_eq - 7
    x_sg = _bornera(lam, sgx, y_bor, SG_BORNES, paso_sg)
    x_inv = _bornera(lam, invx + 4, y_bor, INV_BORNES, paso_inv)
    lam.texto((sgx, y_bor - 2.5), "Bornera COM del SmartGuard", 1.1, "NOTA")
    lam.texto((invx + 4, y_bor - 2.5), "Conector COM del inversor (10 pines)", 1.1, "NOTA")

    # Torres de baterías con su bornera (arriba)
    tw, th, y_t = 62, 64, 64
    xt = [196 + i * (tw + 12) for i in range(len(torres))]
    x_bat = []
    for i, n in enumerate(torres):
        lam.texto(
            (xt[i] + tw / 2, y_t + th + 9), f"TORRE {i + 1}", 2.2, "TEXTO", "centro", negrita=True
        )
        lam.texto(
            (xt[i] + tw / 2, y_t + th + 6),
            f"LUNA2000-10KW-C1 + {n} x LUNA2000-7-E1",
            1.5,
            "TEXTO",
            "centro",
        )
        lam.rect(xt[i], y_t, tw, th, "UNIFILAR")
        for k in range(n):
            yy = y_t + 3 + k * 8
            lam.rect(xt[i] + 4, yy, tw - 8, 6.5, "NOTA", relleno="#f3f3f3")
            lam.texto((xt[i] + tw / 2, yy + 3.2), "LUNA2000-7-E1", 1.2, "TEXTO", "centro")
        x_bat.append(_bornera(lam, xt[i] + 3.4, y_t + th - 9, BAT_BORNES, paso_bat))

    # SmartGuard → inversor (salen hacia abajo, carriles 186…170)
    for k, (o, dst, sen, capa) in enumerate(SMARTGUARD_INVERSOR):
        io = SG_BORNES.index(o) if o != "PE" else 6
        x0, x1 = x_sg[io], x_inv[INV_BORNES.index(dst)]
        _cable(lam, x0, y_bor, x1, y_bor, 186 - k * 4, capa, sen, (x0 + x1) / 2)
    # Inversor → torre 1 (carriles 164…148, entran por arriba a la bornera)
    y_bat_top = y_t + th - 3
    for k, (o, dst, sen, capa) in enumerate(INVERSOR_BATERIA):
        x0, x1 = x_inv[INV_BORNES.index(o)], x_bat[0][BAT_BORNES.index(dst)]
        y_l = 164 - k * 4
        lam.linea((x0, y_bor), (x0, y_l), capa)
        lam.linea((x0, y_l), (x1, y_l), capa)
        lam.linea((x1, y_l), (x1, y_bat_top), capa)
        lam.texto((178, y_l + 0.5), sen, 1.15, capa, "centro", negrita=True)
    # Torre 1 → torre 2 (salen por debajo de la bornera)
    if len(torres) > 1:
        y_b = y_t + th - 9
        for k, (o, dst, sen, capa) in enumerate(BATERIA_BATERIA):
            x0, x1 = x_bat[0][BAT_BORNES.index(o)], x_bat[1][BAT_BORNES.index(dst)]
            y_l = y_b - 4 - k * 3.4
            lam.linea((x0, y_b), (x0, y_l), capa)
            lam.linea((x0, y_l), (x1, y_l), capa)
            lam.linea((x1, y_l), (x1, y_b), capa)
            lam.texto((xt[0] + tw + 6, y_l + 0.5), sen, 1.1, capa, "centro", negrita=True)

    # Tabla de conexiones
    filas = [("SmartGuard " + o, "Inversor COM " + t, s) for o, t, s, _ in SMARTGUARD_INVERSOR]
    filas += [("Inversor COM " + o, "Torre 1 borne " + t, s) for o, t, s, _ in INVERSOR_BATERIA]
    if len(torres) > 1:
        filas += [("Torre 1 borne " + o, "Torre 2 borne " + t, s) for o, t, s, _ in BATERIA_BATERIA]
    tx, ty, cws, h = 14, 140, (24, 50, 50), 3.4
    lam.texto((tx, ty + 2), "TABLA DE CONEXIONES", 1.9, "TEXTO", negrita=True)
    xx = tx
    for t, cw in zip(("Señal", "Desde", "Hasta"), cws, strict=True):
        lam.rect(xx, ty - h, cw, h, "CAJETIN", relleno="#d9d9d9")
        lam.texto((xx + cw / 2, ty - h / 2), t, 1.4, "TEXTO", "centro", negrita=True)
        xx += cw
    y = ty - h
    for desde, hasta, sen in filas:
        xx = tx
        for v, cw in zip((sen, desde, hasta), cws, strict=True):
            lam.rect(xx, y - h, cw, h, "CAJETIN")
            lam.texto((xx + 1.2, y - h / 2), v, 1.25, "TEXTO", "izq_medio")
            xx += cw
        y -= h

    # Columna derecha: datos y convenciones
    x0, w0 = 340, 64
    ie = d["inv"]
    y = _tabla(
        lam, x0, 250, w0, "DATOS DEL INVERSOR",
        [
            ("Referencia", d["inversor_modelo"]),
            ("Potencia AC (W)", f"{ie['potencia_nominal_ac_w']:,.0f}".replace(",", ".")),
            ("Tensión nominal (V)", "240"),
            ("Número de MPPT", ie["numero_mppt"]),
        ],
    )  # fmt: skip
    y = _tabla(
        lam, x0, y - 2, w0, "DATOS DE BATERÍAS",
        [
            ("Módulo de potencia", "LUNA2000-10KW-C1"),
            ("Módulo de batería", "LUNA2000-7-E1"),
            ("Módulos por torre", " + ".join(map(str, torres))),
            ("Energía total (kWh)", _f(d["bat"]["kwh"])),
        ],
    )  # fmt: skip
    y -= 5
    lam.texto((x0, y), "CONVENCIONES", 1.7, "TEXTO", negrita=True)
    conv = [
        ("PROTECCION", "RS485 (485A / 485B)"),
        ("ROJO", "RS485 inversor → batería"),
        ("AC", "D12+ / GND (SmartGuard)"),
        ("COMUNIC", "Enable / GND (batería)"),
        ("NOTA", "PE (tierra de comunicaciones)"),
    ]
    for k, (capa, t) in enumerate(conv):
        yy = y - 4 - k * 3
        lam.linea((x0, yy), (x0 + 8, yy), capa)
        lam.texto((x0 + 10, yy - 0.5), t, 1.15, "TEXTO")
