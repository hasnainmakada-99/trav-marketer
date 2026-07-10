const http = require('http');
const phone = '919999000' + Date.now().toString().slice(-4);
const data = JSON.stringify({phone, name: 'Email Dest Test', source: 'walk_in', serviceInterest: 'Testing new email destination'});
const req = http.request({hostname:'localhost',port:3000,path:'/api/leads',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => { console.log(body.slice(0,300)); process.exit(0); });
});
req.write(data);
req.end();
