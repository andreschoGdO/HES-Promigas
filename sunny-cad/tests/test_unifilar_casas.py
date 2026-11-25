"""Unifilares por casa (guía DEYE): datos, verificaciones de strings y lámina en PDF."""

from __future__ import annotations

from pathlib import Path

import pytest

from engine import validar
from engine.planos import unifilar_casas as uc
from engine.planos.lamina import a_pdf
from engine.simulacion import pvsyst

BIB = validar.cargar_biblioteca()
CASA = {
    "ciudad": "TURBACO",
    "proyecto": "Verde Diamante",
    "casa": "12",
    "inversor": "DEYE 15 kW",
    "tipo": "Trifasico",
    "modulos": 9,
    "baterias": 4,
    "bms": 1,
    "smartguard": "N/A",
    "kwp_excel": 5.36,
    "lat": 10.3406,
    "lon": -75.4346,
}


def _datos(**cambios):
    casa = {**CASA, **cambios}
    m = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
    filas, _ = pvsyst.plan([casa], m)
    return uc.datos_casa(casa, filas[0], BIB)


def test_datos_de_la_casa() -> None:
    d = _datos()
    assert d["strings"] == [9] and d["kwp"] == 5.36 and d["ratio"] == pytest.approx(0.36)
    b = d["bat"]
    # GB-L: 4 módulos de 4,09 kWh y 102,4 V en una torre → 16,36 kWh, 409,6 V
    assert (b["kwh"], b["v_torres"], b["torres"]) == (16.36, [409.6], [4])
    assert not d["avisos"]


def test_torres_livoltek_segun_regla_del_usuario() -> None:
    # Hasta 4 módulos: una torre; 5 → 3 + 2; 6 → 3 + 3
    assert uc.torres_bateria("livoltek15kw", 4, 1) == ([4], [])
    # Livoltek con 2 torres: 1 BMS + 1 top cover
    assert uc.torres_bateria("livoltek15kw", 5, 1) == ([3, 2], [])
    assert uc.torres_bateria("livoltek15kw", 6, 1) == ([3, 3], [])
    _, avisos = uc.torres_bateria("livoltek15kw", 6, 2)  # el Excel dice 2 BMS
    assert avisos and "corresponde(n) 1" in avisos[0]
    # DEYE: según los BMS del Excel, hasta 4 por torre
    assert uc.torres_bateria("deye15kw", 8, 2) == ([4, 4], [])


def test_livoltek_usa_el_esquema_deye() -> None:
    d = _datos(inversor="Livoltek 15 kW", baterias=6, bms=1, modulos=16)
    assert d["strings"] == [8, 8]  # strings largos se dividen (usuario)
    assert d["fam"]["tablero"] == uc.FAMILIAS["deye15kw"]["tablero"]
    assert d["bat"]["torres"] == [3, 3] and d["bat"]["kwh"] == 30.72


def test_huawei_bifasico(tmp_path: Path) -> None:
    d = _datos(inversor="Huawei 10kW", tipo="Bifasico", modulos=13, baterias=4, bms=2)
    assert d["strings"] == [7, 6] and d["bat"]["torres"] == [2, 2]
    lam = uc.lamina_casa(d, "2026-11-24")
    textos = " ".join(p["s"] for p in lam.primitivas if p["t"] == "texto")
    assert "SmartGuard-63A-S0" in textos and "Autotransformador" in textos
    assert "SMART DONGLE" in textos and "ADAPTADOR 110 VAC - 5 VDC" in textos


def test_lamina_pdf(tmp_path: Path) -> None:
    lam = uc.lamina_casa(_datos(), "2026-11-24", "Diseñador de prueba")
    assert lam.codigo == "PRO-ELE-VERDEDIAMANTE-C12-UNI-001"
    textos = " ".join(p["s"] for p in lam.primitivas if p["t"] == "texto")
    assert "Cadena x 9 paneles en serie" in textos and "16,36 kWh" in textos
    assert "CUMPLE" in textos and "NO CUMPLE" not in textos
    assert "3N° 6 AWG (F) Cu - THHN/THWN-2 @90°C - 0.6 kV - SR" in textos  # alimentador: 6 AWG
    assert "N° 4 AWG" not in textos
    assert "Alimentación adaptador 110 VAC (F+N)" in textos  # el módem tiene alimentación
    assert a_pdf([lam], tmp_path / "u.pdf").read_bytes()[:4] == b"%PDF"


def test_bifasico_lleva_hoja_de_comunicaciones() -> None:
    from engine.planos import comunicaciones_huawei as ch

    for bms, n, enlaces in ((2, 4, True), (1, 1, False)):
        d = _datos(inversor="Huawei 10kW", tipo="Bifasico", modulos=7, baterias=n, bms=bms)
        lams = uc.laminas_casa(d, "2026-11-24")
        assert [x.codigo.split("-")[-2] for x in lams] == ["UNI", "COM"]
        textos = " ".join(p["s"] for p in lams[1].primitivas if p["t"] == "texto")
        assert "485A1" in textos and "D12+" in textos and "EN (enable)" in textos
        assert ("Torre 2 borne 10" in textos) == enlaces  # enlace entre torres solo con dos
        assert "CAN H" not in textos and "Torre 1 borne 5" not in textos
    # El unifilar bifásico ya no lleva la línea punteada del bypass del neutro
    textos = " ".join(p["s"] for p in lams[0].primitivas if p["t"] == "texto")
    assert "AUTOTRANSFORMADOR" in textos and "bypass del neutro existente (medidor" not in textos
    assert [(o, t) for o, t, _, _ in ch.INVERSOR_BATERIA] == [
        ("4", "2"), ("3", "3"), ("6", "4"), ("10", "1"),
    ]  # fmt: skip
    assert [o for o, _, _, _ in ch.BATERIA_BATERIA] == ["7", "8", "9", "10"]


def test_trifasico_una_sola_hoja() -> None:
    assert len(uc.laminas_casa(_datos(), "2026-11-24")) == 1


def test_ingenieria_tipo_doral() -> None:
    from shapely.geometry import LineString, Point
    from shapely.ops import unary_union

    from engine.planos import casas_doral as cd

    loc = cd.geometria()
    _mods_n, mods_l, az = cd.modulos(loc, 8)
    assert len(mods_l) == 8 and az in (180.0, cd.AZ_FRENTE)
    zona = unary_union(mods_l)
    assert zona.within(loc["cubierta"])
    assert all(not zona.intersects(o) for o in loc["obst"])
    dc, ac, L = cd.rutas(loc, mods_l)
    # Los tramos de AC sobre la losa no pasan por encima de los módulos
    for a, b in zip(ac[:-1], ac[1:], strict=True):
        if cd.Z_LOSA < a[2] < cd.Z_LOSA + 200 and cd.Z_LOSA < b[2] < cd.Z_LOSA + 200:
            assert not LineString([a[:2], b[:2]]).intersects(zona)
    assert 15 < L["ac_total"] < 35 and L["dc_total"] > 5
    assert Point(dc[-1][:2]).distance(loc["inversor"]) < 200
