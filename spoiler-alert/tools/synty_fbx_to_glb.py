"""
Synty POLYGON FBX -> game-ready GLB, headless Blender.

Synty FBX files do NOT carry a usable texture path: on import the material has
no base color. Each pack ships ONE shared albedo atlas (a grid of flat colour
swatches). This script imports each FBX in an isolated scene, builds a fresh
Principled-BSDF material from the atlas PNG with NEAREST filtering (linear
bleeds across the swatch seams), assigns it to every mesh, and exports a
self-contained GLB (texture embedded -> offline-safe, matches the game's
relative-path model loading).

Usage (Blender 5.x; path on this machine shown):
    "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup --python synty_fbx_to_glb.py -- \
        <atlas.png> <out_dir> <model1.fbx> [model2.fbx ...]

Output: <out_dir>/<model-name>.glb for each input FBX.

Notes:
- The game auto-normalizes each model's footprint by bounding box, so absolute
  FBX scale doesn't matter; default FBX import + Y-up glTF export sits upright.
- Skip Synty env props flagged "Uses custom shader" in the pack's MaterialList
  (e.g. Rainbow_Plane) -- they aren't real textured props.
"""
import bpy, sys, os


def args_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def build_atlas_material(atlas_path):
    """Fresh Principled material whose base color is the pack atlas (nearest)."""
    mat = bpy.data.materials.new(name="SyntyAtlas")
    mat.use_fake_user = True          # pin it so a batch purge can't collect it
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(atlas_path, check_existing=True)
    tex.image = img
    tex.interpolation = "Closest"     # crisp flat swatches; glTF carries NEAREST sampler
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    # Synty albedo is unlit-flat in feel; keep it matte
    bsdf.inputs["Roughness"].default_value = 0.9
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.1
    return mat


def convert_one(fbx_path, atlas_path, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)   # isolate every file
    bpy.ops.import_scene.fbx(filepath=fbx_path)
    mat = build_atlas_material(atlas_path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    name = os.path.splitext(os.path.basename(fbx_path))[0]
    out_path = os.path.join(out_dir, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",          # embeds the texture into the binary
        use_selection=False,
    )
    print("  -> %s  (%d mesh%s)" % (out_path, len(meshes), "" if len(meshes) == 1 else "es"))


def main():
    a = args_after_dashes()
    if len(a) < 3:
        print("usage: ... -- <atlas.png> <out_dir> <model1.fbx> [model2.fbx ...]")
        return
    atlas, out_dir, fbx_list = a[0], a[1], a[2:]
    os.makedirs(out_dir, exist_ok=True)
    print("atlas: %s\nout:   %s\nfiles: %d" % (atlas, out_dir, len(fbx_list)))
    for fbx in fbx_list:
        print("converting %s" % fbx)
        convert_one(fbx, atlas, out_dir)
    print("done.")


if __name__ == "__main__":
    main()
