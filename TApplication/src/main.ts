type View = { cx: number; cy: number; scale: number };

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const ctx = canvas.getContext("2d")!;
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
const overlayText = document.querySelector<HTMLSpanElement>("#overlayText")!;
const cppMsEl = document.querySelector<HTMLDivElement>("#cppMs")!;
const jsMsEl = document.querySelector<HTMLDivElement>("#jsMs")!;
const speedupEl = document.querySelector<HTMLDivElement>("#speedup")!;
const iterInput = document.querySelector<HTMLInputElement>("#iter")!;
const iterOut = document.querySelector<HTMLOutputElement>("#iterOut")!;
const resSelect = document.querySelector<HTMLSelectElement>("#res")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;
const benchBtn = document.querySelector<HTMLButtonElement>("#bench")!;

const DEFAULT_VIEW: View = { cx: -0.5, cy: 0, scale: 3.2 };
let view: View = { ...DEFAULT_VIEW };
let maxIter = Number(iterInput.value);
let width = 960;
let height = 600;
let cppMs: number | null = null;
let jsMs: number | null = null;
let requestId = 0;

function readResolution(): void {
    const [w, h] = resSelect.value.split("x").map(Number);
    width = w;
    height = h;
}

// Smooth gradient palette: 256 RGB entries.
function buildPalette(): Uint8ClampedArray {
    const p = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        p[i * 3] = 255 * (9 * (1 - t) * t * t * t);
        p[i * 3 + 1] = 255 * (15 * (1 - t) * (1 - t) * t * t);
        p[i * 3 + 2] = 255 * (8.5 * (1 - t) * (1 - t) * (1 - t) * t);
    }
    return p;
}
const palette = buildPalette();

function paint(iters: Uint16Array): void {
    canvas.width = width;
    canvas.height = height;
    const img = ctx.createImageData(width, height);
    const px = img.data;
    const lnMax = Math.log(maxIter + 1);

    for (let i = 0; i < iters.length; i++) {
        const n = iters[i];
        const o = i * 4;
        if (n >= maxIter) {
            px[o] = 0;
            px[o + 1] = 0;
            px[o + 2] = 0;
        } else {
            const idx = Math.floor((Math.log(n + 1) / lnMax) * 255) * 3;
            px[o] = palette[idx];
            px[o + 1] = palette[idx + 1];
            px[o + 2] = palette[idx + 2];
        }
        px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

function updateSpeedup(): void {
    if (cppMs !== null && jsMs !== null && cppMs > 0) {
        speedupEl.textContent = `${(jsMs / cppMs).toFixed(1)}×`;
    } else {
        speedupEl.textContent = "—";
    }
}

function showOverlay(message: string): void {
    overlayText.textContent = message;
    overlay.classList.remove("hidden");
}
function hideOverlay(): void {
    overlay.classList.add("hidden");
}

async function renderFromServer(): Promise<void> {
    const id = ++requestId;
    showOverlay("Rendering in C++…");

    const qs = new URLSearchParams({
        cx: String(view.cx),
        cy: String(view.cy),
        scale: String(view.scale),
        width: String(width),
        height: String(height),
        max_iter: String(maxIter),
    });

    try {
        const res = await fetch(`/api/mandelbrot?${qs}`);
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error ?? res.statusText);
        }
        const computeMs = Number(res.headers.get("X-Compute-Ms"));
        const iters = new Uint16Array(await res.arrayBuffer());

        if (id !== requestId) return; // a newer request has replaced this one

        paint(iters);
        cppMs = computeMs;
        cppMsEl.textContent = computeMs.toFixed(1);
        jsMs = null; // previous TypeScript benchmark no longer matches this view
        jsMsEl.textContent = "—";
        updateSpeedup();
    } catch (err) {
        if (id === requestId) {
            showOverlay(`Error: ${(err as Error).message}`);
            return;
        }
    } finally {
        if (id === requestId && !overlayText.textContent?.startsWith("Error")) {
            hideOverlay();
        }
    }
}

// The same algorithm in plain TypeScript, for comparison.
function mandelbrotJs(v: View, w: number, h: number, maxIterations: number): Uint16Array {
    const out = new Uint16Array(w * h);
    const aspect = h / w;
    const x0 = v.cx - v.scale / 2;
    const y0 = v.cy - (v.scale * aspect) / 2;
    const dx = v.scale / w;
    const dy = (v.scale * aspect) / h;

    for (let y = 0; y < h; y++) {
        const ci = y0 + y * dy;
        for (let x = 0; x < w; x++) {
            const cr = x0 + x * dx;
            let zr = 0;
            let zi = 0;
            let n = 0;
            while (n < maxIterations && zr * zr + zi * zi <= 4) {
                const t = zr * zr - zi * zi + cr;
                zi = 2 * zr * zi + ci;
                zr = t;
                n++;
            }
            out[y * w + x] = n;
        }
    }
    return out;
}

function benchmarkTs(): void {
    benchBtn.disabled = true;
    showOverlay("Running the TypeScript version…");

    // Let the overlay paint before the heavy loop blocks the main thread.
    setTimeout(() => {
        const t0 = performance.now();
        const iters = mandelbrotJs(view, width, height, maxIter);
        jsMs = performance.now() - t0;

        jsMsEl.textContent = jsMs.toFixed(1);
        paint(iters);
        updateSpeedup();
        hideOverlay();
        benchBtn.disabled = false;
    }, 30);
}

// Click to zoom in, shift-click to zoom out.
canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const aspect = height / width;

    const re = view.cx - view.scale / 2 + px * view.scale;
    const im = view.cy - (view.scale * aspect) / 2 + py * view.scale * aspect;
    const factor = e.shiftKey ? 2 : 0.5;

    view = { cx: re, cy: im, scale: view.scale * factor };
    renderFromServer();
});

iterInput.addEventListener("input", () => {
    maxIter = Number(iterInput.value);
    iterOut.textContent = String(maxIter);
});
iterInput.addEventListener("change", () => renderFromServer());

resSelect.addEventListener("change", () => {
    readResolution();
    renderFromServer();
});

resetBtn.addEventListener("click", () => {
    view = { ...DEFAULT_VIEW };
    renderFromServer();
});

benchBtn.addEventListener("click", benchmarkTs);

readResolution();
iterOut.textContent = String(maxIter);
renderFromServer();

const testBtn = document.querySelector<HTMLButtonElement>("#testCpp")!;
const statusEl = document.querySelector<HTMLDivElement>("#cppStatus")!;

type HealthBody = {
    ok: boolean;
    cppAddress?: string;
    cppComputeMs?: number;
    roundTripMs?: number;
    error?: string;
    hint?: string;
};

async function testCpp(): Promise<void> {
    testBtn.disabled = true;
    statusEl.className = "status pending";
    statusEl.textContent = "Testing C++ server…";

    try {
        const res = await fetch("/api/health");
        // If the Node gateway is down, Vite answers with plain text instead of JSON.
        const body: HealthBody = await res.json().catch(() => ({
            ok: false,
            error: `Gateway returned HTTP ${res.status}`,
            hint: "Is the Node gateway running? Start it with: cd TApplication/web && npm run server",
        }));

        if (body.ok) {
            statusEl.className = "status ok";
            statusEl.textContent =
                `✓ Connected to ${body.cppAddress}. ` +
                `C++ compute ${body.cppComputeMs?.toFixed(2)} ms, ` +
                `round trip ${body.roundTripMs?.toFixed(1)} ms.`;
        } else {
            statusEl.className = "status fail";
            statusEl.textContent = `✗ ${body.error ?? "Unknown error"}. ${body.hint ?? ""}`.trim();
        }
    } catch (err) {
        statusEl.className = "status fail";
        statusEl.textContent = `✗ Could not reach the gateway: ${(err as Error).message}`;
    } finally {
        testBtn.disabled = false;
    }
}

testBtn.addEventListener("click", testCpp);