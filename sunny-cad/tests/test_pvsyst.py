"""Preparación de simulaciones PVsyst: lectura de .PAN/.OND y dimensionamiento de strings."""

from __future__ import annotations

import pytest

from engine.simulacion import pvsyst

M = pvsyst.Modulo.desde_pan(pvsyst.DIR_PVSYST / "JAM72D40-595_LB.PAN")
INV = pvsyst.inversores()


def test_lectura_pan_y_ond() -> None:
    assert (M.pnom_w, M.voc, M.vmp, M.mu_voc_v) == (595, 52.2, 43.59, -0.127)
    deye = INV["deye15kw"]
    assert (deye.vmpp_min, deye.vmpp_max, deye.vabs_max, deye.n_mppt) == (150, 500, 550, 2)


def test_voc_en_frio_a_mano() -> None:
    # 52,2 V − 0,127 V/°C × (12 − 25) °C = 53,851 V; × 8 módulos = 430,8 V
    assert 8 * M.voc_a(12) == pytest.approx(430.8, abs=0.05)


def test_strings_deye() -> None:
    # 18 módulos: 1 string de 18 supera 550 V → 2 strings de 9 (uno por MPPT)
    op = pvsyst.proponer_strings(18, M, INV["deye15kw"], 20)
    assert op.strings == [9, 9] and op.voc_max_v <= 550
    # 13 módulos → 7 + 6 en dos subconjuntos
    assert pvsyst.proponer_strings(13, M, INV["deye15kw"], 18).strings == [7, 6]
    # 3 módulos no llegan al mínimo MPPT de 150 V a 60 °C
    assert pvsyst.proponer_strings(3, M, INV["deye15kw"], 20) is None


def test_plan_desde_casas() -> None:
    casas = [
        {
            "ciudad": "CALI",
            "proyecto": "P",
            "casa": "1",
            "inversor": "DEYE 15 kW",
            "tipo": "Trifasico",
            "modulos": 7,
            "baterias": 3,
            "bms": 1,
            "smartguard": "N/A",
            "kwp_excel": 4.17,
            "lat": 3.3431,
            "lon": -76.5476,
        },
        {
            "ciudad": "CALI",
            "proyecto": "P",
            "casa": "2",
            "inversor": "Huawei 10kW",
            "tipo": "Bifasico",
            "modulos": 5,
            "baterias": 2,
            "bms": 1,
            "smartguard": 1,
            "kwp_excel": 3.0,
            "lat": 3.3431,
            "lon": -76.5476,
        },
    ]
    filas, sitios = pvsyst.plan(casas, M)
    assert len(sitios) == 1 and sitios[0]["lat"] == 3.34  # coordenadas a 2 decimales
    assert filas[0]["strings"] == "7" and filas[0]["kwp"] == 4.17
    assert "kWp del Excel 3.0" in filas[1]["observaciones"]  # 5 × 595 W = 2,98 kWp
