# 内核独立构建（只用于单独验证 C++ 侧，不参与 Tauri 打包）
# 主构建路径是 cargo（见 src-tauri/build.rs 用 cc crate 编译 sources.txt）
cmake_minimum_required(VERSION 3.16)
project(yyb_core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  add_compile_options(/utf-8 /EHsc /W3)
else()
  add_compile_options(-finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -Wextra)
endif()

file(STRINGS ${CMAKE_CURRENT_SOURCE_DIR}/sources.txt YYB_SRCS)

add_library(yyb_core STATIC ${YYB_SRCS})
target_include_directories(yyb_core PUBLIC include src)

add_executable(yyb-cli cli/main.cpp)
target_link_libraries(yyb-cli PRIVATE yyb_core)
