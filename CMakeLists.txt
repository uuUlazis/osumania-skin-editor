cmake_minimum_required(VERSION 3.24)
project(ManiaSkinEditor VERSION 0.1.3 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
  add_compile_options(/W4 /utf-8 /EHsc /permissive- /Zc:__cplusplus)
  add_definitions(-DUNICODE -D_UNICODE -DWIN32_LEAN_AND_MEAN -DNOMINMAX)
else()
  add_compile_options(-Wall -Wextra)
endif()

set(MANIA_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/backend")
set(MANIA_GEN_DIR "${CMAKE_BINARY_DIR}/generated")
include("${MANIA_SOURCE_DIR}/cmake/embed_frontend.cmake")
mania_generate_embedded("${CMAKE_CURRENT_SOURCE_DIR}/frontend/dist"
                        "${MANIA_GEN_DIR}")

set(MANIA_WEBVIEW2_DIR "${MANIA_SOURCE_DIR}/third_party/webview2")
set(MANIA_HAS_WEBVIEW2 OFF)
if(EXISTS "${MANIA_WEBVIEW2_DIR}/build/native/x64/WebView2LoaderStatic.lib"
   AND EXISTS "${MANIA_WEBVIEW2_DIR}/build/native/include/WebView2.h")
  set(MANIA_HAS_WEBVIEW2 ON)
endif()

add_executable(ManiaSkinEditor WIN32
  backend/src/main.cpp
  backend/src/ini/ini_document.cpp
  backend/src/ini/mania_schema.cpp
  backend/src/skins/skin_scanner.cpp
  backend/src/skins/skin_ops.cpp
  backend/src/skins/style_profile.cpp
  backend/src/http/api_server.cpp
  backend/src/app/launcher.cpp
  backend/src/app/history_store.cpp
  backend/src/image/png_tool.cpp
  backend/src/image/stb_impl.cpp
  backend/src/image/work_session.cpp
  "${MANIA_GEN_DIR}/mania_resources.rc"
)
set_target_properties(ManiaSkinEditor PROPERTIES
  OUTPUT_NAME "ManiaSkinEditor-${PROJECT_VERSION}"
)

target_include_directories(ManiaSkinEditor PRIVATE
  "${MANIA_SOURCE_DIR}/src"
  "${MANIA_SOURCE_DIR}/third_party"
  "${MANIA_GEN_DIR}"
)
target_link_libraries(ManiaSkinEditor PRIVATE ws2_32 shell32)

if(MANIA_HAS_WEBVIEW2)
  target_sources(ManiaSkinEditor PRIVATE
    backend/src/webview/webview2_shell.cpp
  )
  target_compile_definitions(ManiaSkinEditor PRIVATE MANIA_HAS_WEBVIEW2=1)
  target_include_directories(ManiaSkinEditor PRIVATE
    "${MANIA_WEBVIEW2_DIR}/build/native/include"
  )
  target_link_libraries(ManiaSkinEditor PRIVATE
    "${MANIA_WEBVIEW2_DIR}/build/native/x64/WebView2LoaderStatic.lib"
    ole32
    oleaut32
    shlwapi
  )
endif()

enable_testing()
add_executable(mania_ini_tests
  backend/tests/ini_tests.cpp
  backend/src/ini/ini_document.cpp
  backend/src/ini/mania_schema.cpp
)
target_include_directories(mania_ini_tests PRIVATE
  "${MANIA_SOURCE_DIR}/src"
  "${MANIA_SOURCE_DIR}/third_party"
)
add_test(NAME mania_ini_tests COMMAND mania_ini_tests)
