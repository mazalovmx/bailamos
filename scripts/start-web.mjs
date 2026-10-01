import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,URL} from 'node:url';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const port=process.env.PORT||'3000';
if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('PORT must be between 1 and 65535');
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','0.0.0.0','--port',port],{
  cwd:fileURLToPath(new URL('../apps/web/',import.meta.url)),stdio:'inherit',env:process.env
});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
