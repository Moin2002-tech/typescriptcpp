cmake_minimum_required(VERSION 3.20)
project(typescriptcpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Release optimization (-O3) - applied when building with CMAKE_BUILD_TYPE=Release
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")

# Debug build (keep it fast but debuggable)
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -DASSERTIONS_ENABLED")

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)

set(PROTO_DIR ${CMAKE_CURRENT_SOURCE_DIR}/TApplication/proto)
set(PROTO_FILE ${PROTO_DIR}/fractal.proto)
set(GEN_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)
file(MAKE_DIRECTORY ${GEN_DIR})

add_custom_command(
        OUTPUT
        ${GEN_DIR}/fractal.pb.h
        ${GEN_DIR}/fractal.pb.cc
        ${GEN_DIR}/fractal.grpc.pb.h
        ${GEN_DIR}/fractal.grpc.pb.cc
        COMMAND $<TARGET_FILE:protobuf::protoc>
        --cpp_out=${GEN_DIR}
        --grpc_out=${GEN_DIR}
        --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
        -I ${PROTO_DIR}
        ${PROTO_FILE}
        DEPENDS ${PROTO_FILE}
        COMMENT "Generating fractal protobuf and gRPC code"
        VERBATIM
)

add_executable(typescriptcpp
        main.cpp
        ${CMAKE_SOURCE_DIR}/external/doctest/doctest/doctest.h
        ${CMAKE_SOURCE_DIR}/external/doctest/doctest/doctest.cpp
        ${GEN_DIR}/fractal.pb.cc
        ${GEN_DIR}/fractal.grpc.pb.cc
)
target_include_directories(typescriptcpp PRIVATE ${GEN_DIR})
target_include_directories(typescriptcpp PRIVATE ${CMAKE_SOURCE_DIR}/external/doctest)

target_link_libraries(typescriptcpp PRIVATE
        gRPC::grpc++
        protobuf::libprotobuf
)




