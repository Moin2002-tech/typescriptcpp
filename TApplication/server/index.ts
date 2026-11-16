import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTO_FILE = path.resolve(here, "..", "proto", "fractal.proto");
const CPP_ADDR = process.env.FRACTAL_ADDR ?? "127.0.0.1:50051";
const PORT = Number(process.env.PORT ?? 3000);

interface MandelbrotRequest {
    center_x: number;
    center_y: number;
    scale: number;
    width: number;
    height: number;
    max_iter: number;
}

interface MandelbrotReply {
    width: number;
    height: number;
    iterations: Buffer;
    compute_ms: number;
}

interface FractalClient {
    Render(
        request: MandelbrotRequest,
        options: grpc.CallOptions,
        callback: (err: grpc.ServiceError | null, reply?: MandelbrotReply) => void,
    ): void;
}

const packageDef = protoLoader.loadSync(PROTO_FILE, {
    keepCase: true,
    longs: Number,
    bytes: Buffer,
    defaults: true,
});
const grpcObject = grpc.loadPackageDefinition(packageDef) as unknown as {
    fractal: { Fractal: new (addr: string, creds: grpc.ChannelCredentials) => FractalClient };
};
const client = new grpcObject.fractal.Fractal(CPP_ADDR, grpc.credentials.createInsecure());

// Call the C++ server with a deadline so a stuck server can't hang the browser.
function renderOnce(request: MandelbrotRequest, timeoutMs: number): Promise<MandelbrotReply> {
    return new Promise((resolve, reject) => {
        client.Render(request, { deadline: Date.now() + timeoutMs }, (err, reply) => {
            if (err || !reply) reject(err ?? new Error("empty reply from C++ server"));
            else resolve(reply);
        });
    });
}

function describeError(err: unknown): { message: string; code: string | null; hint: string } {
    const e = err as Partial<grpc.ServiceError> & { message?: string };
    const codeNum = typeof e.code === "number" ? e.code : null;
    const code = codeNum === null
        ? null
        : (grpc.status as unknown as Record<number, string>)[codeNum] ?? String(codeNum);

    switch (codeNum) {
        case grpc.status.UNAVAILABLE:
            return {
                message: `Cannot reach the C++ server at ${CPP_ADDR}`,
                code,
                hint: "Start it in another terminal: cd TApplication/cpp-server && ./build/fractal_server",
            };
        case grpc.status.DEADLINE_EXCEEDED:
            return {
                message: "The C++ server did not answer in time",
                code,
                hint: "It may be busy, or the image is too large. Try a smaller resolution.",
            };
        case grpc.status.INVALID_ARGUMENT:
            return { message: e.details ?? "Invalid request", code, hint: "Check the slider and resolution values." };
        default:
            return {
                message: e.details || e.message || "Unknown error from the C++ server",
                code,
                hint: "Check the C++ server terminal for details.",
            };
    }
}

function parseMandelbrotQuery(query: express.Request["query"]): MandelbrotRequest {
    const num = (v: unknown, name: string): number => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
        return n;
    };
    return {
        center_x: num(query.cx, "cx"),
        center_y: num(query.cy, "cy"),
        scale: num(query.scale, "scale"),
        width: Math.trunc(num(query.width, "width")),
        height: Math.trunc(num(query.height, "height")),
        max_iter: Math.trunc(num(query.max_iter, "max_iter")),
    };
}

const app = express();

// Quick check of the whole chain: browser → gateway → C++ → back.
app.get("/api/health", async (_req, res) => {
    const started = performance.now();
    try {
        const reply = await renderOnce(
            { center_x: -0.5, center_y: 0, scale: 3, width: 64, height: 40, max_iter: 50 },
            3000,
        );
        res.json({
            ok: true,
            cppAddress: CPP_ADDR,
            cppComputeMs: reply.compute_ms,
            roundTripMs: performance.now() - started,
            pixels: reply.width * reply.height,
        });
    } catch (err) {
        const info = describeError(err);
        res.status(503).json({ ok: false, cppAddress: CPP_ADDR, error: info.message, code: info.code, hint: info.hint });
    }
});

app.get("/api/mandelbrot", async (req, res) => {
    let request: MandelbrotRequest;
    try {
        request = parseMandelbrotQuery(req.query);
    } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
    }

    try {
        const reply = await renderOnce(request, 30_000);
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("X-Width", String(reply.width));
        res.setHeader("X-Height", String(reply.height));
        res.setHeader("X-Compute-Ms", reply.compute_ms.toFixed(3));
        res.end(reply.iterations);
    } catch (err) {
        const info = describeError(err);
        res.status(502).json({ error: info.message, code: info.code, hint: info.hint });
    }
});

app.listen(PORT, () => {
    console.log(`Gateway on http://localhost:${PORT} → C++ at ${CPP_ADDR}`);
});