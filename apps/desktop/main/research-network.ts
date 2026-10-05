import {session} from 'electron';
import {PublicResearchNetwork} from '../../../packages/agent/src/papers/network.js';
/** Owned Chromium session supports the user's system proxy and explicit proxy environment without changing account/LM traffic. */
export async function createResearchFetch(){
  const owned=session.fromPartition('materialsx-public-research',{cache:false});
  const configured=process.env.HTTPS_PROXY??process.env.https_proxy??process.env.ALL_PROXY??process.env.all_proxy;
  try{if(configured){const proxy=new URL(configured);if(!['http:','https:','socks5:'].includes(proxy.protocol)||proxy.username||proxy.password||proxy.pathname!=='/'||proxy.search||proxy.hash)throw Error('RESEARCH_PROXY_CONFIGURATION_UNSUPPORTED');
    await owned.setProxy({proxyRules:proxy.origin,proxyBypassRules:'localhost;127.0.0.1;[::1]'});}}catch{return (async()=>{throw Error('RESEARCH_NETWORK_CONFIGURATION_UNSUPPORTED');}) as typeof fetch;}
  return owned.fetch.bind(owned) as typeof fetch;
}

export async function createResearchNetwork(){return new PublicResearchNetwork(await createResearchFetch());}
