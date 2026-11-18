"""Render con Blender (se ejecuta dentro de Blender, sin interfaz).

    blender -b --factory-startup --python render_blender.py -- \
        <modelo.glb> <vistas.json> <carpeta_salida> [ancho alto muestras]

vistas.json: [{"nombre", "camara": [x, y, z], "objetivo": [x, y, z], "lente_mm"}, ...] en metros,
X este, Y norte, Z arriba (coordenadas del proyecto / 1000, así importa Blender el glTF).
"""

import json
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
glb, vistas_json, salida = args[0], args[1], args[2]
ancho, alto, muestras = (int(a) for a in (args[3:6] if len(args) >= 6 else (1600, 1000, 48)))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

# Material mate a partir del color de vértice/cara de glTF; los módulos algo brillantes.
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    for slot in obj.material_slots:
        mat = slot.material
        if mat and mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Roughness"].default_value = (
                    0.35 if obj.name.startswith("modulo") else 0.8
                )

escena = bpy.context.scene
escena.render.engine = "CYCLES"
escena.cycles.device = "CPU"
escena.cycles.samples = muestras
escena.cycles.use_denoising = True
try:
    escena.cycles.denoiser = "OPENIMAGEDENOISE"
except TypeError:
    escena.cycles.use_denoising = False
escena.render.resolution_x, escena.render.resolution_y = ancho, alto
try:
    escena.view_settings.view_transform = "AgX"
except TypeError:
    escena.view_settings.view_transform = "Filmic"
escena.view_settings.look = "None"

mundo = bpy.data.worlds.new("cielo")
mundo.use_nodes = True
mundo.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.78, 0.95, 1)
mundo.node_tree.nodes["Background"].inputs[1].default_value = 0.6
escena.world = mundo

sol = bpy.data.objects.new("sol", bpy.data.lights.new("sol", type="SUN"))
sol.data.energy = 3.0
sol.data.angle = 0.02
sol.rotation_euler = (math.radians(35), math.radians(15), math.radians(160))
escena.collection.objects.link(sol)

_v = json.load(open(vistas_json))
suelo_z = _v.get("suelo_z_m", -0.25) if isinstance(_v, dict) else -0.25
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, suelo_z))
suelo = bpy.context.active_object
mat_suelo = bpy.data.materials.new("suelo")
mat_suelo.use_nodes = True
mat_suelo.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
    0.42,
    0.44,
    0.40,
    1,
)
suelo.data.materials.append(mat_suelo)
for i, luz in enumerate(_v.get("luces", []) if isinstance(_v, dict) else []):
    datos = bpy.data.lights.new(f"techo{i}", type="AREA")
    datos.shape = "RECTANGLE"
    datos.size, datos.size_y = luz["tamano"]
    datos.energy = 2.5 * luz["tamano"][0] * luz["tamano"][1]
    obj_luz = bpy.data.objects.new(f"techo{i}", datos)
    obj_luz.location = luz["centro"]
    escena.collection.objects.link(obj_luz)


# ---------------------------------------------------------------- materiales
def material(nombre, color, rugosidad=0.7, emision=0.0):
    m = bpy.data.materials.new(nombre)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rugosidad
    if emision:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = emision
    return m


def madera(m, claro=(0.55, 0.36, 0.20), oscuro=(0.36, 0.22, 0.12), escala=18.0):
    """Vetas de madera procedimentales sobre un material existente."""
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    onda = nt.nodes.new("ShaderNodeTexWave")
    onda.inputs["Scale"].default_value = escala
    onda.inputs["Distortion"].default_value = 2.5
    onda.inputs["Detail"].default_value = 3.0
    rampa = nt.nodes.new("ShaderNodeValToRGB")
    rampa.color_ramp.elements[0].color = (*oscuro, 1)
    rampa.color_ramp.elements[1].color = (*claro, 1)
    nt.links.new(onda.outputs["Fac"], rampa.inputs["Fac"])
    nt.links.new(rampa.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.65
    return m


for mat in bpy.data.materials:
    if mat.name.startswith("madera"):
        madera(mat)


# ---------------------------------------------------------------- ambientación (solo render)
def caja(nombre, centro, medidas, mat, base, ux, uy):
    x, y, z = centro
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = nombre
    o.scale = medidas
    o.location = base + ux * x + uy * y + Vector((0, 0, z))
    o.rotation_euler = (0, 0, math.atan2(ux.y, ux.x))
    o.data.materials.append(mat)
    return o


def ambientar(a):
    base = Vector(a["centro"])
    ux, uy = (
        Vector((*a["ux"], 0)),
        Vector((*a["uy"], 0)),
    )  # largo de la pérgola / hacia afuera del muro
    L, F = a["largo_m"], a["fondo_m"]
    piso_madera = madera(
        material("deck", (0.5, 0.33, 0.2)), (0.62, 0.43, 0.26), (0.40, 0.26, 0.15), 3.0
    )
    tela = material("tela", (0.86, 0.83, 0.76), 0.95)
    cojin = material("cojin", (0.18, 0.42, 0.45), 0.95)
    tapete = material("tapete", (0.70, 0.40, 0.28), 1.0)
    metal = material("metal", (0.08, 0.08, 0.08), 0.4)
    matera = material("matera", (0.62, 0.32, 0.20), 0.8)
    hoja = material("hoja", (0.12, 0.38, 0.12), 0.7)
    luz = material("bombillo", (1.0, 0.72, 0.38), 0.3, emision=6.0)
    mesa = madera(material("mesa", (0.5, 0.33, 0.2)))

    caja("deck", (0, F / 2, 0.025), (L - 0.05, F - 0.05, 0.05), piso_madera, base, ux, uy)
    caja("tapete", (0, F * 0.45, 0.055), (3.0, 2.0, 0.01), tapete, base, ux, uy)
    # Sofá de tres puestos contra el muro, mirando hacia afuera
    caja("sofa-base", (0, 0.65, 0.25), (2.3, 0.9, 0.4), tela, base, ux, uy)
    caja("sofa-espaldar", (0, 0.25, 0.6), (2.3, 0.18, 0.7), tela, base, ux, uy)
    for i, dx in enumerate((-0.75, 0, 0.75)):
        caja(f"cojin-{i}", (dx, 0.42, 0.6), (0.45, 0.12, 0.4), cojin, base, ux, uy)
    caja("mesa-centro", (0, 1.85, 0.4), (1.2, 0.65, 0.06), mesa, base, ux, uy)
    for i, (dx, dy) in enumerate(((-0.55, -0.27), (0.55, -0.27), (-0.55, 0.27), (0.55, 0.27))):
        caja(f"pata-{i}", (dx, 1.85 + dy, 0.2), (0.05, 0.05, 0.38), metal, base, ux, uy)
    # Dos poltronas a los lados de la mesa, mirando hacia ella
    for i, sx in enumerate((-1, 1)):
        caja(f"poltrona-{i}", (sx * 1.35, 1.85, 0.25), (0.8, 0.85, 0.4), tela, base, ux, uy)
        caja(
            f"poltrona-espaldar-{i}", (sx * 1.7, 1.85, 0.55), (0.15, 0.85, 0.6), tela, base, ux, uy
        )
        caja(f"poltrona-cojin-{i}", (sx * 1.55, 1.85, 0.6), (0.12, 0.45, 0.4), cojin, base, ux, uy)
    # Plantas en materas
    for dx, dy in (
        (-L / 2 + 0.6, F - 0.8),
        (L / 2 - 0.6, F - 0.8),
        (-L / 2 + 0.5, 0.5),
        (L / 2 - 0.5, 0.5),
    ):
        pos = base + ux * dx + uy * dy
        if any((pos.xy - Vector(e)).length < 1.5 for e in a.get("evitar", [])):
            continue
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.25, depth=0.55, location=pos + Vector((0, 0, 0.3))
        )
        bpy.context.active_object.data.materials.append(matera)
        for ox, oy, oz, r in (
            (0, 0, 0.85, 0.35),
            (0.12, 0.1, 1.1, 0.25),
            (-0.1, -0.08, 1.05, 0.22),
        ):
            bpy.ops.mesh.primitive_ico_sphere_add(
                radius=r, subdivisions=2, location=pos + Vector((ox, oy, oz))
            )
            bpy.context.active_object.data.materials.append(hoja)
    # Guirnalda de luces cálidas bajo la viga exterior
    z_luz = a["z_luces_m"]
    for k in range(13):
        t = -L / 2 + 0.3 + k * (L - 0.6) / 12
        caida = 0.12 * math.sin(math.pi * ((k % 4) / 4))
        pos = base + ux * t + uy * (F - 0.25) + Vector((0, 0, z_luz - caida))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.025, location=pos)
        bpy.context.active_object.data.materials.append(luz)


camara = bpy.data.objects.new("camara", bpy.data.cameras.new("camara"))
escena.collection.objects.link(camara)
escena.camera = camara

datos_vistas = json.load(open(vistas_json))
if isinstance(datos_vistas, dict):
    if datos_vistas.get("ambientacion"):
        ambientar(datos_vistas["ambientacion"])
    datos_vistas = datos_vistas["vistas"]
for v in datos_vistas:
    camara.location = Vector(v["camara"])
    direccion = Vector(v["objetivo"]) - camara.location
    if v.get("ortho_m"):
        camara.rotation_euler = (0, 0, 0)  # cenital: mira hacia abajo con el norte (+Y) arriba
    else:
        camara.rotation_euler = direccion.to_track_quat("-Z", "Y").to_euler()
    if v.get("ortho_m"):
        camara.data.type = "ORTHO"
        camara.data.ortho_scale = v["ortho_m"]
    else:
        camara.data.type = "PERSP"
        camara.data.lens = v.get("lente_mm", 35)
    camara.data.clip_end = 500
    camara.data.clip_start = v.get("clip_inicio_m", 0.1)
    escena.render.filepath = f"{salida}/render_{v['nombre']}.png"
    bpy.ops.render.render(write_still=True)
