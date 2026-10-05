// Copyright © 2026 吉林大学 AI-DAOS 团队. AGPL-3.0-only.
// Fixed pure-Si PBE-D3(BJ) two-body correction adapter. No shell, scripts, network, or user-selected engine.
#include "nep.h"
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <stdexcept>
int main(int argc,char** argv){
 try {
  if(argc!=1)throw std::runtime_error("NO_ARGUMENTS_ALLOWED");
  int n;if(!(std::cin>>n)||n<1||n>128)throw std::runtime_error("NEP_ATOM_LIMIT");
  std::vector<double> box(9),pos(3*n),energy(n),force(3*n),virial(9*n);std::vector<int> type(n,0);
  // stdin uses ASE row-vector cell and interleaved atom xyz; engine uses column-vector cell and SoA.
  for(int i=0;i<3;i++)for(int j=0;j<3;j++){double x;if(!(std::cin>>x)||!std::isfinite(x))throw std::runtime_error("INVALID_CELL");box[j*3+i]=x;}
  for(int i=0;i<n;i++)for(int j=0;j<3;j++){double x;if(!(std::cin>>x)||!std::isfinite(x))throw std::runtime_error("INVALID_POSITION");pos[j*n+i]=x;}
  NEP nep;
  // The D3 tables use zero-based atomic numbers. Si=14 -> table index 13.
  // No learned NEP model is initialized or evaluated.
  nep.dftd3.atomic_number[0]=13;
  nep.compute_dftd3("pbe",10.0,5.0,type,box,pos,energy,force,virial);
  for(const auto* v:{&energy,&force,&virial})for(double x:*v)if(!std::isfinite(x))throw std::runtime_error("NONFINITE_ENGINE_OUTPUT");
  std::cout<<"MX_D3_JSON="<<std::setprecision(17)<<"{\"energyEv\":"<<std::accumulate(energy.begin(),energy.end(),0.0)<<",\"forces\":[";
  for(int i=0;i<n;i++){if(i)std::cout<<',';std::cout<<'['<<force[i]<<','<<force[n+i]<<','<<force[2*n+i]<<']';}
  std::cout<<"],\"virialTensorEv\":[";for(int k=0;k<9;k++){if(k)std::cout<<',';double sum=0;for(int i=0;i<n;i++)sum+=virial[k*n+i];std::cout<<sum;}std::cout<<"]}\n";
  return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 2;}
}
