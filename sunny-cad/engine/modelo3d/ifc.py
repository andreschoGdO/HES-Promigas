"""Exportación IFC4 del modelo (Paso 6). Se genera desde proyecto.json; nunca se edita a mano."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit

from engine.modelo3d.geometria import Elemento

CLASES = {
    "losa": ("IfcSlab", "ROOF"),
    "volumen": ("IfcBuildingElementProxy", None),
    "modulo": ("IfcSolarDevice", "SOLARPANEL"),
    "estructura": ("IfcMember", "MEMBER"),
    "inversor": ("IfcBuildingElementProxy", None),
    "bateria": ("IfcElectricFlowStorageDevice", "BATTERY"),
    "tablero": ("IfcElectricDistributionBoard", "DISTRIBUTIONBOARD"),
    "medidor": ("IfcFlowMeter", "ENERGYMETER"),
}
NOMBRE_TIPO = {
    "volumen": "Volumen de la terraza alta",
    "inversor": "Inversor híbrido",
}


def exportar(proyecto: dict[str, Any], elems: list[Elemento], salida: Path) -> Path:
    f = ifcopenshell.api.project.create_file(version="IFC4")
    proyecto_ifc = ifcopenshell.api.root.create_entity(
        f, ifc_class="IfcProject", name=proyecto["nombre"]
    )
    ifcopenshell.api.unit.assign_unit(f, length={"is_metric": True, "raw": "MILLIMETERS"})
    modelo = ifcopenshell.api.context.add_context(f, context_type="Model")
    cuerpo = ifcopenshell.api.context.add_context(
        f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=modelo
    )
    sitio = ifcopenshell.api.root.create_entity(
        f, ifc_class="IfcSite", name=proyecto["ubicacion"]["municipio"]
    )
    edificio = ifcopenshell.api.root.create_entity(
        f, ifc_class="IfcBuilding", name=proyecto["nombre"]
    )
    nivel = ifcopenshell.api.root.create_entity(f, ifc_class="IfcBuildingStorey", name="Cubierta")
    ifcopenshell.api.aggregate.assign_object(f, products=[sitio], relating_object=proyecto_ifc)
    ifcopenshell.api.aggregate.assign_object(f, products=[edificio], relating_object=sitio)
    ifcopenshell.api.aggregate.assign_object(f, products=[nivel], relating_object=edificio)

    for el in elems:
        clase, predefinido = CLASES[el.tipo]
        kwargs = {"ifc_class": clase, "name": el.id}
        if predefinido:
            kwargs["predefined_type"] = predefinido
        producto = ifcopenshell.api.root.create_entity(f, **kwargs)
        if clase == "IfcBuildingElementProxy":
            producto.ObjectType = NOMBRE_TIPO.get(el.tipo, el.tipo)
        rep = ifcopenshell.api.geometry.add_mesh_representation(
            f,
            context=cuerpo,
            vertices=[el.malla.vertices.tolist()],
            faces=[el.malla.faces.tolist()],
        )
        ifcopenshell.api.geometry.assign_representation(f, product=producto, representation=rep)
        ifcopenshell.api.spatial.assign_container(f, products=[producto], relating_structure=nivel)
        props = {k: v for k, v in el.propiedades.items() if v is not None}
        if props:
            pset = ifcopenshell.api.pset.add_pset(f, product=producto, name="Pset_SunnyCad")
            ifcopenshell.api.pset.edit_pset(f, pset=pset, properties=props)

    salida.parent.mkdir(parents=True, exist_ok=True)
    f.write(str(salida))
    return salida
