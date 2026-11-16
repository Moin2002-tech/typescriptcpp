#include <grpcpp/grpcpp.h>
#include "fractal.grpc.pb.h"
#include<doctest/doctest.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

// Each worker thread grabs the next unfinished row until none are left.
void renderRows(const fractal::MandelbrotRequest& req,
                std::vector<uint16_t>& out,
                std::atomic<int>& nextRow) {
    const int w = req.width();
    const int h = req.height();
    const int maxIter = req.max_iter();
    const double aspect = static_cast<double>(h) / w;
    const double x0 = req.center_x() - req.scale() / 2.0;
    const double y0 = req.center_y() - req.scale() * aspect / 2.0;
    const double dx = req.scale() / w;
    const double dy = req.scale() * aspect / h;

    for (int y = nextRow++; y < h; y = nextRow++) {
        const double ci = y0 + y * dy;
        for (int x = 0; x < w; ++x) {
            const double cr = x0 + x * dx;
            double zr = 0.0, zi = 0.0;
            int n = 0;
            while (n < maxIter && zr * zr + zi * zi <= 4.0) {
                const double t = zr * zr - zi * zi + cr;
                zi = 2.0 * zr * zi + ci;
                zr = t;
                ++n;
            }
            out[static_cast<size_t>(y) * w + x] = static_cast<uint16_t>(n);
        }
    }
}

class FractalImpl final : public fractal::Fractal::Service {
public:
    grpc::Status Render(grpc::ServerContext*,
                        const fractal::MandelbrotRequest* req,
                        fractal::MandelbrotReply* reply) override {
        const int w = req->width();
        const int h = req->height();
        const int maxIter = req->max_iter();

        if (w <= 0 || h <= 0 || w > 4096 || h > 4096)
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "width and height must be between 1 and 4096");
        if (maxIter <= 0 || maxIter > 65535)
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "max_iter must be between 1 and 65535");
        if (!(req->scale() > 0.0))
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "scale must be positive");

        std::vector<uint16_t> out(static_cast<size_t>(w) * h);
        std::atomic<int> nextRow{0};

        const auto start = std::chrono::steady_clock::now();

        const unsigned threadCount = std::max(1u, std::thread::hardware_concurrency());
        std::vector<std::thread> pool;
        pool.reserve(threadCount);
        for (unsigned i = 0; i < threadCount; ++i) {
            pool.emplace_back([&] { renderRows(*req, out, nextRow); });
        }
        for (auto& t : pool) t.join();

        const auto end = std::chrono::steady_clock::now();

        reply->set_width(w);
        reply->set_height(h);
        reply->set_iterations(reinterpret_cast<const char*>(out.data()),
                              out.size() * sizeof(uint16_t));
        reply->set_compute_ms(
            std::chrono::duration<double, std::milli>(end - start).count());

        return grpc::Status::OK;
    }
};

}  // namespace

TEST_CASE("fractal")
{
    const std::string addr = "127.0.0.1:50051";

    FractalImpl service;
    grpc::ServerBuilder builder;
    builder.AddListeningPort(addr, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);

    std::unique_ptr<grpc::Server> server = builder.BuildAndStart();
    std::cout << "Fractal C++ server listening on " << addr
              << " with " << std::thread::hardware_concurrency()
              << " threads\n";

    server->Wait();

}