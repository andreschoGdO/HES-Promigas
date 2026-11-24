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
    assert (b["kwh"], b["v_sistema"], b["por_torre"]) == (16.36, 409.6, 4)
    assert not d["avisos"]


def test_aviso_si_la_torre_supera_la_ficha() -> None:
    d = _datos(inversor="Livoltek 15 kW", baterias=6, bms=1, modulos=16)
    assert any("máximo 3" in a for a in d["avisos"])  # BHF: hasta 3 módulos por torre


def test_huawei_sin_guia() -> None:
    with pytest.raises(ValueError, match="sin guía"):
        _datos(inversor="Huawei 10kW")


def test_lamina_pdf(tmp_path: Path) -> None:
    lam = uc.lamina_casa(_datos(), "2026-11-24", "Diseñador de prueba")
    assert lam.codigo == "PRO-ELE-VERDEDIAMA-C12-UNI-001"
    textos = " ".join(p["s"] for p in lam.primitivas if p["t"] == "texto")
    assert "Cadena x 9 paneles en serie" in textos and "16,36 kWh" in textos
    assert "CUMPLE" in textos and "NO CUMPLE" not in textos
    assert a_pdf([lam], tmp_path / "u.pdf").read_bytes()[:4] == b"%PDF"
