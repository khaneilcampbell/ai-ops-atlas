# glib 0.18.5 soundness backport

Source: crates.io glib 0.18.5, SHA-256 `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5` (verified against the original Cargo.lock).
Licenses and source are retained. Only `src/variant_iter.rs` is changed from that archive: mutable output pointer and `&mut p`, matching upstream gtk-rs/gtk-rs-core PR 1343.

Advisory: https://rustsec.org/advisories/RUSTSEC-2024-0429.html
Upstream fix: https://github.com/gtk-rs/gtk-rs-core/pull/1343

Tauri's GTK3 dependency chain requires glib 0.18, so glib 0.20 is not a compatible replacement. The application resolves glib to this checked-in path using `[patch.crates-io]`. `ops/security/glib-regression` exercises forward, reverse, nth, nth_back, last, and mixed iteration in release mode on Linux CI. macOS does not compile the GTK/glib backend.

The version remains honestly 0.18.5; scanners matching version ranges may continue to flag it. Do not dismiss the advisory automatically or label the source an upstream 0.20 release. Remove the local patch when Tauri supports a patched upstream glib. Review future upstream changes and refresh this vendored source deliberately.
