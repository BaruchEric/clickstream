import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {open,event,put,clusters} from '../src/core';
const home=mkdtempSync(join(tmpdir(),'chronicle-bench-'));const s=open(home);try{s.db.transaction(()=>{for(let i=0;i<100001;i++)put(s,event({source:'chrome',kind:'page_view',ts:1704067200000+i*180000,title:`Fixture ${i}`,url:`https://example.com/${i%1000}`,duration_ms:null,meta:'{}'}),s.device);})();const start=performance.now();const rows=clusters(s);console.log(JSON.stringify({stored:100001,clusters:rows.length,read_ms:Math.round(performance.now()-start),page_size:rows.slice(0,50).length}));}finally{s.db.close();rmSync(home,{recursive:true,force:true});}
