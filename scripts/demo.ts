import { event, open, put } from '../src/core';
const s=open(process.argv[2]||'data/demo');
const items=[['chrome','Designing a quieter digital life','https://example.com/digital-life'],['youtube','The art of paying attention','https://youtube.com/watch?v=sample'],['firefox','A field guide to local-first software','https://example.org/local-first'],['chrome','Walking routes for the weekend','https://example.com/walks'],['google_activity','Notes on creative practice','https://example.net/notes']];
s.db.transaction(()=>{for(let i=0;i<65;i++){const [source,title,url]=items[i%items.length];put(s,event({source,kind:source==='youtube'?'video_watch':'page_view',ts:Date.parse('2026-09-07T19:30:00Z')-i*600000,title,url,duration_ms:null,meta:source==='youtube'?JSON.stringify({channel:'Everyday ideas'}):'{}'}),s.device);}})();
console.log('Seeded isolated sample database:',s.home);s.db.close();
