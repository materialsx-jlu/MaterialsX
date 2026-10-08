"""Fixed-cell, bounded ASE dynamics. Real sampled frames; no exact restart promise."""
from __future__ import annotations
import hashlib
import io
import json
import os
import time
import numpy as np
import psutil
from ase import units
from ase.io import write
from ase.md.verlet import VelocityVerlet
from ase.md.langevin import Langevin
from ase.md.velocitydistribution import MaxwellBoltzmannDistribution
from adapters import evaluate
from relaxation import geometry_guard


def validate_options(options, task):
    expected = {k: v for k, v in options.items() if k != 'frictionInverseFs'}
    if task != {'kind': 'md', **expected}:
        raise ValueError('MD_PLAN_MISMATCH')
    if (options['ensemble'] == 'nvt') != (options['frictionInverseFs'] is not None):
        raise ValueError('MD_THERMOSTAT_MISMATCH')


def diagnostics(rows, options, atom_count):
    duration = rows[-1]['timeFs']
    if options['ensemble'] == 'nve':
        # All integrator steps, never thermostat data. eV/fs -> meV/atom/ps.
        t = np.array([r['timeFs'] for r in rows],dtype=float); e = np.array([r['totalEnergyEv'] for r in rows],dtype=float)
        t -= t.mean(); e -= e.mean()
        slope = float(np.dot(t, e) / np.dot(t, t) * 1e6 / atom_count)
        return dict(nveDriftMevPerAtomPerPs=slope, nveVerdict='insufficient_duration' if duration < 1000 else 'passed' if abs(slope) <= 1 else 'failed',
            nvtMeanTemperatureK=None, nvtRelativeTemperatureError=None, nvtVerdict='not_applicable')
    tail = [r['temperatureK'] for r in rows if r['timeFs'] >= duration / 2]
    mean = float(np.mean(tail)); relative = abs(mean / options['temperatureK'] - 1)
    return dict(nveDriftMevPerAtomPerPs=None, nveVerdict='not_applicable', nvtMeanTemperatureK=mean,
        nvtRelativeTemperatureError=relative, nvtVerdict='insufficient_duration' if duration < 500 else 'passed' if relative <= .2 else 'failed')


def numerical_guard(atoms, previous_positions, values, temperature):
    velocity = atoms.get_velocities() * units.fs  # ASE velocity unit is NOT angstrom/fs
    if not np.isfinite(velocity).all() or not np.isfinite(temperature):
        raise ValueError('MD_NONFINITE_VELOCITY_OR_TEMPERATURE')
    if temperature > 5000:
        raise ValueError('MD_TEMPERATURE_EXPLOSION')
    if np.linalg.norm(velocity, axis=1).max() > .5:
        raise ValueError('MD_VELOCITY_EXPLOSION')
    if np.linalg.norm(np.asarray(values['forcesEvPerAngstrom']), axis=1).max() > 100:
        raise ValueError('MD_FORCE_LIMIT')
    if np.linalg.norm(atoms.positions - previous_positions, axis=1).max() > .2:
        raise ValueError('MD_STEP_DISPLACEMENT_LIMIT')
    return velocity


def run_md(atoms, calculator, elements, original, plan, options, directory, run_id, atomic_json, emit, check65):
    check65('MDOptions', options); validate_options(options, plan['task'])
    if len(atoms) > plan['budget']['maxAtoms'] or options['steps'] > plan['budget']['maxSteps']:
        raise ValueError('MD_BUDGET_EXCEEDED')
    if any(symbol in ('H', 'He') for symbol in atoms.get_chemical_symbols()) and options['timestepFs'] > .25:
        raise ValueError('MD_LIGHT_ELEMENT_TIMESTEP_LIMIT: use <= 0.25 fs')
    initial_cell = atoms.cell.array.copy(); atoms.calc = calculator
    # Both ensembles use 3N DOF. COM retained; no hidden projection or temperature rescale each step.
    rng = np.random.Generator(np.random.PCG64(options['seed']))
    MaxwellBoltzmannDistribution(atoms, temperature_K=options['temperatureK'], force_temp=True, rng=rng)
    initial_velocity_sha = hashlib.sha256(np.asarray(atoms.get_velocities() * units.fs, dtype='<f8').tobytes()).hexdigest()
    if options['ensemble'] == 'nve':
        integrator = VelocityVerlet(atoms, options['timestepFs'] * units.fs, logfile=None)
    else:
        integrator = Langevin(atoms, options['timestepFs'] * units.fs, temperature_K=options['temperatureK'],
            friction=options['frictionInverseFs'] / units.fs, fixcm=False, rng=rng, logfile=None)
    started = time.monotonic(); rows = []; entries = []; process = psutil.Process(); peak = 0.
    index = dict(version='m6.5-v1', runId=run_id, planId=plan['id'], structureId=original['id'], options=options, atomCount=len(atoms), entries=entries)
    previous = atoms.positions.copy(); last_event = -1e6
    with (directory / 'frames.ndjson').open('wb') as frames, (directory / 'trajectory.extxyz').open('wb') as xyz, (directory / 'observables.csv').open('w', encoding='utf-8') as csv:
        csv.write('step,time_fs,potential_energy_eV,kinetic_energy_eV,total_energy_eV,temperature_K,max_force_eV_per_A,min_distance_A,max_speed_A_per_fs,elapsed_s\n')
        for step in range(options['steps'] + 1):
            try:
                minimum = geometry_guard(atoms, initial_cell)
            except ValueError as error:
                raise ValueError(str(error).replace("RELAXATION_", "MD_").replace("OPTIMIZATION_", "MD_")) from error
            values = evaluate(atoms, calculator, elements)
            kinetic = float(atoms.get_kinetic_energy()); temperature = float(2 * kinetic / (3 * len(atoms) * units.kB))
            velocity = numerical_guard(atoms, previous, values, temperature)
            row = dict(step=step, timeFs=step*options['timestepFs'], potentialEnergyEv=values['energyEv'], kineticEnergyEv=kinetic,
                totalEnergyEv=values['energyEv']+kinetic, temperatureK=temperature,
                maxForceEvPerAngstrom=float(np.linalg.norm(values['forcesEvPerAngstrom'],axis=1).max()),
                minimumDistanceAngstrom=minimum, maxSpeedAngstromPerFs=float(np.linalg.norm(velocity,axis=1).max()), elapsedSeconds=time.monotonic()-started)
            check65('MDStep', row); rows.append(row)
            csv.write(','.join(str(v) for v in row.values())+'\n'); csv.flush()
            if step % options['sampleEvery'] == 0 or step == options['steps']:
                frame = dict(version='m6.5-v1',runId=run_id,planId=plan['id'],structureId=original['id'],index=len(entries),step=row,
                    positionsAngstrom=atoms.positions.tolist(),velocitiesAngstromPerFs=velocity.tolist())
                check65('MDFrame', frame)
                raw = (json.dumps(frame, separators=(',', ':'), allow_nan=False)+'\n').encode()
                geometry = atoms.copy(); geometry.calc = None; geometry.set_constraint([])
                # Explicit velocity column is angstrom/fs, not ASE's internal momentum unit.
                geometry.set_momenta(None); geometry.new_array('velocity_A_per_fs', velocity.copy())
                geometry.info = {'step':step,'time_fs':row['timeFs'],'temperature_K':temperature,'quality':'needs_review','positions':'unwrapped-cartesian'}
                stream = io.StringIO(); write(stream, geometry, format='extxyz', write_results=False); raw_xyz = stream.getvalue().encode()
                entry = dict(index=len(entries),step=step,timeFs=row['timeFs'],frame=dict(offset=frames.tell(),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()),
                    extxyz=dict(offset=xyz.tell(),bytes=len(raw_xyz),sha256=hashlib.sha256(raw_xyz).hexdigest()))
                frames.write(raw); frames.flush(); xyz.write(raw_xyz); xyz.flush()
                entries.append(entry); atomic_json(directory/'trajectory-index.json',index)
            peak = max(peak, process.memory_info().rss / 1048576)
            size = sum(p.stat().st_size for p in directory.iterdir() if p.is_file())
            if peak > plan['budget']['maxMemoryMiB']: raise ValueError('MEMORY_LIMIT')
            if size > plan['budget']['maxOutputMiB']*1048576: raise ValueError('OUTPUT_SIZE_LIMIT')
            if time.monotonic() - last_event >= 1 or step == options['steps']:
                emit('md_step',step=row); last_event=time.monotonic()
            if step == options['steps']: break
            previous=atoms.positions.copy(); integrator.run(1)
    check65('MDIndex',index)
    elapsed=max(time.monotonic()-started,1e-9)
    summary=dict(version='m6.5-v1',runId=run_id,planId=plan['id'],structureId=original['id'],options=options,
        completedSteps=options['steps'],frameCount=len(entries),stopReason='requested_steps_completed',initial=rows[0],final=rows[-1],
        initialVelocitySha256=initial_velocity_sha,initialization='Maxwell-Boltzmann-PCG64-exact-3N-temperature-COM-retained',degreesOfFreedom=3*len(atoms),
        integrator='VelocityVerlet' if options['ensemble']=='nve' else 'Langevin',fixCenterOfMass=False,
        **diagnostics(rows,options,len(atoms)),elapsedSeconds=elapsed,stepsPerSecond=options['steps']/elapsed,peakMemoryMiB=peak,outputMiB=size/1048576,quality='needs_review')
    check65('MDSummary',summary); atomic_json(directory/'md-summary.json',summary)
    atomic_json(directory/'md-observables.json',rows)
    for locale in ('zh','en'):
        text=(f'# 短程分子动力学报告\n\n{options["ensemble"].upper()}，固定晶胞；真实完成 {options["steps"]} 步，{rows[-1]["timeFs"]} fs，采样间隔 {options["sampleEvery"]} 步；初始/最后帧总是保留。\n\n质量：需科学复核。短程轨迹不能证明扩散、相变或长期热稳定性。NVT 温度诊断不等于 NVE 能量守恒。\n\n' if locale=='zh' else f'# Short molecular dynamics report\n\n{options["ensemble"].upper()}, fixed cell; {options["steps"]} real steps, {rows[-1]["timeFs"]} fs, sample every {options["sampleEvery"]} steps; initial/final frames retained.\n\nNeeds scientific review. A short trajectory establishes neither diffusion, phase transition nor long-term thermal stability. Thermostat temperature control is not energy conservation.\n\n')
        text+='```json\n'+json.dumps(summary,indent=2,ensure_ascii=False)+'\n```\n\nPositions: unwrapped Å; velocities: Å/fs; time: fs; energies: total eV; temperature: 3N DOF, COM retained. Fixed cell, no constraints, PCG64 exact-temperature Maxwell-Boltzmann initialization (rescaled sample; not an equilibrium ensemble). Langevin friction: fs^-1. NVE slope: all steps, least-squares total-energy drift, meV/atom/ps, minimum 1000 fs, |slope| ≤1. NVT: mean temperature in final half, minimum 500 fs, relative error ≤20%; engineering smoke only. No DFT accuracy evidence. Checkpoints do not contain full integrator/RNG state; reuse geometry starts a NEW segment.\n'
        (directory/f'report.{locale}.md').write_text(text,encoding='utf-8')
    return values, summary
