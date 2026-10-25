const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function controller(file, pool, registry = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'controllers', file), 'utf8'), {
    module, exports: module.exports, console: { error() {} },
    require(name) {
      if (name.endsWith('/db')) return pool;
      if (name.endsWith('/permissionRegistry')) return registry;
      throw new Error('Unexpected dependency '+name);
    },
  });
  return module.exports;
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }

test('registration INSERT supplies every column/bind and rolls back a database failure', async () => {
  let insertion, rolledBack = false, released = false;
  const client = {
    async query(sql, values) {
      if (/INSERT INTO internet_connection_registrations/.test(sql)) {
        insertion = {sql, values};
        const parts = sql.match(/\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*RETURNING/);
        assert.equal(parts[1].split(',').length, parts[2].split(',').length);
        assert.equal(Math.max(...Array.from(sql.matchAll(/\$(\d+)/g), m => Number(m[1]))), values.length);
        const columns = parts[1].split(',').map(s => s.trim());
        const expressions = parts[2].split(',').map(s => s.trim());
        assert.equal(values[Number(expressions[columns.indexOf('created_by')].slice(1))-1], 17);
        assert.equal(values[Number(expressions[columns.indexOf('branch_name')].slice(1))-1], null);
        throw new Error('Simulated database rejection');
      }
      if (sql === 'ROLLBACK') rolledBack = true;
      return {rows:[]};
    }, release() { released = true; },
  };
  const api = controller('internetRegistrationController.js', {connect:async()=>client});
  const res = response();
  await api.createRegistration({user:{id:17},body:{applicant_name:'Synthetic applicant',phone:'01999000000',area:'QA',address:'QA'}},res);
  assert.ok(insertion); assert.ok(rolledBack); assert.ok(released); assert.equal(res.code,500);
});

test('registration reads restrict ordinary staff to own records and never select passwords', async () => {
  const calls=[];
  const api=controller('internetRegistrationController.js',{async query(sql,args){calls.push({sql,args});return {rows:[]};}}, {resolvePermission:user=>user.manage===true});
  await api.getRegistrations({user:{id:17}},response());
  await api.getRegistrations({user:{id:18,manage:true}},response());
  assert.match(calls[0].sql,/WHERE created_by = \$1/);
  assert.deepEqual(Array.from(calls[0].args),[17]);
  assert.doesNotMatch(calls[1].sql,/WHERE created_by/);
  for(const {sql} of calls){assert.doesNotMatch(sql,/SELECT \*/);assert.doesNotMatch(sql,/internet_password/);}
});

test('successful registration response excludes provisioning password', async () => {
  let committed=false,released=false;
  const client={async query(sql){
    if(/INSERT INTO internet_connection_registrations/.test(sql))return {rows:[{id:4,applicant_name:'Synthetic applicant',internet_password:'synthetic-sentinel'}]};
    if(sql==='COMMIT')committed=true;
    return {rows:[]};
  },release(){released=true;}};
  const api=controller('internetRegistrationController.js',{connect:async()=>client});
  const res=response();
  await api.createRegistration({user:{id:17},body:{applicant_name:'Synthetic applicant',phone:'01999000000',area:'QA',address:'QA'}},res);
  assert.equal(res.code,201);assert.equal(res.body.id,4);
  assert.equal(Object.hasOwn(res.body,'internet_password'),false);
  assert.ok(committed);assert.ok(released);
});

test('audit API maps actual immutable schema columns and bounds input', async () => {
  let call;
  const api=controller('auditVerificationController.js',{async query(sql,args){call={sql,args};return {rows:[]};}});
  const res=response();
  await api.getAuditLog({params:{resellerId:'7'},query:{limit:'99999',start_date:'2026-10-01'}},res);
  assert.equal(res.code,200);
  assert.match(call.sql,/audit\.entity_type AS reference_table/);
  assert.match(call.sql,/audit\.entity_id AS reference_id/);
  assert.match(call.sql,/audit\.notes AS note/);
  assert.match(call.sql,/audit\.amount_after - audit\.amount_before AS amount_delta/);
  assert.equal(call.args.at(-1),500);
});

test('phone directory joins can preserve free-form assignees without integer conversion', async () => {
  const queries=[];
  const api=controller('phoneDirectoryController.js',{async query(sql){queries.push(sql);return {rows:/COUNT/.test(sql)?[{count:'0'}]:[]};}});
  const res=response();
  await api.getPhones({query:{}},res);
  assert.equal(res.code,200);
  assert.equal(queries.length,2);
  for(const sql of queries)assert.match(sql,/op\.assign_to::text = u\.id::text/);
});

test('purchase order persists vendor snapshot and identical legacy/current dates', async () => {
  let insert, allocationLocked=false;
  const client={async query(sql,args){
    if(/SELECT id, name FROM asset_vendors/.test(sql))return {rows:[{id:3,name:'Synthetic vendor'}]};
    if(/pg_advisory_xact_lock/.test(sql)){allocationLocked=true;assert.match(args[0],/^PO-\d{6}$/);return {rows:[]};}
    if(/COALESCE\(MAX/.test(sql)){assert.ok(allocationLocked,'sequence allocation must hold monthly transaction lock');return {rows:[{c:'9'}]};}
    if(/INSERT INTO purchase_orders/.test(sql)){
      insert={sql,args};
      const parts=sql.match(/\(([\s\S]*?)\) VALUES \(([\s\S]*?)\)/);
      const columns=parts[1].split(',').map(s=>s.trim());
      const expressions=parts[2].split(',').map(s=>s.trim());
      assert.equal(columns.length,expressions.length);
      assert.equal(expressions[columns.indexOf('po_date')],expressions[columns.indexOf('order_date')]);
      assert.equal(args[Number(expressions[columns.indexOf('vendor_name')].slice(1))-1],'Synthetic vendor');
      assert.match(args[0],/^PO-\d{6}-0010$/,'allocation uses highest suffix rather than row count');
      return {rows:[{id:8}]};
    }
    return {rows:[]};
  },release(){}};
  const api=controller('procurementController.js',{connect:async()=>client},{resolvePermission:()=>true});
  const res=response();
  await api.createPurchaseOrder({user:{id:17},body:{vendor_id:3,order_date:'2026-10-05',items:[{item_name:'QA router',quantity:2,unit_price:100}]}},res);
  assert.ok(insert);assert.equal(res.code,201);
});

test('free-ID inventory mutations require provisioning management permission', () => {
  const routes=[];const gate=()=>{};
  const router={get(){},post(...args){routes.push(args);}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','routes','internetRegistrationRoutes.js'),'utf8'),{
    module,require(name){
      if(name==='express')return {Router:()=>router};
      if(name.endsWith('checkPermission'))return {requirePermission:key=>Object.assign(()=>{}, {key})};
      if(name.includes('Controller'))return new Proxy({}, {get:()=>gate});
      return gate;
    },
  });
  for(const route of routes.filter(args=>args[0].startsWith('/free-ids')))assert.ok(route.some(handler=>handler?.key==='support.router.manage'));
  assert.ok(routes.find(args=>args[0]==='/').every(handler=>handler?.key!== 'support.router.manage'));
});
