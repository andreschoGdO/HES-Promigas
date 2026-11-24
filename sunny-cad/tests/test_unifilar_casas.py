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
    assert uc.torres_bateria("livoltek15kw", 5, 2) == ([3, 2], [])
    assert uc.torres_bateria("livoltek15kw", 6, 2) == ([3, 3], [])
    _, avisos = uc.torres_bateria("livoltek15kw", 6, 1)  # el Excel dice 1 BMS
    assert avisos and "2 torre(s)" in avisos[0]
    # DEYE: según los BMS del Excel, hasta 4 por torre
    assert uc.torres_bateria("deye15kw", 8, 2) == ([4, 4], [])


def test_livoltek_usa_el_esquema_deye() -> None:
    d = _datos(inversor="Livoltek 15 kW", baterias=6, bms=2, modulos=16)
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
    assert lam.codigo == "PRO-ELE-VERDEDIAMA-C12-UNI-001"
    textos = " ".join(p["s"] for p in lam.primitivas if p["t"] == "texto")
    assert "Cadena x 9 paneles en serie" in textos and "16,36 kWh" in textos
    assert "CUMPLE" in textos and "NO CUMPLE" not in textos
    assert "Alimentación adaptador 110 VAC (F+N)" in textos  # el módem tiene alimentación
    assert a_pdf([lam], tmp_path / "u.pdf").read_bytes()[:4] == b"%PDF"
