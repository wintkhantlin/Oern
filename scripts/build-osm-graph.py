#!/usr/bin/env python3
"""Turns data/yangon.osm.pbf into a compact drivable road graph.

Output: data/generated/yangon-road-graph.json
  { nodes: [[lat, lng], ...], edges: [[from, to, metres, oneway(0|1)], ...] }
Only junctions and road ends become nodes; the shape between them is
collapsed into one edge length. Keeps the largest connected component.
Run:  python3 scripts/build-osm-graph.py
"""
import json, math, sys
import osmium

DRIVABLE = {"motorway","trunk","primary","secondary","tertiary","unclassified",
            "residential","service","living_street","motorway_link","trunk_link",
            "primary_link","secondary_link","tertiary_link"}

def hav(a, b):
    r = math.radians
    dlat, dlon = r(b[0]-a[0]), r(b[1]-a[1])
    h = math.sin(dlat/2)**2 + math.cos(r(a[0]))*math.cos(r(b[0]))*math.sin(dlon/2)**2
    return 2*6371000*math.asin(min(1, math.sqrt(h)))

class Ways(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []  # (node refs, oneway)
    def way(self, w):
        hw = w.tags.get("highway")
        if hw not in DRIVABLE: return
        if w.tags.get("access") in ("no", "private") and hw == "service": return
        if w.tags.get("service") in ("parking_aisle", "driveway"): return
        ow = w.tags.get("oneway")
        oneway = 1 if ow in ("yes", "true", "1") or hw.startswith("motorway") else 0
        refs = [n.ref for n in w.nodes]
        if len(refs) > 1:
            self.ways.append((refs, oneway))

src, dst = "data/yangon.osm.pbf", "data/generated/yangon-road-graph.json"
h = Ways(); h.apply_file(src)
count = {}
for refs, _ in h.ways:
    for r in refs: count[r] = count.get(r, 0) + 1
keep = set()
for refs, _ in h.ways:
    keep.add(refs[0]); keep.add(refs[-1])
    for r in refs:
        if count[r] > 1: keep.add(r)

class Coords(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.c = {}
    def node(self, n):
        if n.id in count and n.location.valid():
            self.c[n.id] = (n.location.lat, n.location.lon)
cs = Coords(); cs.apply_file(src); coords = cs.c

index, nodes, edges = {}, [], {}
def nid(ref):
    if ref not in index:
        index[ref] = len(nodes); nodes.append(coords[ref])
    return index[ref]
for refs, oneway in h.ways:
    if any(r not in coords for r in refs): continue
    last, length = refs[0], 0.0
    for prev, cur in zip(refs, refs[1:]):
        length += hav(coords[prev], coords[cur])
        if cur in keep:
            a, b = nid(last), nid(cur)
            if a != b and length > 0:
                key = (a, b)
                if key not in edges or edges[key][0] > length: edges[key] = (length, oneway)
            last, length = cur, 0.0

# undirected adjacency for component filtering
adj = [[] for _ in nodes]
for (a, b) in edges: adj[a].append(b); adj[b].append(a)
comp = [-1]*len(nodes); sizes = []
for s in range(len(nodes)):
    if comp[s] != -1: continue
    stack, cid, n = [s], len(sizes), 0; comp[s] = cid
    while stack:
        u = stack.pop(); n += 1
        for v in adj[u]:
            if comp[v] == -1: comp[v] = cid; stack.append(v)
    sizes.append(n)
big = sizes.index(max(sizes))
remap, out_nodes = {}, []
for i, c in enumerate(nodes):
    if comp[i] == big: remap[i] = len(out_nodes); out_nodes.append([round(c[0],6), round(c[1],6)])
out_edges = [[remap[a], remap[b], round(l,1), ow] for (a, b), (l, ow) in edges.items() if a in remap and b in remap]
json.dump({"source": src, "nodes": out_nodes, "edges": out_edges}, open(dst, "w"), separators=(",", ":"))
print(f"{len(out_nodes)} nodes, {len(out_edges)} edges")
