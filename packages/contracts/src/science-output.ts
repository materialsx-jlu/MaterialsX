/** Native quantities emitted by the registered atomistic calculators, not research targets. */
export const atomisticOutputs = [
  { name: 'energy', aliases: ['energy', 'energyEv', '能量', '势能'], units: ['eV'] },
  { name: 'forces', aliases: ['force', 'forces', 'forcesEvPerAngstrom', '受力', '原子力', '力向量'], units: ['eV/Å', 'eV/angstrom', 'eV/Angstrom', 'eV/A'] },
] as const;
export const atomisticOutputMethods = ['materials_science', 'get_atomistic_job', 'run_atomistic_calculation', 'relax_atomic_structure', 'run_atomic_md'] as const;
