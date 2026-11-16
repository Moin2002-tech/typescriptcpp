# Fractal Forge

Mandelbrot fractal renderer — **C++ gRPC server + TypeScript browser client**.

The C++ server computes the Mandelbrot set (multi-threaded, pure C++),
serializes it as raw `uint16_t` pixel data with Protocol Buffers, and exposes it
over gRPC. A TypeScript/Node gateway (Express + `@grpc/grpc-js`) bridges browser
requests to the C++ server, and a Vite + TypeScript SPA renders the result on an
HTML canvas with a built-in TypeScript benchmark.

---

## Architecture

```
Browser (Vite + TS, :5173)
  │  GET /api/mandelbrot?cx=...&cy=...&scale=...&width=...&height=...&max_iter=...
  ▼
Node.js Express gateway (TApplication/server/index.ts, :3000) ──uses──▶ env FRACTAL_ADDR (default 127.0.0.1:50051)
  │  gRPC call
  ▼
C++ server (main.cpp + generated protobuf/grpc stubs, root project) ──computes──▶ Mandelbrot
```

| Component | Language | Role |
|---|---|---|
| Root `CMakeLists.txt` + `main.cpp` | C++17 | gRPC server, multi-threaded Mandelbrot renderer |
| `external/doctest/` | C++ headers | Embedded test framework (`doctest.h`) |
| `TApplication/proto/fractal.proto` | Protocol Buffers | Shared schema (`MandelbrotRequest` / `MandelbrotReply`) |
| `TApplication/server/index.ts` | TypeScript | Express gateway that proxies browser → gRPC → C++ server |
| `TApplication/src/main.ts` | TypeScript | Canvas renderer + UI + benchmark |
| `TApplication/vite.config.ts` | TypeScript | Vite dev server + `/api` proxy to gateway |

---

## Prerequisites

### 1. C++ (vcpkg)

- **vcpkg** (https://github.com/microsoft/vcpkg)
- **CMake ≥ 3.20**
- **C++17** capable compiler (GCC / Clang / MSVC)

Install the required vcpkg packages:

```bash
# From your vcpkg installation directory
./vcpkg install grpc protobuf
```

Required vcpkg libraries:

| Package | CMake target | Used for |
|---|---|---|
| `grpc` | `gRPC::grpc++` | gRPC C++ streaming/one-directional RPC |
| `protobuf` | `protobuf::libprotobuf` | Generated `fractal.pb.cc` / `fractal.grpc.pb.cc` |

> `doctest` is vendored in `external/doctest/` (headers only) — no external lib needed.

### 2. TypeScript

- **Node.js ≥ 18** and **npm**
- All required npm packages are declared in `TApplication/package.json`; `npm install` handles the rest.

---

## Quick Start

```bash
# ── 1. Build the C++ server ───────────────────────────────────────────────
cd /home/moinshaikh/CLionProjects/typescriptcpp

# Configure (Debug or Release)
cmake -B cmake-build-debug -S .
cmake --build cmake-build-debug

# (Optional) verify tests
./cmake-build-debug/typescriptcpp --list-test-cases

# ── 2. Start the C++ gRPC server ──────────────────────────────────────────
./cmake-build-debug/typescriptcpp
#    "Fractal C++ server listening on 127.0.0.1:50051 with N threads"

# ── 3. In a new terminal: start the Node.js gateway ───────────────────────
cd TApplication
npm install
npm run server        # Express gateway on http://localhost:3000

# ── 4. In a third terminal: start the Vite dev server ─────────────────────
cd TApplication
npm run dev           # Browser app on http://localhost:5173
```

Open **http://localhost:5173** → the fractal renders in the browser.

---

## Build Reference

### C++ server (root)

```bash
# Debug build (default, with -g -O0)
cmake -B cmake-build-debug -S .
cmake --build cmake-build-debug

# Release build with -O3 optimization
cmake -B cmake-build-release -DCMAKE_BUILD_TYPE=Release -S .
cmake --build cmake-build-release -j4

# Run tests
./cmake-build-release/typescriptcpp --list-test-cases
```

> **Note:** Debug builds use `-g -O0 -DASSERTIONS_ENABLED` for easier debugging.
> Release builds use `-O3 -DNDEBUG` for maximum performance.

The build generates protobuf/gRPC stubs into `cmake-build-debug/generated/`
(`fractal.pb.{h,cc}`, `fractal.grpc.pb.{h,cc}`) via the custom `protobuf::protoc`
+`grpc_cpp_plugin` targets.

### TypeScript app (`TApplication/`)

```bash
cd TApplication
npm install
npm run dev        # Vite dev server (:5173), proxies /api → gateway :3000
npm run server     # Express gateway (:3000) — backend API only, no UI
npm run build      # TypeScript type-check + Vite production build → ./dst/
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `FRACTAL_ADDR` | `127.0.0.1:50051` | gRPC address of the C++ server (read by gateway) |
| `PORT` | `3000` | Express gateway port (read by gateway) |
| `CPP_ADDR` | — | **Deprecated** alias for `FRACTAL_ADDR` (see `server/index.ts`) |

---

## API Endpoints

### `GET /api/health`

Smoke test: calls the C++ gRPC server and returns round-trip stats.

```json
{ "ok": true, "cppAddress": "127.0.0.1:50051", "cppComputeMs": 42.3, "roundTripMs": 61.8, "pixels": 57600 }
```

### `GET /api/mandelbrot`

Renders a Mandelbrot region. Query parameters:

| Param | Type | Description |
|---|---|---|
| `cx` | number | Center X (real) in complex plane |
| `cy` | number | Center Y (imaginary) |
| `scale` | number | View width in complex plane |
| `width` | int | Image width in px |
| `height` | int | Image height in px |
| `max_iter` | int | Max iterations (50–3000 in UI) |

Response: `application/octet-stream` — binary `iterations` payload (one `uint16_t`
per pixel, little-endian) plus headers `X-Width`, `X-Height`, `X-Compute-Ms`.

---

## Test

Run the embedded doctest suite with the built binary:

```bash
./cmake-build-debug/typescriptcpp --list-test-cases
./cmake-build-debug/typescriptcpp
```

Current suite: `"fractal"` (server integration test — starts an in-process gRPC
server and renders rows across worker threads).

---

## Project Layout

```
.
├── CMakeLists.txt              # Top-level CMake (protobuf, gRPC, executable)
├── main.cpp                    # C++ gRPC server + multi-threaded renderer
├── include/                    # (empty — headers planned/added later)
├── src/                        # (empty — C++ sources planned/added later)
├── external/
│   └── doctest/                # Vendored doctest test framework (headers only)
├── cmake-build-debug/          # CMake build output (Debug)
├── cmake-build-release/        # CMake build output (Release)
└── TApplication/               # TypeScript browser + gateway
    ├── package.json
    ├── package-lock.json
    ├── proto/
    │   └── fractal.proto       # Shared proto schema
    ├── server/
    │   └── index.ts            # Express + gRPC gateway
    ├── src/
    │   ├── main.ts             # Canvas renderer + UI
    │   └── style.css
    ├── index.html
    ├── vite.config.ts
    ├── ts.config
    ├── dst/                    # Production build output (gitignored)
    └── node_modules/           # npm dependencies (gitignored)
```

---

## Known Staleness Notes

- `TApplication/server/index.ts:69` references `cd TApplication/cpp-server` as a
  hint for starting the C++ server — there is no `cpp-server/` directory in this
  layout. Point the gateway at whatever binary you built (default:
  `cmake-build-debug/typescriptcpp`).
- `include/` and `src/` at project root are currently empty; the root `main.cpp`
  contains all C++ source code.
