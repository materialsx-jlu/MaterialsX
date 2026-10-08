// Copyright © 2026 吉林大学 AI-DAOS 团队. AGPL-3.0-only.
// Fixed single-species NEP adapter. No shell, scripts, network, or user-selected engine.
#include "nep.h"
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <stdexcept>
int main(int argc,char** argv){
 try {
  if(argc!=2)throw std::runtime_error("WEIGHT_ARGUMENT_REQUIRED");
  std::ifstream file(argv[1]);std::string kind,symbol;int species;
  if(!(file>>kind>>species>>symbol)||kind!="nep4"||species!=1||symbol!="Si")throw std::runtime_error("NEP_ELEMENT_MAPPING_MISMATCH");
  int n;if(!(std::cin>>n)||n<1||n>256)throw std::runtime_error("NEP_ATOM_LIMIT");
  std::vector<double> box(9),pos(3*n),energy(n),force(3*n),virial(9*n);std::vector<int> type(n,0);
  // stdin uses ASE row-vector cell and interleaved atom xyz; engine uses column-vector cell and SoA.
  for(int i=0;i<3;i++)for(int j=0;j<3;j++){double x;if(!(std::cin>>x)||!std::isfinite(x))throw std::runtime_error("INVALID_CELL");box[j*3+i]=x;}
  for(int i=0;i<n;i++)for(int j=0;j<3;j++){double x;if(!(std::cin>>x)||!std::isfinite(x))throw std::runtime_error("INVALID_POSITION");pos[j*n+i]=x;}
  NEP nep(argv[1]);nep.compute(type,box,pos,energy,force,virial);
  for(const auto* v:{&energy,&force,&virial})for(double x:*v)if(!std::isfinite(x))throw std::runtime_error("NONFINITE_ENGINE_OUTPUT");
  std::cout<<"MX_NEPCPU_JSON="<<std::setprecision(17)<<"{\"energyEv\":"<<std::accumulate(energy.begin(),energy.end(),0.0)<<",\"forces\":[";
  for(int i=0;i<n;i++){if(i)std::cout<<',';std::cout<<'['<<force[i]<<','<<force[n+i]<<','<<force[2*n+i]<<']';}
  std::cout<<"],\"virialTensorEv\":[";for(int k=0;k<9;k++){if(k)std::cout<<',';double sum=0;for(int i=0;i<n;i++)sum+=virial[k*n+i];std::cout<<sum;}std::cout<<"]}\n";
  return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 2;}
}
