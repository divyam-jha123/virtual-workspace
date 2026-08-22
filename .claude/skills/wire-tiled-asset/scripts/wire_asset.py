#!/usr/bin/env python3
"""Wire a raw PNG into a Vorkium Tiled tileset + the map-mcp asset catalog.

Given an image someone dropped in (any resolution, any aspect ratio), this:
  1. Scales it down to fit the project's tile grid if it's oversized.
  2. Copies it into content/tiles/props/ (source, used by the .tsx Tiled opens)
     and content/tilesets/ (flat copy, used by the .tsj map-mcp/the game load).
  3. Appends a <tile> entry to <tileset>.tsj and <tileset>.tsx.
  4. Appends (or updates in place, if re-run) a record in
     content/assets/catalog.json so search_assets / get_asset / place_asset can
     find it.

Usage:
  python3 wire_asset.py --image /path/to/sofa.png --tileset office-props \
      --name "Big sofa" --category furniture --tags sofa,couch,seating

Re-running with the same --name/--tileset (or an explicit --asset-id) updates
the existing tile + catalog entry in place rather than creating a duplicate —
identity is the catalog asset id, not the filename derived from --name, so
renaming later won't orphan the original tile.

Run from anywhere; paths are resolved relative to the repo root (found by
walking up from this script to the directory containing content/tilesets/).
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "content" / "tilesets").is_dir():
            return candidate
    sys.exit("Could not find repo root (looked for content/tilesets/ upward from here)")


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "asset"


def scale_to_fit(img: Image.Image, max_dim: int) -> Image.Image:
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    factor = max_dim / max(w, h)
    new_size = (max(1, round(w * factor)), max(1, round(h * factor)))
    return img.resize(new_size, Image.LANCZOS)


def load_catalog(catalog_path: Path) -> tuple[dict | list, list]:
    data = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"assets": []}
    assets = data["assets"] if isinstance(data, dict) else data
    return data, assets


def find_asset(assets: list, asset_id: str) -> dict | None:
    return next((a for a in assets if a.get("id") == asset_id), None)


def load_tsj(tsj_path: Path) -> dict:
    return json.loads(tsj_path.read_text())


def find_tile_by_id(tsj: dict, tile_id: int) -> dict | None:
    return next((t for t in tsj["tiles"] if t["id"] == tile_id), None)


def find_tile_by_image(tsj: dict, filename: str) -> dict | None:
    return next((t for t in tsj["tiles"] if t["image"] == filename), None)


def update_tsj(tsj_path: Path, filename: str, w: int, h: int) -> int:
    tsj = load_tsj(tsj_path)
    existing = find_tile_by_image(tsj, filename)
    if existing:
        existing["imagewidth"] = w
        existing["imageheight"] = h
        tile_id = existing["id"]
    else:
        ids = [t["id"] for t in tsj["tiles"]]
        tile_id = (max(ids) + 1) if ids else 0
        tsj["tiles"].append({"id": tile_id, "image": filename, "imagewidth": w, "imageheight": h})
        tsj["tilecount"] = len(tsj["tiles"])
    tsj_path.write_text(json.dumps(tsj, indent=2) + "\n")
    return tile_id


def update_tsx(tsx_path: Path, tile_id: int, filename: str, w: int, h: int) -> None:
    """Text-based edit — never round-trip through an XML library here.

    Tiled and this project's other .tsx files use a specific hand-written style
    (self-closing tags with no space before `/>`, 1-space tile indent). An
    ElementTree parse+write reformats the *entire* file (quote style, tag
    spacing) even for untouched lines, turning a 2-line change into a 70-line
    diff. Plain string edits keep the diff to just what changed.
    """
    if not tsx_path.exists():
        return
    text = tsx_path.read_text()
    rel_source = f"../tiles/props/{filename}"

    img_re = re.compile(r'(<image source="' + re.escape(rel_source) + r'" width=")\d+(" height=")\d+("/>)')
    if img_re.search(text):
        text = img_re.sub(lambda m: f"{m.group(1)}{w}{m.group(2)}{h}{m.group(3)}", text, count=1)
        tsx_path.write_text(text)
        return

    new_tile = f' <tile id="{tile_id}">\n  <image source="{rel_source}" width="{w}" height="{h}"/>\n </tile>\n'
    if "</tileset>" not in text:
        sys.exit(f"{tsx_path} has no </tileset> closing tag — refusing to guess where to insert")
    text = text.replace("</tileset>", new_tile + "</tileset>", 1)

    text = re.sub(r'tilecount="(\d+)"', lambda m: f'tilecount="{int(m.group(1)) + 1}"', text, count=1)
    for attr, val in (("tilewidth", w), ("tileheight", h)):
        m = re.search(rf'{attr}="(\d+)"', text)
        if m and val > int(m.group(1)):
            text = text[: m.start()] + f'{attr}="{val}"' + text[m.end() :]

    tsx_path.write_text(text)


def update_catalog(
    catalog_path: Path,
    data,
    assets: list,
    asset_id: str,
    name: str,
    category: str,
    subcategory: str,
    tags: list[str],
    style: str,
    tile_size: int,
    tileset_id: str,
    tile_id: int,
    w: int,
    h: int,
    placement: str,
    blocking: bool,
) -> None:
    entry = {
        "id": asset_id,
        "name": name,
        "category": category,
        "tags": tags,
        "tileSize": tile_size,
        "dimensions": {
            "width": max(1, math.ceil(w / tile_size)),
            "height": max(1, math.ceil(h / tile_size)),
        },
        "placement": placement,
        "tilesetId": tileset_id,
        "tileId": tile_id,
        "version": "1",
        "subcategory": subcategory,
        "style": style,
        "source": {"author": "unknown (see content/tiles/ATTRIBUTION.md)", "license": "Unconfirmed"},
    }
    if blocking:
        entry["collision"] = {"blocking": True}

    existing_idx = next((i for i, a in enumerate(assets) if a.get("id") == asset_id), None)
    if existing_idx is not None:
        assets[existing_idx] = entry
    else:
        assets.append(entry)

    if isinstance(data, dict):
        data["assets"] = assets
    else:
        data = assets
    catalog_path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--image", required=True, help="Path to the source PNG (any size/aspect ratio)")
    p.add_argument("--tileset", required=True, help="Target tileset id, e.g. office-props (must already have a .tsj)")
    p.add_argument("--name", required=True, help='Display name, e.g. "Big sofa"')
    p.add_argument("--category", default="furniture")
    p.add_argument("--subcategory", default="")
    p.add_argument("--tags", default="", help="Comma-separated, e.g. sofa,couch,seating")
    p.add_argument("--style", default="office")
    p.add_argument("--placement", default="floor", choices=["floor", "wall", "ceiling", "overlay"])
    p.add_argument("--no-blocking", action="store_true", help="Asset does not block movement")
    p.add_argument("--max-dim", type=int, default=48, help="Max pixel dimension before downscaling (default 48, ~3 tiles)")
    p.add_argument("--asset-id", default="", help="Override the generated catalog id (also the key used to detect a re-run)")
    p.add_argument("--repo-root", default="", help="Override auto-detected repo root")
    args = p.parse_args()

    repo_root = Path(args.repo_root).resolve() if args.repo_root else find_repo_root(Path(__file__).resolve())
    tilesets_dir = repo_root / "content" / "tilesets"
    props_dir = repo_root / "content" / "tiles" / "props"
    catalog_path = repo_root / "content" / "assets" / "catalog.json"

    tsj_path = tilesets_dir / f"{args.tileset}.tsj"
    tsx_path = tilesets_dir / f"{args.tileset}.tsx"
    if not tsj_path.exists():
        sys.exit(f"{tsj_path} does not exist — this script only appends to an existing image-collection tileset")

    src_image = Path(args.image).expanduser().resolve()
    if not src_image.exists():
        sys.exit(f"Image not found: {src_image}")

    tileset_prefix = args.tileset.split("-")[0]
    slug = slugify(args.name)
    asset_id = args.asset_id or f"{tileset_prefix}.{slug}"

    data, assets = load_catalog(catalog_path)
    existing_asset = find_asset(assets, asset_id)

    # Identity is the catalog asset id. If this asset already exists, reuse its
    # existing tile/filename so a re-run under a *different* --name updates the
    # same tile in place instead of creating a duplicate tile + orphaned entry.
    if existing_asset:
        tsj = load_tsj(tsj_path)
        existing_tile = find_tile_by_id(tsj, existing_asset["tileId"])
        filename = existing_tile["image"] if existing_tile else f"{slug}.png"
    else:
        filename = f"{slug}.png"

    img = Image.open(src_image).convert("RGBA")
    orig_size = img.size
    img = scale_to_fit(img, args.max_dim)
    w, h = img.size

    props_dir.mkdir(parents=True, exist_ok=True)
    img.save(props_dir / filename)
    img.save(tilesets_dir / filename)

    tile_id = update_tsj(tsj_path, filename, w, h)
    update_tsx(tsx_path, tile_id, filename, w, h)

    tags = [t.strip() for t in args.tags.split(",") if t.strip()] or [slug]
    tile_size = 16

    update_catalog(
        catalog_path,
        data,
        assets,
        asset_id=asset_id,
        name=args.name,
        category=args.category,
        subcategory=args.subcategory or args.category,
        tags=tags,
        style=args.style,
        tile_size=tile_size,
        tileset_id=args.tileset,
        tile_id=tile_id,
        w=w,
        h=h,
        placement=args.placement,
        blocking=not args.no_blocking,
    )

    action = "Updated" if existing_asset else "Wired up"
    print(f"{action}: {asset_id}")
    print(f"  source image : {src_image} ({orig_size[0]}x{orig_size[1]})")
    print(f"  saved as     : {filename} ({w}x{h})" + (" [scaled down]" if img.size != orig_size else ""))
    print(f"  tileset      : {args.tileset}.tsj / .tsx, tile id {tile_id}")
    print(f"  catalog      : content/assets/catalog.json -> {asset_id}")
    print("  NOTE: map-mcp caches the catalog at startup — restart the map-mcp server")
    print("        (or your MCP session) before search_assets/get_asset will see it.")


if __name__ == "__main__":
    main()
