# Renderer spike: desktop-hg8er1k-swiftshader-cpu4x

2026-10-10T16:37:47.761Z · win32-x64 · 16 x AMD Ryzen 7 8745H with Radeon 780M Graphics · 31 GB · Chrome 155.0.8059.40
GPU flag `swiftshader` → `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` · CPU throttle 4x · Pixi 8.21.0 · max batchable textures 32 · GPU timer EXT_disjoint_timer_query_webgl2

Window 10 s after 5 s warm-up, 1280×720, 1x device pixels. CPU columns are % of one core over the window. Canvas "draws" are 2D context calls (drawImage, fill, stroke, fillRect), not GPU draw calls.

| case | fps | frame ms p50 / p95 / max | GPU ms p50 | draws/frame | main thread % | renderer CPU % | GPU process CPU % | browser CPU % | errors |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| pixi plain 200 no-desks | 37.6 | 3.10 / 17.00 / 18.00 | 22.61 | 1.0 | 29.6 | 103.3 | 1049.3 | 0.4 |  |
| pixi tint 200 no-desks | 38.2 | 4.00 / 17.50 / 19.70 | 22.43 | 1.0 | 36.5 | 103.0 | 1085.1 | 0.5 |  |
| pixi mask 200 no-desks | 36.4 | 4.90 / 20.10 / 21.70 | 23.65 | 1.0 | 41.8 | 102.8 | 1149.1 | 0.2 |  |
| pixi filter 200 no-desks | 27.6 | 4.70 / 13.40 / 14.60 | 32.21 | 3.0 | 25.9 | 102.3 | 1052.0 | 11.4 |  |
| pixi mask 200 | 33.3 | 5.00 / 22.90 / 25.60 | 26.35 | 1.0 | 38.2 | 98.9 | 1162.8 | 6.0 |  |
| pixi mask 5 | 42.4 | 2.00 / 13.50 / 15.20 | 19.67 | 1.0 | 31.0 | 102.2 | 999.0 | 0.3 |  |
| pixi mask 200 30fps | 29.9 | 3.30 / 9.50 / 24.20 | 26.27 | 1.0 | 34.3 | 101.5 | 1074.0 | 3.6 |  |
| pixi mask 200 idle | 0.0 | – / – / – | – | – | 6.4 | 101.6 | 1.7 | 0.2 |  |
| pixi mask 200 idle + Ticker.system stopped | 0.0 | – / – / – | – | – | 0.0 | 96.2 | 0.0 | 1.5 |  |
| canvas plain 200 no-desks | 59.9 | 2.70 / 7.60 / 16.60 | – | 202.0 | 57.8 | 102.3 | 1016.5 | 1.4 |  |
| canvas tint 200 no-desks | 56.1 | 3.90 / 9.50 / 20.90 | – | 202.0 | 68.6 | 96.3 | 974.2 | 1.0 |  |
| canvas mask 200 no-desks | 46.1 | 5.50 / 14.50 / 25.20 | – | 402.0 | 86.6 | 105.4 | 935.8 | 0.8 |  |
| canvas mask 200 | 45.1 | 15.20 / 27.20 / 39.20 | – | 415.0 | 81.4 | 105.6 | 988.3 | 0.6 |  |
| canvas mask 5 | 60.0 | 0.80 / 2.00 / 3.10 | – | 25.0 | 25.8 | 104.9 | 874.6 | 0.6 |  |
| canvas mask 200 30fps | 28.4 | 18.30 / 43.50 / 80.30 | – | 415.0 | 72.8 | 85.9 | 585.7 | 0.6 |  |
| canvas mask 200 idle | 0.0 | – / – / – | – | – | 0.0 | 98.5 | 0.0 | 0.4 |  |
| pixi mask 200 desks as Graphics | 34.2 | 3.70 / 22.30 / 26.00 | 25.45 | 1.0 | 28.7 | 94.8 | 1124.3 | 0.7 |  |

Canvas tinted copies after the mask case: 672 frames, 28.4 MB, 645 ms to build.

cacheAsTexture check (paused frames compared with the uncached reference; differing = any channel off by more than 8/255; order errors = differing pixels inside a solid differing area, not a 1-2 px resampled edge (a heuristic; check the diff PNGs); red in the cache-diff PNGs, edges in yellow):

| t | renderer | desks | vs | mean max-channel diff /255 | pixels differing % | order-error pixels |
|---:|---|---|---|---:|---:|---:|
| 4.2 | pixi | single | none | 0.341 | 0.43 | 1109 |
| 4.2 | pixi | bands | none | 0.072 | 0.21 | 0 |
| 4.2 | canvas | single | none | 0.386 | 0.69 | 1234 |
| 4.2 | canvas | bands | none | 0.178 | 0.62 | 15 |
| 4.2 | pixi vs canvas | none | canvas none | 0.578 | 2.16 | 1 |
| 9.7 | pixi | single | none | 0.392 | 0.47 | 1385 |
| 9.7 | pixi | bands | none | 0.069 | 0.21 | 0 |
| 9.7 | canvas | single | none | 0.440 | 0.74 | 1526 |
| 9.7 | canvas | bands | none | 0.184 | 0.64 | 14 |
| 9.7 | pixi vs canvas | none | canvas none | 0.568 | 2.13 | 1 |
| 15.1 | pixi | single | none | 0.434 | 0.51 | 1610 |
| 15.1 | pixi | bands | none | 0.072 | 0.22 | 0 |
| 15.1 | canvas | single | none | 0.478 | 0.77 | 1785 |
| 15.1 | canvas | bands | none | 0.182 | 0.64 | 17 |
| 15.1 | pixi vs canvas | none | canvas none | 0.572 | 2.12 | 1 |
