import test from 'node:test';import assert from 'node:assert/strict';
import {relaxationOptionsSchema,startRelaxationSchema,relaxationSummarySchema,relaxationComparisonSchema} from '../../contracts/src/atomistic-relaxation.js';
const options={optimizer:'FIRE',cellMode:'fixed',cellConstraint:'none',externalPressureGPa:null,maxSteps:1,fmaxEvPerAngstrom:.05};
const row={step:0,energyEv:0,objectiveEv:0,maxForceEvPerAngstrom:.1,maxFilterForceEvPerAngstrom:.1,volumeAngstrom3:64,minimumDistanceAngstrom:1,elapsedSeconds:0};
test('optimization rejects implicit pressure, arbitrary cell masks, code and unconstrained budgets',()=>{
 assert(relaxationOptionsSchema.safeParse(options).success);
 for(const extra of [{cellMode:'variable'},{cellConstraint:'full'},{externalPressureGPa:1},{optimizer:'exec'},{maxSteps:501},{fmaxEvPerAngstrom:0},{mask:[1,0,1]}])assert(!relaxationOptionsSchema.safeParse({...options,...extra}).success);
 assert(relaxationOptionsSchema.safeParse({...options,cellMode:'variable',cellConstraint:'hydrostatic',externalPressureGPa:0}).success);
 const request={projectId:'project',structureId:'s',potentialId:'chgnet-0.3.0',options};assert(startRelaxationSchema.safeParse(request).success);
 assert(!startRelaxationSchema.safeParse({...request,code:'print(1)'}).success);
});
test('convergence and maximum-step stops must reflect actual vector norms',()=>{
 const summary={version:'m6.3-v1',runId:'r',planId:'r',structureId:'s',finalStructureId:'final',finalStructureSha256:'a'.repeat(64),options,stopReason:'max_steps',completedSteps:1,initial:row,final:{...row,step:1},displacementDefinition:'final-minus-initial-cartesian-no-MIC-includes-cell-strain',displacementsAngstrom:[[0,0,0]],quality:'needs_review'};
 assert(relaxationSummarySchema.safeParse(summary).success);
 assert(!relaxationSummarySchema.safeParse({...summary,stopReason:'converged'}).success);
 assert(!relaxationSummarySchema.safeParse({...summary,completedSteps:0}).success);
 assert(!relaxationSummarySchema.safeParse({...summary,quality:'passed'}).success);
 assert(!relaxationSummarySchema.safeParse({...summary,final:{...row,step:1,maxForceEvPerAngstrom:.01,maxFilterForceEvPerAngstrom:.01}}).success);
});
test('comparison rejects changed mapping and invented displacement',()=>{
 const structure={schemaVersion:'m6.0-v1',id:'s',coordinateUnit:'angstrom',atoms:[{id:'a1',element:'Si',position:[0,0,0],occupancy:1}],cell:[[4,0,0],[0,4,0],[0,0,4]],pbc:[true,true,true],charge:null,spinMultiplicity:null,source:{artifactId:'s',sha256:'a'.repeat(64),format:'extxyz',provenance:'team-synthetic',license:'test',transformations:[]},issues:[]};
 const summary={version:'m6.3-v1',runId:'r',planId:'r',structureId:'s',finalStructureId:'final',finalStructureSha256:'a'.repeat(64),options,stopReason:'max_steps',completedSteps:1,initial:row,final:{...row,step:1},displacementDefinition:'final-minus-initial-cartesian-no-MIC-includes-cell-strain',displacementsAngstrom:[[0,0,0]],quality:'needs_review'};
 const comparison={version:'m6.3-v1',projectId:'p',runId:'r',before:structure,after:{...structure,id:'final'},forcesEvPerAngstrom:[[.1,0,0]],summary,history:[row,{...row,step:1}]};assert(relaxationComparisonSchema.safeParse(comparison).success);
 assert(!relaxationComparisonSchema.safeParse({...comparison,after:{...comparison.after,atoms:[{...structure.atoms[0],id:'a2'}]}}).success);
 assert(!relaxationComparisonSchema.safeParse({...comparison,summary:{...summary,displacementsAngstrom:[[1,0,0]]}}).success);
 assert(!relaxationComparisonSchema.safeParse({...comparison,after:{...comparison.after,cell:[[4.1,0,0],[0,4,0],[0,0,4]]}}).success);
 assert(!relaxationComparisonSchema.safeParse({...comparison,runId:'other'}).success);
 assert(!relaxationComparisonSchema.safeParse({...comparison,after:{...comparison.after,pbc:[false,false,false]}}).success);
 const two={...comparison,before:{...structure,atoms:[...structure.atoms,{...structure.atoms[0],id:'a2'}]},after:{...comparison.after,atoms:[...structure.atoms,{...structure.atoms[0],id:'a2'}]},forcesEvPerAngstrom:[[.1,0,0],[.1,0,0]]};
 assert(!relaxationComparisonSchema.safeParse(two).success); // short displacement arrays reject without throwing

});
