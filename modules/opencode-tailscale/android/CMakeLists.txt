cmake_minimum_required(VERSION 3.22.1)
project(opencode_tsnet_jni)

add_library(opencode_tsnet SHARED IMPORTED)
set_target_properties(opencode_tsnet PROPERTIES
  IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libopencode_tsnet.so"
  # The Go library has no SONAME. Without this, CMake embeds its absolute build
  # path in the JNI wrapper's DT_NEEDED entry and Android cannot load it.
  IMPORTED_NO_SONAME TRUE)

add_library(opencode_tsnet_jni SHARED src/main/cpp/OpenCodeTailscaleJni.cpp)
target_link_libraries(opencode_tsnet_jni opencode_tsnet log)
