# glib backport CodeQL review — October 30, 2026

Scope: PR #125, CodeQL Rust analysis 2061691451. The seven results were reviewed using the SARIF code flows, source contracts, and optimized Linux regression tests. This is not a blanket audit of GLib. No queries or paths are excluded and no severity settings are lowered.

| Alert | Location | Assessment |
|---|---|---|
| 4 | `vendor/glib/src/log.rs:85` | False positive. SARIF starts at `g_uuid_string_is_valid` and crosses generic `from_glib` into `LogLevel::from_glib`. The actual instantiated return is `bool`, not `LogLevel`. The reported source is a public validation result, not UUID bytes or a credential; this path cannot reach the panic logger. |
| 5, 6 | `vendor/glib/src/object.rs:470,493` | False positives. Flows originate at null-initialized `GError`, hostname, or charset out-pointers in generated functions, cross generic translation, and arrive at `GObject` conversions. These have distinct pointer types and `FromGlibPtr*` implementations. `GError` conversion is behind `!error.is_null()`; C fills the out-pointer. This is not a path from an invalid pointer into an ObjectRef. |
| 7 | `vendor/glib/src/subclass/boxed.rs:76` | False positive. Same impossible typed generic flows into a test-only `glib::Boxed` derive. The boxed copy/free callbacks operate on owned boxed values registered with GLib, not `GError` or charset pointers. |
| 8, 9 | `vendor/glib/src/value.rs:462,470` | False positives. Same impossible typed generic flows into `GValue` copy/clear. The actual values are initialized/owned GValues. A `GError*`, `gchar*`, or `const gchar*` out-pointer does not instantiate these GValue operations. |
| 10 | `vendor/glib/src/collections/ptr_slice.rs:900` | False positive. `drop_in_place<T>` destroys the pointer-wrapper element and releases its pointee, not the GLib-allocated array slot at `p`. Writing the null terminator into that still-owned slot is valid. `len` is decremented before destruction; allocation is released by the container, not the wrapper. |

The release-mode harness covers iterator operations, pointer-slice truncate/reuse, Object/GValue clone/drop, boxed clone/drop, valid/invalid URI out-parameters, absent hostname, and UUID validation. Tests complement the source review; passing tests alone do not establish memory safety.

Results are resolved individually with the reason `false positive` and an explanation linked to this file. Reopen if a reproducible typed path or changed upstream implementation invalidates this assessment. Original Dependabot alert #16 remains a separate version-based advisory; the two-line VariantStrIter patch is documented in `src-tauri/vendor/glib/ATLAS-PATCH.md`.

References: https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts and https://codeql.github.com/codeql-query-help/rust/rust-access-invalid-pointer/ .
