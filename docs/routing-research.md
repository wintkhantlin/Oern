# Routing research and data audit

Checked 16 November 2026. Directed ALT is implemented in `src/lib/delivery/routing/landmarks.ts`, with an optional prepared index in `shortestPathBetween`. See [usage and lifecycle](routing-alt.md).

## Selected improvement

Add directed ALT (A*, landmarks and triangle inequality) for repeated point-to-point queries on a fixed road graph. It can use the project's existing non-negative edge costs without inventing traffic measurements. Keep Dijkstra as the correctness reference and the existing per-source Dijkstra approach for dense dispatch matrices; running one ALT query per pair is not automatically faster for that workload.

Goldberg and Harrelson's [primary research report, *Computing the Shortest Path: A* Search Meets Graph Theory*](https://www.microsoft.com/en-us/research/publication/computing-the-shortest-path-a-search-meets-graph-theory/) describes landmark bounds for directed graphs and exact shortest-path queries (2004 report; SODA 2005 publication).

For landmark L, current node v and target t, use the maximum of zero and the finite terms `d(L,t) - d(L,v)` and `d(v,L) - d(t,L)`. Compute landmark distances on both the original and reversed directed graph. An absolute difference from one table is not a valid directed-graph substitute. Ignore undefined infinite differences. Retain A* reopening because skipping unavailable landmark terms across disconnected regions can break consistency even when each bound remains admissible.

For k landmarks, binary-heap preprocessing costs `O(k (V + E) log V)` and stores `O(kV)` distances; evaluating a bound costs `O(k)`. Query worst-case behavior still reaches the full graph. These are complexity estimates, not measured speedups. Benchmark preprocessing, retained memory and repeated queries separately, and compare returned costs against Dijkstra.

Tables must belong to the graph and cost metric used for the query. The implementation uses a fixed, deeply frozen graph snapshot: queries use the captured topology and weights, and caller mutations require a new index to affect routing. The coordinate entry point requires `index.graph` to avoid mixing metrics. Rebuild to reflect any cost or topology changes; otherwise queries continue to describe the old snapshot. A static ALT index does not implement time-dependent traffic prediction, turn restrictions, vehicle legality or dispatch optimality.

## Local graph smoke benchmark

Run `node --experimental-strip-types scripts/benchmark-routing-alt.mjs` after generating the OSM graph. It checks twelve deterministic source/target pairs (seed `20261116`) against Dijkstra, including reconstructed path costs, with a `1e-6` absolute tolerance. All twelve pairs were reachable and matched in the checked graph. Default landmark IDs were `0`, `87838`, `40416`, `95746`.

One local run measured approximately 188 ms preprocessing, 57 ms total Dijkstra query time and 14 ms total ALT query time; ALT expanded 51,342 nodes across the twelve queries. These are a small, single-process smoke measurement, without warm-up or statistical controls. Preprocessing exceeds the query savings for this twelve-query run, so the figures do not establish an end-to-end speedup or production latency guarantee. Tables are reused across queries on the same snapshot; dense dispatch matrices retain per-source Dijkstra.

## Data on disk

Counts were read from the current working tree, including generated files.

| Input | Count | Observations |
| --- | ---: | --- |
| Generated OSM road graph | 102,888 nodes; 139,530 stored edges | Stored rows can expand into two directed arcs. Source field names `data/yangon.osm.pbf`; no extract timestamp in the generated metadata. |
| Road speed/capacity CSV | 15 rows | Marked observed; 14 verified, 1 estimated. |
| Intersection volume CSV | 14 rows | Marked observed and verified. |
| Signal delays CSV | 7 rows | Marked observed; 6 verified, 1 estimated. |
| Junction congestion CSV | 14 rows | All modeled; 4 verified, 10 estimated. |
| Turn movements CSV | 15 rows | Marked observed and verified; traffic splits are not legal turn restrictions. |

All YUTRA CSV rows identify survey year 2013. These are historical priors, not current observations. The official [JICA YUTRA summary](https://openjicareport.jica.go.jp/pdf/12182754.pdf) identifies the transport study and 2013 demand survey context. Exact local CSV numbers, junction coordinates and cited table/page correspondences have not been independently matched to the source tables. A local `verified` label does not establish that match.

`python3 data/validate_yutra_extract.py` passed all seven input files with zero errors and warnings. Its checks cover field presence and selected ranges; it does not verify source-table transcription, geographic identity, calibration or current accuracy. Do not describe this result as external data verification.

The current OSM builder simplifies road shapes into lengths and junction endpoints, filters the largest weakly connected component, and handles a subset of one-way tags. It does not parse restriction relations, `oneway=-1`, vehicle-specific permissions or implicit roundabout direction. The graph supports algorithm experiments but cannot establish complete legal driving directions.

## Transportation findings and follow-up work

The local BPR JSON calls alpha `3.0` a standard international default, while also marking it assumed and not locally calibrated. The [FHWA *Model Validation and Reasonableness Checking Manual*](https://rosap.ntl.bts.gov/view/dot/42942/dot_42942_DS1.pdf), section 7.1.2, gives commonly used values alpha `0.15`, beta `4.0`. Alpha varies with calibration and capacity definition; this audit does not justify silently replacing the project's value or claiming a validated Yangon traffic model.

`routing/traffic.ts` adds signal wait as equivalent metres to `GraphEdge.weight`; `routing/matrix.ts` then uses that same weight for both minutes and kilometres. On that graph-backed path, waiting can inflate reported physical distance. Preserve physical metres separately from optimization cost before using such distances for energy or delivery-cost estimates. This finding does not imply the separate OSM matrix applies signal delay this way.

`dispatch/traffic.ts` currently checks straight corridors between stops. A corridor passing a junction is not evidence that a selected road path crosses it. Path-based closures and delays require retained route geometry or edge-level matching before shortest-path search, plus explicit fallback coverage.

Delling, Goldberg, Pajor and Werneck's [*Customizable Route Planning*](https://www.microsoft.com/en-us/research/wp-content/uploads/2011/05/crp-sea.pdf) separates topology from changing traversal costs and supports turn costs. It is a sound future direction when graph attributes and update requirements justify the additional machinery. Adding historical turn-volume penalties alone would not reproduce that algorithm or establish turn legality.

The authors' [*Route Planning in Transportation Networks* survey](https://arxiv.org/abs/1504.05140) explains tradeoffs among preprocessing, query performance, traffic updates and transport modes. Its findings support choosing an algorithm for a measured workload. No production performance or ETA accuracy claim follows from the research papers alone.
