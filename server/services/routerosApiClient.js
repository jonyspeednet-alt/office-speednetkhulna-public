const net = require('net');
const crypto = require('crypto');
const { resolveRouterTarget } = require('../utilities/routerTargetPolicy');
const len = n => n < 128 ? Buffer.from([n]) : Buffer.from([(n >> 8) | 128, n & 255]);
const sentence = words => Buffer.concat([...words.map(w => { const b=Buffer.from(w); return Buffer.concat([len(b.length), b]); }), Buffer.from([0])]);
const wordLength = b => b[0] < 128 ? [b[0],1] : [((b[0]&63)<<8)+b[1],2];

async function print({ host, port, username, password, command, properties, queries = [] }) {
  const target = await resolveRouterTarget(host);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: target.address, family: target.family, port: Number(port) }); let buffer=Buffer.alloc(0), sentenceWords=[], rows=[], logged=false, settled=false, receivedBytes=0;
    const done = (error, value) => { if(settled)return; settled=true; clearTimeout(deadline); socket.destroy(); error?reject(error):resolve(value); };
    const send = words => socket.write(sentence(words));
    const attrs = words => Object.fromEntries(words.filter(w=>w.startsWith('=')).map(w=>{const i=w.indexOf('=',1);return [w.slice(1,i),w.slice(i+1)]}));
    const handle = words => { const type=words[0]; const data=attrs(words); if(type==='!trap'||type==='!fatal') return done(new Error(data.message||'RouterOS API query failed'));
      if(type==='!re'){ if(rows.length >= 50000) return done(new Error('RouterOS API response is too large')); rows.push(data); return; }
      if(type!=='!done') return;
      if(!logged){ logged=true; if(data.ret){ const response='00'+crypto.createHash('md5').update(Buffer.concat([Buffer.from([0]),Buffer.from(password),Buffer.from(data.ret,'hex')])).digest('hex'); return send(['/login',`=name=${username}`,`=response=${response}`]); } return send([command,`=.proplist=${properties.join(',')}`, ...queries]); }
      done(null,rows);
    };
    const consume = () => { while(buffer.length){ const [n,o]=wordLength(buffer); if(buffer.length<o+n)return; const w=buffer.subarray(o,o+n).toString(); buffer=buffer.subarray(o+n); if(w)sentenceWords.push(w); else { handle(sentenceWords); sentenceWords=[]; } } };
    const deadline = setTimeout(()=>done(new Error('RouterOS API timeout')),12000);
    socket.setTimeout(12000,()=>done(new Error('RouterOS API timeout'))); socket.on('error',done); socket.on('data',d=>{receivedBytes+=d.length;if(receivedBytes>8*1024*1024)return done(new Error('RouterOS API response is too large'));buffer=Buffer.concat([buffer,d]);consume();}); socket.on('connect',()=>send(['/login',`=name=${username}`,`=password=${password}`]));
  });
}
module.exports={print};
