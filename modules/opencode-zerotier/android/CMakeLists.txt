cmake_minimum_required(VERSION 3.22)
project(opencode_zerotier)

# Build libzt from the pinned submodule, then add app-owned JNI entry points to
# its shared library. Keeping the shim outside the submodule makes the Android
# crash fix reproducible from the parent repository.
set(ZTS_ENABLE_JAVA ON CACHE BOOL "Build libzt Java bindings" FORCE)
add_subdirectory(
  "${CMAKE_CURRENT_LIST_DIR}/../../../third_party/libzt"
  "${CMAKE_CURRENT_BINARY_DIR}/libzt"
)

target_sources(
  zt-shared
  PRIVATE "${CMAKE_CURRENT_LIST_DIR}/src/main/cpp/OpenCodeZeroTierNative.cpp"
)
target_include_directories(
  zt-shared
  PRIVATE "${CMAKE_CURRENT_LIST_DIR}/../../../third_party/libzt/include"
)
