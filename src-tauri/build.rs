// 构建脚本：
//   1) 用 cc crate 把 C++ 规则内核（core/src 下的 .cpp）编成静态库 yyb_core 链进 Rust
//      —— 不经过 Cargo 生态的 C++ 包装层，直接用我们自己的 C ABI（ADR-01-rev1）。
//   2) tauri_build::build() 读取 tauri.conf.json / capabilities，生成上下文。
//   内核源码或头文件变化都要触发重编。
use std::path::Path;

fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let core = Path::new(&manifest).join("..").join("core");

    // 源清单唯一真源：core/sources.txt（与 core/build-cli.bat 共用，避免两处漏改）
    let list = std::fs::read_to_string(core.join("sources.txt")).expect("core/sources.txt");
    let mut b = cc::Build::new();
    b.cpp(true)
        .std("c++17")
        .include(core.join("include"))
        .include(core.join("src"))
        .warnings(false)
        .flag_if_supported("/utf-8")
        .flag_if_supported("-finput-charset=UTF-8");
    for line in list.lines() {
        let f = line.trim();
        if f.is_empty() || f.starts_with('#') {
            continue;
        }
        b.file(core.join(f));
    }
    b.compile("yyb_core");

    println!("cargo:rerun-if-changed=../core/sources.txt");
    println!("cargo:rerun-if-changed=../core/src");
    println!("cargo:rerun-if-changed=../core/include");

    tauri_build::build();
}
