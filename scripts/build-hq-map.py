#!/usr/bin/env python3
"""Build content/maps/vorkium-hq.tmj - a 10-room top-down office floor plan.

The art is LimeZu Modern Exteriors; there is no Modern Interiors pack in this
repo, so every indoor fixture is the closest stand-in the pack offers (subway
station consoles as desks, waiting seats as office chairs, sidewalk fills as
room floors, asphalt as wall). Swapping in real interiors art later is a
per-asset find/replace, not a rebuild.
"""
import json, os, random, re
random.seed(11)

W, H = 84, 66
OUT = 'maps/vorkium-hq.tmj'

# --------------------------------------------------------------------------
# catalog + tileset binding

CAT = {}
for f in sorted(os.listdir('assets')):
    if f.endswith('-catalog.json'):
        for a in json.load(open('assets/' + f))['assets']:
            CAT[a['id']] = a

TILESETS = ['limezu-terrains_and_fences', 'limezu-office', 'limezu-garden',
            'limezu-city_props', 'limezu-city_terrains', 'limezu-subway_and_train_station']
FIRSTGID, tilesets_json, next_gid = {}, [], 1
for ts in TILESETS:
    meta = json.load(open(f'tilesets/{ts}.tsj'))
    FIRSTGID[ts] = next_gid
    tilesets_json.append({'firstgid': next_gid, 'source': f'../tilesets/{ts}.tsj'})
    next_gid += meta['tilecount']

_RESOLVED = {}
def resolve(asset_id):
    """Assets are exported with variant suffixes (foo, foo_1, foo_2); accept the base name."""
    if asset_id in _RESOLVED: return _RESOLVED[asset_id]
    hit = asset_id if asset_id in CAT else None
    if hit is None:
        cands = sorted(k for k in CAT if re.fullmatch(re.escape(asset_id) + r'_\d+', k))
        if not cands: raise KeyError('no asset matching ' + asset_id)
        hit = cands[0]
    _RESOLVED[asset_id] = hit
    return hit

def gid(asset_id):
    a = CAT[resolve(asset_id)]
    return FIRSTGID[a['tilesetId']] + a['tileId']

# --------------------------------------------------------------------------
# layers

LAYER_KIND = [('Ground','tilelayer'),('Ground_Details','tilelayer'),('Walls','tilelayer'),
              ('Furniture','objectgroup'),('Decorations','objectgroup'),('Collision','tilelayer'),
              ('Objects','objectgroup'),('SpawnPoints','objectgroup'),
              ('InteractionZones','objectgroup'),('AbovePlayer','tilelayer'),
              ('Labels','objectgroup')]
layers, L = [], {}
for i,(name,kind) in enumerate(LAYER_KIND):
    l = {'id': i+1, 'name': name, 'type': kind, 'opacity': 1, 'visible': True, 'x': 0, 'y': 0}
    if kind == 'tilelayer':
        l.update({'width': W, 'height': H, 'data': [0]*(W*H)})
    else:
        l.update({'draworder': 'topdown', 'objects': []})
    layers.append(l); L[name] = l

def setp(layer, x, y, g):
    if 0 <= x < W and 0 <= y < H:
        L[layer]['data'][y*W + x] = g

def fill(layer, x0, y0, x1, y1, g):
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            setp(layer, x, y, g)

WALL_GID = gid('limezu.city_terrains.asphalt_1_variation_16')
def wall(x0, y0, x1, y1):
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            setp('Walls', x, y, WALL_GID); setp('Collision', x, y, 1)

def clear_wall(x0, y0, x1, y1):          # punch a doorway
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            setp('Walls', x, y, 0); setp('Collision', x, y, 0)

FLOOR = {
    'cream':  'limezu.city_terrains.sidewalk_1_9',
    'tan':    'limezu.city_terrains.sidewalk_2_9',
    'grey':   'limezu.city_terrains.sidewalk_3_9',
    'silver': 'limezu.city_terrains.sidewalk_4_9',
    'blue':   'limezu.city_terrains.sidewalk_5_9',
    'warm':   'limezu.city_terrains.sidewalk_6_9',
    'white':  'limezu.subway_and_train_station.white_tile_1',
    'lilac':  'limezu.subway_and_train_station.lilac_tile_1_vers_1',
    'lilac2': 'limezu.subway_and_train_station.lilac_tile_3_vers_1',
    'lilac3': 'limezu.subway_and_train_station.lilac_tile_5_vers_1',
    'grass':  'limezu.terrains_and_fences.grass_1_22',
}
def floor(x0, y0, x1, y1, kind):
    fill('Ground', x0, y0, x1, y1, gid(FLOOR[kind]))

# --------------------------------------------------------------------------
# objects

nid = 1
def obj(layer, props):
    global nid
    o = {'id': nid, 'rotation': 0, 'visible': True, 'x': 0, 'y': 0,
         'width': 0, 'height': 0, 'name': ''}
    o.update(props); L[layer]['objects'].append(o); nid += 1
    return o['id']

def put(asset_id, tx, ty, layer=None, name=None, block=None, trunk_only=True):
    """Place a catalog asset with Tiled's bottom-left gid anchoring."""
    asset_id = resolve(asset_id)
    a = CAT[asset_id]
    w, h = a['dimensions']['width'], a['dimensions']['height']
    layer = layer or ('Decorations' if a['category'] == 'decoration' else 'Furniture')
    oid = obj(layer, {'gid': gid(asset_id), 'name': name or a['name'],
                      'width': w*16, 'height': h*16, 'x': tx*16, 'y': (ty+h)*16})
    blocking = a['collision']['blocking'] if block is None else block
    if blocking:
        rows = [ty+h-1] if (trunk_only and h > 2) else range(ty, ty+h)
        for yy in rows:
            for xx in range(tx, tx+w):
                setp('Collision', xx, yy, 1)
    return oid

def prop(name, value):
    t = 'bool' if isinstance(value, bool) else ('int' if isinstance(value, int) else 'string')
    return {'name': name, 'type': t, 'value': value}

def typed(cls, layer, tx, ty, w=1, h=1, name='', props=None):
    return obj(layer, {'class': cls, 'name': name, 'x': tx*16, 'y': ty*16,
                       'width': w*16, 'height': h*16,
                       'properties': [prop(k, v) for k, v in (props or {}).items()]})

def label(text, tx, ty, w, h=1):
    obj('Labels', {'name': text, 'x': tx*16, 'y': ty*16, 'width': w*16, 'height': h*16,
                   'text': {'text': text, 'color': '#ffffff', 'bold': True,
                            'halign': 'center', 'valign': 'center',
                            'pixelsize': 11, 'wrap': True}})

# ==========================================================================
# 1. shell
# ==========================================================================
GRASS_X1 = 6                     # outdoor strip x 0..6
BX0, BY0, BX1, BY1 = 7, 1, 82, 64   # outer wall rectangle
IX0, IX1 = 8, 81

floor(0, 0, W-1, H-1, 'grass')
for _ in range(260):                      # grass texture variation
    x, y = random.randrange(0, GRASS_X1+1), random.randrange(H)
    setp('Ground', x, y, gid(f'limezu.terrains_and_fences.grass_1_{random.choice([9,10,11,12])}'))

# band geometry
B1 = (2, 17)      # top rooms
HALLA = (19, 23)
B2 = (25, 40)     # middle rooms
HALLB = (42, 46)
B3 = (48, 63)     # bottom rooms
WALL_ROWS = [18, 24, 41, 47]

ROOMS = {
    # key: (x0, y0, x1, y1, floor, label, number)
    'reception':  (IX0, B1[0], 25, B1[1], 'cream',  '1. RECEPTION LOBBY', 1),
    'workstation':(27,   B1[0], 44, B1[1], 'grey',   '2. WORKSTATION AREA', 2),
    'meeting':    (46,   B1[0], 63, B1[1], 'white',  '3. MEETING ROOM', 3),
    'break':      (65,   B1[0], IX1, B1[1],'lilac',  '4. BREAK ROOM', 4),
    'library':    (IX0, B2[0], 25, B2[1], 'grey',   '5. LIBRARY / RESOURCE ROOM', 5),
    'recreation': (27,   B2[0], 57, B2[1], 'lilac2', '', 0),
    'project':    (59,   B2[0], IX1, B2[1],'grey',   '7. PROJECT ROOM', 7),
    'lounge':     (IX0, B3[0], 25, B3[1], 'lilac',  '6. LOUNGE AREA', 6),
    'developer':  (27,   B3[0], 44, B3[1], 'grey',   '8. DEVELOPER ZONE', 8),
    'hr':         (46,   B3[0], 63, B3[1], 'cream',  '9. HR CABIN', 9),
    'terrace':    (65,   B3[0], IX1, B3[1],'warm',   '10. GARDEN TERRACE', 10),
}

# floors: halls first, then rooms on top
floor(IX0, HALLA[0], IX1, HALLA[1], 'tan')
floor(IX0, HALLB[0], IX1, HALLB[1], 'tan')
for x0, y0, x1, y1, f, _, _ in ROOMS.values():
    floor(x0, y0, x1, y1, f)

# outer shell + band walls
wall(BX0, BY0, BX1, BY0); wall(BX0, BY1, BX1, BY1)
wall(BX0, BY0, BX0, BY1); wall(BX1, BY0, BX1, BY1)
for y in WALL_ROWS:
    wall(IX0-1, y, IX1+1, y)
# vertical dividers, per band
for (y0, y1), xs in [(B1, [26, 45, 64]), (B2, [26, 58]), (B3, [26, 45, 64])]:
    for x in xs:
        wall(x, y0-1, x, y1+1)

# ==========================================================================
# 2. doorways
# ==========================================================================
DOORS = []   # (tx, ty, orientation, name, locked)
def doorway(x0, y0, x1, y1, name, locked=False, sprite=True):
    clear_wall(x0, y0, x1, y1)
    horiz = (x1 - x0) >= (y1 - y0)
    # keep the floor continuous through the gap
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            if L['Ground']['data'][y*W+x] == 0 or True:
                setp('Ground', x, y, gid(FLOOR['tan']))
    DOORS.append((x0, y0, x1-x0+1, y1-y0+1, name, locked, horiz, sprite))

# top rooms -> hall A (wall row 18)
doorway(20, 18, 23, 18, 'Reception Door')
doorway(34, 18, 37, 18, 'Workstation Door')
doorway(53, 18, 56, 18, 'Meeting Room Door')
doorway(71, 18, 74, 18, 'Break Room Door')
# hall A -> middle band (wall row 24)
doorway(15, 24, 18, 24, 'Library Door')
doorway(38, 24, 46, 24, 'Recreation North Arch', sprite=False)
doorway(68, 24, 71, 24, 'Project Room Door')
# middle band -> hall B (wall row 41)
doorway(15, 41, 18, 41, 'Library South Door')
doorway(38, 41, 46, 41, 'Recreation South Arch', sprite=False)
doorway(68, 41, 71, 41, 'Project South Door')
# hall B -> bottom rooms (wall row 47)
doorway(15, 47, 18, 47, 'Lounge Door')
doorway(34, 47, 37, 47, 'Developer Door')
doorway(53, 47, 56, 47, 'HR Cabin Door')
doorway(71, 47, 74, 47, 'Terrace Door')
# recreation opens west into the library corridor
doorway(26, 30, 26, 34, 'Recreation West Arch', sprite=False)
doorway(58, 30, 58, 34, 'Recreation East Arch', sprite=False)
# main entrance from the grass strip
doorway(BX0, 8, BX0, 11, 'Main Entrance')

# entrance path across the grass
fill('Ground', 0, 8, BX0-1, 11, gid(FLOOR['tan']))

# ==========================================================================
# 3. furniture
# ==========================================================================
SEATS = []      # collected for workstation wiring

def desk_row(x, y, n, spacing=4, chair='black_single_wait_seat', facing='up'):
    """A run of console-desks with a chair below each."""
    ids = []
    for i in range(n):
        dx = x + i*spacing
        put(f'limezu.subway_and_train_station.{random.choice(["control_pc","control_box","control_big_monitor","control_small_monitor"])}',
            dx, y, 'Furniture', 'Desk')
        cy = y + 2
        put(f'limezu.subway_and_train_station.{chair}', dx, cy, 'Furniture', 'Office Chair')
        ids.append(typed('seat', 'Objects', dx, cy, 1, 2, 'Desk Seat',
                         {'facing': facing, 'seatType': 'deskchair'}))
    return ids

S = 'limezu.subway_and_train_station'
G = 'limezu.garden'
C = 'limezu.city_props'

# ---- 1. Reception lobby ---------------------------------------------------
x0, y0, x1, y1, *_ = ROOMS['reception']
fill('Ground', x0+3, y0+7, x1-3, y1-2, gid(FLOOR['lilac']))     # rug
put(f'{S}.turnstile_closed', 9, 8, 'Furniture', 'Entry Turnstile')
put(f'{S}.control_box', 15, 5, 'Furniture', 'Reception Desk')
put(f'{S}.control_pc', 17, 5, 'Furniture', 'Reception Desk')
put(f'{S}.control_box', 19, 5, 'Furniture', 'Reception Desk')
put(f'{S}.black_single_wait_seat', 17, 7, 'Furniture', 'Receptionist Chair')
SEATS.append(typed('seat', 'Objects', 17, 7, 1, 2, 'Reception Seat',
                   {'facing': 'up', 'seatType': 'deskchair'}))
put(f'{S}.white_triple_wait_seat', 12, 12, 'Furniture', 'Lobby Seating')
put(f'{S}.white_triple_wait_seat', 20, 12, 'Furniture', 'Lobby Seating')
put(f'{S}.white_couple_wait_seat', 16, 15, 'Furniture', 'Lobby Seating')
put(f'{S}.elevator_opened_lights_off', 23, 3, 'Decorations', 'Elevator')
put(f'{S}.elevator_closed_lights_off', 21, 3, 'Decorations', 'Elevator')
put(f'{S}.three_posters', 10, 3, 'Decorations', 'Lobby Posters')
for px, py in [(9,14),(24,14),(9,4),(24,10)]:
    put(f'{S}.plant_vase_1', px, py, 'Decorations', 'Plant')

# ---- 2. Workstation area --------------------------------------------------
SEATS += desk_row(29, 4, 4)
SEATS += desk_row(29, 10, 4)
put(f'{S}.small_black_locker', 42, 3, 'Furniture', 'Filing Cabinet')
put(f'{S}.small_black_locker', 42, 6, 'Furniture', 'Filing Cabinet')
put(f'{S}.drink_machine_front', 42, 12, 'Furniture', 'Water Cooler')
put(f'{S}.map_monitor', 34, 2, 'Decorations', 'Team Board')
for px, py in [(28,15),(43,16)]:
    put(f'{S}.plant_vase_2', px, py, 'Decorations', 'Plant')

# ---- 3. Meeting room ------------------------------------------------------
put(f'{S}.monitor', 54, 3, 'Decorations', 'Presentation Screen')
put(f'{S}.map_monitor', 58, 3, 'Decorations', 'Whiteboard')
for i in range(3):                                    # conference table
    put(f'{S}.double_wood_board', 53+i*2, 7, 'Furniture', 'Conference Table')
for i in range(3):                                    # chairs both sides
    SEATS.append(typed('seat', 'Objects', 52, 8+i*2, 1, 2, 'Meeting Seat',
                       {'facing': 'right', 'seatType': 'chair'}))
    put(f'{S}.black_single_wait_seat', 52, 8+i*2, 'Furniture', 'Meeting Chair')
    SEATS.append(typed('seat', 'Objects', 59, 8+i*2, 1, 2, 'Meeting Seat',
                       {'facing': 'left', 'seatType': 'chair'}))
    put(f'{S}.black_single_wait_seat', 59, 8+i*2, 'Furniture', 'Meeting Chair')
for px, py in [(47,4),(62,4),(47,15),(62,15)]:
    put(f'{S}.plant_vase_1', px, py, 'Decorations', 'Plant')

# ---- 4. Break room --------------------------------------------------------
put(f'{S}.coffee_machine_front', 66, 3, 'Furniture', 'Coffee Machine')
put(f'{S}.drink_machine_front', 69, 3, 'Furniture', 'Vending Machine')
put(f'{G}.big_shelf', 73, 3, 'Furniture', 'Pantry Shelf')
put(f'{G}.big_shelf', 77, 3, 'Furniture', 'Pantry Shelf')
for i, (bx, by) in enumerate([(67,8),(72,8),(77,8),(67,13),(72,13),(77,13)]):
    put(f'{S}.guitarist_stand', bx, by, 'Furniture', 'Cafe Table')
    put(f'{S}.orange_couple_wait_seat', bx, by+2, 'Furniture', 'Cafe Seating')
    SEATS.append(typed('seat', 'Objects', bx, by+2, 2, 2, 'Cafe Seat',
                       {'facing': 'up', 'seatType': 'stool'}))
put(f'{G}.liana_shelf_1', 80, 5, 'Decorations', 'Hanging Plants')

# ---- 5. Library / resource room -------------------------------------------
for i in range(4):
    put(f'{G}.big_shelf', 9, 27+i*3, 'Furniture', 'Bookshelf')
    put(f'{G}.big_shelf', 13, 27+i*3, 'Furniture', 'Bookshelf')
for i in range(2):
    put(f'{S}.double_wood_board', 19+i*2, 30, 'Furniture', 'Study Table')
put(f'{S}.three_seats_grey_bench_frontal', 19, 34, 'Furniture', 'Study Bench')
SEATS.append(typed('seat', 'Objects', 19, 34, 3, 1, 'Study Seat',
                   {'facing': 'up', 'seatType': 'chair'}))
put(f'{S}.map_monitor', 22, 26, 'Decorations', 'Resource Board')
put(f'{S}.plant_vase_1', 24, 38, 'Decorations', 'Plant')

# ---- recreation (central open area) ---------------------------------------
fill('Ground', 30, 28, 54, 38, gid(FLOOR['lilac3']))
put(f'{S}.three_seats_green_bench_frontal', 33, 30, 'Furniture', 'Lounge Sofa')
put(f'{S}.three_seats_green_bench_frontal', 33, 36, 'Furniture', 'Lounge Sofa')
put(f'{S}.guitarist_stand', 34, 33, 'Furniture', 'Coffee Table')
put(f'{S}.two_seats_grey_bench_lateral_1', 31, 32, 'Furniture', 'Lounge Sofa')
put(f'{S}.two_seats_grey_bench_lateral_1', 38, 32, 'Furniture', 'Lounge Sofa')
for i in range(3):                                     # ping-pong stand-in
    put(f'{S}.double_wood_board', 44+i*2, 31, 'Furniture', 'Game Table')
put(f'{S}.orange_triple_wait_seat', 44, 36, 'Furniture', 'Game Seating')
put(f'{S}.black_triple_wait_seat', 49, 36, 'Furniture', 'Game Seating')
put(f'{S}.big_pillar', 29, 27, 'Decorations', 'Pillar')
put(f'{S}.big_pillar', 55, 27, 'Decorations', 'Pillar')
put(f'{S}.big_pillar', 29, 39, 'Decorations', 'Pillar')
put(f'{S}.big_pillar', 55, 39, 'Decorations', 'Pillar')
for px, py in [(32,27),(52,27),(32,39),(52,39),(42,27)]:
    put(f'{S}.plant_vase_2', px, py, 'Decorations', 'Plant')

# ---- 7. Project room ------------------------------------------------------
put(f'{S}.map_monitor', 66, 26, 'Decorations', 'Project Board')
put(f'{S}.monitor', 70, 26, 'Decorations', 'Roadmap Screen')
SEATS += desk_row(61, 30, 3)
SEATS += desk_row(61, 35, 3)
put(f'{S}.small_black_locker', 78, 27, 'Furniture', 'Archive')
put(f'{S}.plant_vase_1', 80, 38, 'Decorations', 'Plant')

# ---- 6. Lounge area -------------------------------------------------------
put(f'{S}.monitor', 12, 49, 'Decorations', 'Lounge TV')
put(f'{S}.three_seats_black_bench_frontal', 11, 54, 'Furniture', 'Lounge Sofa')
put(f'{S}.two_seats_black_bench_lateral_1', 16, 53, 'Furniture', 'Lounge Sofa')
put(f'{S}.guitarist_stand', 12, 57, 'Furniture', 'Coffee Table')
put(f'{S}.white_couple_wait_seat', 20, 51, 'Furniture', 'Lounge Chairs')
put(f'{S}.orange_couple_wait_seat', 20, 56, 'Furniture', 'Lounge Chairs')
for i in range(2):
    put(f'{S}.double_wood_board', 9+i*2, 60, 'Furniture', 'Games Table')
put(f'{G}.liana_shelf_1', 24, 50, 'Decorations', 'Hanging Plants')
put(f'{S}.plant_vase_2', 9, 50, 'Decorations', 'Plant')

# ---- 8. Developer zone ----------------------------------------------------
SEATS += desk_row(29, 51, 4)
SEATS += desk_row(29, 57, 4)
put(f'{S}.small_black_locker', 42, 50, 'Furniture', 'Server Rack')
put(f'{S}.small_black_locker', 42, 53, 'Furniture', 'Server Rack')
put(f'{S}.map_monitor', 34, 49, 'Decorations', 'Sprint Board')
put(f'{S}.plant_vase_1', 43, 62, 'Decorations', 'Plant')

# ---- 9. HR cabin ----------------------------------------------------------
fill('Ground', 49, 52, 60, 60, gid(FLOOR['lilac']))     # rug
put(f'{S}.control_box', 52, 51, 'Furniture', 'HR Desk')
put(f'{S}.control_pc', 54, 51, 'Furniture', 'HR Desk')
put(f'{S}.control_box', 56, 51, 'Furniture', 'HR Desk')
put(f'{S}.black_single_wait_seat', 54, 53, 'Furniture', 'HR Chair')
SEATS.append(typed('seat', 'Objects', 54, 53, 1, 2, 'HR Seat',
                   {'facing': 'up', 'seatType': 'deskchair'}))
put(f'{S}.white_couple_wait_seat', 52, 57, 'Furniture', 'Visitor Seating')
put(f'{S}.white_couple_wait_seat', 57, 57, 'Furniture', 'Visitor Seating')
put(f'{S}.guitarist_stand', 55, 57, 'Furniture', 'Side Table')
put(f'{G}.big_shelf', 47, 50, 'Furniture', 'HR Files')
put(f'{S}.small_black_locker', 61, 50, 'Furniture', 'Personnel Files')
put(f'{S}.three_posters', 49, 49, 'Decorations', 'Notices')
put(f'{S}.plant_vase_2', 62, 62, 'Decorations', 'Plant')

# ---- 10. Garden terrace ---------------------------------------------------
x0, y0, x1, y1, *_ = ROOMS['terrace']
floor(x0, y0, x1, y1, 'grass')                       # lawn
floor(x0+3, y0+3, x1-3, y1-3, 'tan')                # wooden deck in the middle
put(f'{G}.pergola_structure', 71, 55, 'Decorations', 'Terrace Pergola')
put(f'{G}.pergola_roof', 71, 53, 'Decorations', 'Terrace Pergola Roof')
put(f'{G}.square_bench', 69, 52, 'Furniture', 'Terrace Bench')
put(f'{G}.square_bench', 76, 52, 'Furniture', 'Terrace Bench')
put(f'{G}.big_bench_horizontal', 68, 60, 'Furniture', 'Terrace Bench')
put(f'{G}.big_bench_horizontal', 76, 60, 'Furniture', 'Terrace Bench')
SEATS.append(typed('seat', 'Objects', 69, 52, 2, 2, 'Terrace Seat',
                   {'facing': 'down', 'seatType': 'sofa'}))
SEATS.append(typed('seat', 'Objects', 76, 52, 2, 2, 'Terrace Seat',
                   {'facing': 'down', 'seatType': 'sofa'}))
put(f'{G}.fountain_1_1', 79, 56, 'Decorations', 'Terrace Fountain')
put(f'{G}.flowers_bench_horizontal', 66, 55, 'Furniture', 'Flower Bench')
for i in range(5):                                   # planter border
    put(f'{G}.bush_{random.randint(1,5)}', 66+i*4, 49, 'Decorations', 'Shrub', block=False)
    put(f'{G}.bush_{random.randint(1,5)}', 68+i*3, 62, 'Decorations', 'Shrub', block=False)
for px, py in [(66,51),(80,51),(66,60),(80,62)]:
    put(f'{C}.tree_2', px, py, 'Decorations', 'Terrace Tree')

# ---- outdoor grass strip --------------------------------------------------
occupied = set()
for y in range(8, 12):
    for x in range(0, BX0):
        occupied.add((x, y))
placed = 0
for _ in range(600):
    if placed >= 14: break
    a = random.choice(['tree_11','tree_12','tree_13','tree_5','tree_7','tree_9'])
    d = CAT[resolve(f'{C}.{a}')]['dimensions']
    tx, ty = random.randrange(0, GRASS_X1-d['width']+1), random.randrange(1, H-d['height']-1)
    box = {(xx,yy) for yy in range(ty-1, ty+d['height']+1) for xx in range(tx-1, tx+d['width']+1)}
    if box & occupied: continue
    occupied |= box
    put(f'{C}.{a}', tx, ty, 'Decorations', 'Tree'); placed += 1
for _ in range(400):
    a = f'{C}.shrub_{random.randint(1,8)}'
    tx, ty = random.randrange(0, GRASS_X1+1), random.randrange(1, H-2)
    if (tx,ty) in occupied: continue
    occupied.add((tx,ty)); put(a, tx, ty, 'Decorations', 'Shrub', block=False)

# ---- hallway lighting + wayfinding ----------------------------------------
for lx in range(12, IX1-2, 8):
    put(f'{S}.led_light_on', lx, HALLA[0]+2, 'Decorations', 'Ceiling Light', block=False)
    put(f'{S}.led_light_on', lx, HALLB[0]+2, 'Decorations', 'Ceiling Light', block=False)
for hx in [30, 50, 70]:
    put(f'{S}.plant_vase_1', hx, HALLA[1]-1, 'Decorations', 'Hall Plant')
    put(f'{S}.plant_vase_2', hx+4, HALLB[1]-1, 'Decorations', 'Hall Plant')

# ---- doors ----------------------------------------------------------------
for dx, dy, dw, dh, dname, locked, horiz, sprite in DOORS:
    if sprite:
        put(f'{S}.black_double_door', dx, dy-1, 'Decorations', dname, block=False)
    typed('door', 'Objects', dx, dy, dw, dh, dname, {'locked': locked})

# ==========================================================================
# 4. gameplay objects
# ==========================================================================
typed('spawn', 'SpawnPoints', 3, 9, 1, 1, 'Main Entrance Spawn',
      {'id': 'entrance', 'default': True})
typed('spawn', 'SpawnPoints', 16, 13, 1, 1, 'Lobby Spawn',
      {'id': 'lobby', 'default': False})
typed('spawn', 'SpawnPoints', 42, 33, 1, 1, 'Recreation Spawn',
      {'id': 'recreation', 'default': False})

ROOM_META = {
    'reception':  ('Reception Lobby', 12, False, 'trigger'),
    'workstation':('Workstation Area', 16, False, 'trigger'),
    'meeting':    ('Meeting Room', 8, True, 'audio-private'),
    'break':      ('Break Room', 12, False, 'trigger'),
    'library':    ('Library / Resource Room', 10, True, 'audio-private'),
    'recreation': ('Recreation Area', 20, False, 'screen-share'),
    'project':    ('Project Room', 10, True, 'audio-private'),
    'lounge':     ('Lounge Area', 12, False, 'trigger'),
    'developer':  ('Developer Zone', 16, False, 'trigger'),
    'hr':         ('HR Cabin', 4, True, 'audio-private'),
    'terrace':    ('Garden Terrace', 12, False, 'trigger'),
}
for key, (x0, y0, x1, y1, f, lab, num) in ROOMS.items():
    name, cap, private, kind = ROOM_META[key]
    typed('meeting-room', 'Objects', x0, y0, x1-x0+1, y1-y0+1, name,
          {'name': name, 'capacity': cap, 'private': private})
    typed('interaction-zone', 'InteractionZones', x0, y0, x1-x0+1, y1-y0+1, name + ' Zone',
          {'kind': kind, 'id': key})
    if lab:
        label(lab, x0 + 1, y0, x1-x0-1, 2)

typed('workstation', 'Objects', 29, 4, 16, 8, 'Workstation Pods', {'capacity': 8})
typed('workstation', 'Objects', 29, 51, 16, 8, 'Developer Pods', {'capacity': 8})
typed('workstation', 'Objects', 61, 30, 12, 7, 'Project Pods', {'capacity': 6})
typed('npc', 'Objects', 19, 8, 1, 1, 'Receptionist',
      {'id': 'receptionist', 'dialog': 'hq.welcome'})

# ==========================================================================
# 5. write
# ==========================================================================
for name in ('Furniture', 'Decorations'):
    L[name]['objects'].sort(key=lambda o: (o['y'], o['x']))

doc = {
    'compressionlevel': -1, 'height': H, 'width': W,
    'infinite': False, 'nextlayerid': len(layers)+1, 'nextobjectid': nid,
    'orientation': 'orthogonal', 'renderorder': 'right-down',
    'tiledversion': '1.10.2', 'tileheight': 16, 'tilewidth': 16,
    'type': 'map', 'version': '1.10',
    'layers': layers, 'tilesets': tilesets_json,
    'properties': [prop('name', 'Vorkium HQ - Floor 1'),
                   prop('description', '10-room top-down office floor plan: reception, workstations, meeting room, break room, library, lounge, recreation, project room, developer zone, HR cabin and garden terrace.')],
}
json.dump(doc, open(OUT, 'w'))
counts = {l['name']: (len([g for g in l['data'] if g]) if l['type']=='tilelayer' else len(l['objects'])) for l in layers}
print('wrote', OUT, W, 'x', H)
print(counts)
