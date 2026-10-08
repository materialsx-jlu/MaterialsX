import type {SelectionRequest} from '../../contracts/src/potential-physics.js';
/** Shared M6 conservative physics gate; it never supplies physical parameter values. */
export function requiredInteraction(prompt:string,declared:SelectionRequest['interaction']):SelectionRequest['interaction']{
  if(declared&&!['short-range','dispersion-required'].includes(declared))return declared;
  if(/长程|long.?range|electrostatics|静电/i.test(prompt))return 'long-range-required';
  if(/自旋|spin|磁性/i.test(prompt))return 'spin-required';
  if(/电场|electric.?field/i.test(prompt))return 'field-required';
  if(/Δ.?learning|delta.?learning/i.test(prompt))return 'delta-required';
  if(/多头|multi.?head/i.test(prompt))return 'multi-head-required';
  if(/D3|色散|dispersion/i.test(prompt))return 'dispersion-required';
  return declared;
}
