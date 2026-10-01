#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
case_dir="${root_dir}/spikes/solvers/quantum-espresso"
output_dir="${root_dir}/artifacts/m0/quantum-espresso"
work_dir="${output_dir}/work"
image="${MATERIALSX_QE_IMAGE:-tiagoftc/quantum-espresso:latest}"
qe_env="${root_dir}/runtime/m0-solvers/qe-osx64"

mkdir -p "${work_dir}/pseudo" "${work_dir}/tmp"
cp "${case_dir}/si.scf.in" "${work_dir}/si.scf.in"

if [[ -x "${qe_env}/bin/pw.x" ]] && command -v conda >/dev/null 2>&1; then
  solver=(conda run -p "${qe_env}" --no-capture-output pw.x)
  run_mode="conda:qe-7.4-osx-64-rosetta"
elif command -v pw.x >/dev/null 2>&1; then
  solver=(pw.x)
  run_mode="native"
elif docker info >/dev/null 2>&1; then
  solver=(docker run --rm -v "${work_dir}:/io" -w /io "${image}" pw.x)
  run_mode="docker:${image}"
else
  echo "Quantum ESPRESSO unavailable: no pw.x and Docker daemon is not running" >&2
  exit 2
fi

pseudo_url="https://pseudopotentials.quantum-espresso.org/upf_files/Si.pz-vbc.UPF"
curl -fsSL "${pseudo_url}" -o "${work_dir}/pseudo/Si.pz-vbc.UPF"

(
  cd "${work_dir}"
  "${solver[@]}" -in si.scf.in > si.scf.out
)

grep -q "convergence has been achieved" "${work_dir}/si.scf.out"
grep -q "JOB DONE" "${work_dir}/si.scf.out"
printf '%s\n' "${run_mode}" > "${output_dir}/run-mode.txt"
shasum -a 256 "${work_dir}/si.scf.in" "${work_dir}/pseudo/Si.pz-vbc.UPF" > "${output_dir}/inputs.sha256"
echo "Quantum ESPRESSO M0 probe passed"
