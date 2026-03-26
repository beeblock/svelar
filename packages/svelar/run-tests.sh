#!/bin/bash
# Run tests using Node's built-in test runner with --experimental-transform-types

cd "$(dirname "$0")"
SRC="$(pwd)/src"
SHIM="$(pwd)/tests/vitest-shim.ts"
LOADER="$(pwd)/ts-loader.mjs"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

passed=0
failed=0
errors=""

for test_file in tests/*.test.ts; do
  base=$(basename "$test_file")
  tmp_file="$TMPDIR/$base"

  # Copy and transform the test file
  cat "$test_file" \
    | sed "s|from 'vitest'|from '$SHIM'|g" \
    | sed "s|from '\.\./src/\(.*\)'|from '$SRC/\1.ts'|g" \
    > "$tmp_file"

  echo "=== Running: $base ==="
  if node --experimental-transform-types --no-warnings --loader "$LOADER" "$tmp_file" 2>&1; then
    passed=$((passed + 1))
    echo "✓ $base PASSED"
  else
    failed=$((failed + 1))
    errors="$errors\n  - $base"
    echo "✗ $base FAILED"
  fi
  echo ""
done

echo "=============================="
echo "Results: $passed passed, $failed failed out of $((passed + failed)) tests"
if [ $failed -gt 0 ]; then
  echo -e "Failed:$errors"
  exit 1
else
  echo "All tests passed!"
fi
