#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
input_file="${root_dir}/spikes/solvers/lammps/in.lj"
output_dir="${root_dir}/artifacts/m0/lammps"
local_solver="${root_dir}/runtime/m0-solvers/lammps/bin/lmp"

mkdir -p "${output_dir}"

if [[ -x "${local_solver}" ]]; then
  solver="${local_solver}"
elif command -v lmp >/dev/null 2>&1; then
  solver="$(command -v lmp)"
else
  echo "LAMMPS executable missing" >&2
  exit 2
fi

"${solver}" -in "${input_file}" -log "${output_dir}/log.lammps" > "${output_dir}/stdout.log"
grep -q "MATERIALSX_LAMMPS_OK" "${output_dir}/stdout.log"
grep -q "Loop time" "${output_dir}/stdout.log"
"${solver}" -help | head -1 > "${output_dir}/version.txt"
shasum -a 256 "${input_file}" > "${output_dir}/input.sha256"
echo "LAMMPS M0 probe passed"
