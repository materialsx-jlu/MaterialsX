import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Only the main process chooses executable/script/request; never expose this through generic IPC. */
export function runBoundedChild(python: string, script: string, request: unknown,
  options: { seconds: number; signal?: AbortSignal; onEvent?: (event: Record<string, unknown>) => void; cwd: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    if(options.signal?.aborted) { reject(Error("CANCELLED")); return; }
    const env: NodeJS.ProcessEnv = {};
    for(const name of ["PATH","SystemRoot","WINDIR","TEMP","TMP","LANG"]) if(process.env[name]) env[name] = process.env[name];
    Object.assign(env,{PYTHONNOUSERSITE:"1",PYTHONDONTWRITEBYTECODE:"1",OMP_NUM_THREADS:"4",OPENBLAS_NUM_THREADS:"4",MPLCONFIGDIR:options.cwd});
    // -I ignores PYTHONDONTWRITEBYTECODE; -B keeps installed source trees unchanged.
    const child = spawn(python,["-I","-B",script],{cwd:options.cwd,env,stdio:["pipe","pipe","pipe"],detached:process.platform!=="win32",windowsHide:true});
    let failure: Error | null = null; let outputBytes = 0; let killTimer: NodeJS.Timeout | undefined; let closed = false;
    const killTree = (force: boolean) => {
      if(!child.pid || closed) return;
      if(process.platform === "win32") {
        const killer = spawn("taskkill",["/PID",String(child.pid),"/T",...(force?["/F"]:[])],{stdio:"ignore",windowsHide:true});
        killer.on("error",()=>child.kill());
      } else { try { process.kill(-child.pid,force?"SIGKILL":"SIGTERM"); } catch { /* already exited */ } }
    };
    const stop = (reason: string) => { if(failure) return; failure=Error(reason); killTree(false); killTimer=setTimeout(()=>killTree(true),1500); };
    const abort = () => stop("CANCELLED");
    options.signal?.addEventListener("abort",abort,{once:true});
    const timeout = setTimeout(()=>stop("WALL_TIME_LIMIT"),options.seconds*1000);
    const lines=createInterface({input:child.stdout});
    child.stdout.on("data",(chunk:Buffer)=>{outputBytes+=chunk.length;if(outputBytes>1024*1024)stop("PROTOCOL_OUTPUT_LIMIT");});
    let stderrBytes=0;
    child.stderr.on("data",(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>1024*1024)stop("LOG_OUTPUT_LIMIT");});
    lines.on("line",line=>{
      if(failure)return;
      try { const event:unknown=JSON.parse(line);if(!event||typeof event!=="object"||Array.isArray(event))throw Error();
        const item=event as Record<string,unknown>;
        if(item.event==="error")stop(typeof item.message==="string"?item.message.slice(0,2000):"WORKER_ERROR");
        else options.onEvent?.(item);
      } catch { stop("INVALID_WORKER_PROTOCOL"); }
    });
    child.stdin.on("error",()=>{});
    child.stdin.end(JSON.stringify(request)+"\n");
    child.once("error",error=>{failure=error;});
    child.once("close",code=>{closed=true;clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);lines.close();options.signal?.removeEventListener("abort",abort);
      if(failure)reject(failure);else if(code!==0)reject(Error(`WORKER_EXIT_${code}`));else resolve();});
  });
}
