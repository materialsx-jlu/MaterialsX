#!/usr/bin/env bash
set -euo pipefail

npm ci
uv sync --project python --frozen
npm run check
npm run test
npm run build
uv run --project python pytest
npm run skills:audit
npm run m0:pi
npm run m0:preflight

if [[ "${MATERIALSX_ELECTRON_SMOKE:-0}" == "1" ]]; then
  npm run m0:electron
fi
