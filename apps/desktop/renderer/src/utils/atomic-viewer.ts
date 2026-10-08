import { shallowRef } from "vue";
import type { AtomicViewRequest } from "../../../../../packages/contracts/src/atomic-viewer.js";
import type { ScientificSnapshot as AtomisticSnapshot } from "../../../../../packages/contracts/src/atomistic-dynamics.js";
// Exactly one active scene for the entire app, independent of streaming messages.
export const atomicViewRequest=shallowRef<AtomicViewRequest|null>(null);
export const atomicComparisonRequest=shallowRef<{projectId:string;runId:string}|null>(null);
export const atomicTrajectoryRequest=shallowRef<{projectId:string;runId:string}|null>(null);
export function openAtomicTrajectory(request:{projectId:string;runId:string}){atomicViewRequest.value=null;atomicComparisonRequest.value=null;atomicTrajectoryRequest.value=request;}
export function closeAtomicTrajectory(){atomicTrajectoryRequest.value=null;}
export function openAtomicComparison(request:{projectId:string;runId:string}){atomicTrajectoryRequest.value=null;atomicViewRequest.value=null;atomicComparisonRequest.value=request;}
export function closeAtomicComparison(){atomicComparisonRequest.value=null;}
export function openAtomicView(request:AtomicViewRequest){atomicTrajectoryRequest.value=null;atomicComparisonRequest.value=null;atomicViewRequest.value=request;}
export function closeAtomicView(){atomicViewRequest.value=null;}
// History hydration may mount many message cards together: share only in-flight
// reads, never a stale completed-job cache. Main process still checks the project.
const reads=new Map<string,Promise<AtomisticSnapshot[]>>();
export function readReferencedAtomicRuns(projectId:string):Promise<AtomisticSnapshot[]> {
  const existing=reads.get(projectId);if(existing)return existing;
  const pending=window.materialsx.listAtomisticRuns(projectId).finally(()=>reads.delete(projectId));reads.set(projectId,pending);return pending;
}
