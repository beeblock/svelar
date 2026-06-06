---
name: feedback_minify_security
description: Always ensure builds are minified with no source maps — never expose source code in published packages
type: feedback
---

Always set `sourcemap: false` and `minify: true` in tsup/build configs. Never publish readable source code or source maps to npm. This is basic security hygiene — don't wait to be told.
