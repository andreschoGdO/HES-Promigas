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

    g = cd.geometria()
    # Medición en Maps 44,96 m²; la losa rectificada a ángulos rectos queda ≈ 2,5 % menor
    assert g["losa"].area / 1e6 == pytest.approx(44.96, rel=0.03)
    mods = cd.colocar(g, 8)
    assert len(mods) == 8
    zona = unary_union(mods)
    assert zona.within(g["losa"])
    assert all(not zona.intersects(o) for o in g["fijos"])
    dc, ac, existente, L = cd.rutas(g, mods)
    # La AC por la losa no pasa por encima de los módulos y termina en el tubo existente de 1¼"
    for a, b in zip(ac[:-1], ac[1:], strict=True):
        if a[2] == b[2] == cd.ZR:
            assert not LineString([a[:2], b[:2]]).intersects(zona)
    assert ac[-1][:2] == cd.TUBO_EXISTENTE and existente[-1][2] == cd.TAB_INTERNO_Z
    assert L["cal_ac"] == "8" and L["tubo_ac"] == '1¼"'
    assert Point(dc[-1][:2]).distance(g["inversor"]) < 300


def test_estructura_lastrada_y_rutas_3d() -> None:
    from engine.planos import casas_doral as cd
    from engine.planos import casas_primavera as cp

    # Doral: filas rectas; los tramos de la 2ª fila se alinean con las columnas de la 1ª si caben
    g = cd.geometria()
    mods = cd.colocar(g, 8)
    filas = cp._filas(mods)
    assert len(filas) == 2
    cols1 = {round(a) for a, _b in filas[0]["mods"]}
    assert {round(a) for a, _b in filas[1]["grupos"][0]} <= cols1
    est = cp.cantidades_estructura(mods)
    juntas = sum(len(g_) + 1 for f in filas for g_ in f["grupos"])
    assert est["bloques"] == 2 * juntas  # bloque delantero y trasero en cada soporte
    _dc, ac, _ex, L = cd.rutas(g, mods)
    assert L["ac_nuevo"] == pytest.approx(sum(cp._largos(ac)))
    # Rutas sin vértices colineales: cada vértice intermedio es una curva
    for r in (_dc, ac):
        assert cp._fusionar(r) == r
    # Geometría del soporte: 412 mm al riel trasero y 10° de inclinación
    zm0 = cp._z_modulo(0)
    assert zm0 + cp.RIEL_S[1] * cp.SEN10 - cp.Z_BLOQUE == pytest.approx(cp.H_SOPORTE)
    assert cp.DESNIVEL == pytest.approx(395.6, abs=0.5)


def test_pance_campestre_minirriel() -> None:
    from shapely.geometry import Point
    from shapely.ops import unary_union

    from engine.planos import casas_pance as cp

    g = cp.geometria()
    # Medición en Maps: 142,25 m² y 49,54 m (contorno con los muros rectificados)
    assert g["techo"].area / 1e6 == pytest.approx(142.25, rel=0.03)
    assert g["techo"].length / 1000 == pytest.approx(49.54, rel=0.03)
    mods = cp.colocar(g, 8)
    assert len(mods) == 8 and len({round(m.bounds[1]) for m in mods}) == 1  # una sola hilera
    assert unary_union(mods).within(g["util"])
    dc, ac, desc_dc, desc_ac, L = cp.rutas(g, mods)
    assert len(desc_dc) == len(dc) - 1 and len(desc_ac) == len(ac) - 1
    assert dc[-1][0] == cp.X_EQ and ac[-1][:2] == cp.BUITRON  # fachada oeste y claraboya
    assert cp.CLARABOYA.contains(Point(cp.BUITRON))
    # Dos mini rieles por junta (n + 1 juntas en una hilera), 4 tornillos por mini riel
    assert L["n_minirriel"] == 2 * (8 + 1)
    filas = {f[1]: f[3] for f in L["filas_estructura"]}
    assert filas["Tornillo autoperforante con arandela EPDM"] == cp.TORNILLOS_MR * 18


def test_caja_bornas_segun_marca_y_torres() -> None:
    from engine.planos.unifilar_casas import caja_bornas

    def d(familia, torres):
        return {"familia": familia, "bat": {"torres": torres}}

    assert not caja_bornas(d("livoltek15kw", [3]))
    assert not caja_bornas(d("livoltek10kw", [3, 2]))
    assert not caja_bornas(d("deye15kw", [4]))
    assert caja_bornas(d("deye15kw", [4, 4]))


def test_porton_rivera_teja_riel() -> None:
    from engine.planos import casas_porton as cp

    filas = cp.hileras(7)
    assert [f["n"] for f in filas] == [4, 3]  # una hilera por agua (bloque sur y medio)
    for f, g in zip(filas, (cp.G_SUR_O, cp.G_MEDIO), strict=True):
        assert f["xa"] >= cp.X_LADRILLO - cp.TEJA and f["xb"] <= cp.X_LADRILLO  # solo en la teja
        assert g[2] <= f["y0"] and f["y0"] + f["largo"] <= g[3]
    dc, ac, puente, desc_dc, desc_ac, L = cp.rutas(filas)
    assert len(desc_dc) == len(dc) - 1 and len(desc_ac) == len(ac) - 1
    assert dc[-1][0] == cp.X_EQ and ac[-1][:2] == cp.TABLERO_PC and puente
    assert any(abs(q[2] - cp.Z_CIELO) < 1 for q in ac)  # entra por el cielo falso
    assert L["n_anclajes"] == sum(2 * len(cp.anclajes(f)) for f in filas)
    for f in filas:
        a = cp.anclajes(f)
        assert max(b - c for b, c in zip(a[1:], a[:-1], strict=False)) <= cp.PASO_ANCLAJE
