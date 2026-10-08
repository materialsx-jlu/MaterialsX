import {test} from 'node:test';
import assert from 'node:assert/strict';
import {userNumbers,userUnitPresent} from './user-quantities.js';
test('explicit English and Chinese counts and numeric targets are preserved without defaults',()=>{
  assert.deepEqual(userNumbers('at most eight recipes, temperature no higher than 200 °C'),[200,8]);
  assert.deepEqual(userNumbers('最多八个配方、十二次重复、二十五组，模量 3.2 GPa'),[3.2,8,12,25]);
  assert.deepEqual(userNumbers('提高模量'),[]);
});
test('temperature aliases are equivalent but prefixes and composition bases are not',()=>{
  assert(userUnitPresent('200 °C','degC'));assert(userUnitPresent('200℃','°C'));
  assert(!userUnitPresent('1 meV','MeV'));assert(!userUnitPresent('10 wt%','vol%'));
  assert(!userUnitPresent('3 µm','m'));assert(userUnitPresent('3 µm以上','µm'));assert(!userUnitPresent('3 MPa','Pa'));assert(!userUnitPresent('3 GPa','MPa'));
  assert(userUnitPresent('no more than 3 MPa and 200 °C','MPa'));
});
test('count uses only the explicitly numbered objects and cannot borrow a temperature or fractional suffix',()=>{
  const en='temperature no higher than 200 °C and at most eight recipes';
  assert(userUnitPresent(en,'count',8));assert(!userUnitPresent(en,'count',200));assert(userUnitPresent(en,'count'));
  assert(userUnitPresent('温度 200℃，最多八个配方','count',8));assert(!userUnitPresent('温度 200℃，最多八个配方','count',200));
  assert(!userUnitPresent('5 °C, 2.5 recipes','count',5));assert(!userUnitPresent('8 MPa','count',8));
});
