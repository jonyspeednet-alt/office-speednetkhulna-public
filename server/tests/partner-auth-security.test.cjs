const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = (file, mocks) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, require: (name) => {
      if (!Object.hasOwn(mocks, name)) throw Error('Unexpected dependency '+name);
      return mocks[name];
    }, console: { log() {}, error() {}, warn() {} }, process: { env: {} }, setTimeout,
    __dirname: path.dirname(path.join(__dirname, '..', file)),
  });
  return module.exports;
};
const response = () => ({ code: 200, locals: {}, status(n) { this.code=n; return this; }, json(body) { this.body=body; return this; }, setHeader() {} });
const authController = (query) => load('controllers/partner/authController.js', {
  '../../utilities/db': { query }, bcrypt: {},
  '../../middleware/partnerAuth': {},
});

test('partner alias resolver uses exact login semantics and deterministic row ordering', async () => {
  const calls=[];
  const auth=authController(async(sql,params)=>{calls.push({sql,params});return {rows:[{id:12}]};});
  assert.equal(await auth.resolvePartnerAccount(' QA Company '),12);
  assert.equal(calls[0].params[0],'QA Company');
  assert.match(calls[0].sql,/user_id = \$1 OR contact_no = \$1 OR company_name = \$1/);
  assert.match(calls[0].sql,/ORDER BY id ASC LIMIT 1/);
});

test('partner aliases share canonical account keys and account/IP limits have shared stores', async () => {
  const options=[],routes=[];
  const limiter=Object.assign((option)=>{options.push(option);return ()=>{};},{ipKeyGenerator:ip=>ip});
  class Store { constructor(namespace){this.namespace=namespace;} }
  const auth={resolvePartnerAccount:async(name)=>['qa-id','01899000000','QA Company'].includes(name.trim())?12:null};
  load('routes/partnerRoutes.js', {
    express:{Router:()=>({post:(url,...handlers)=>routes.push({url,handlers}),get(){},put(){}})},
    '../middleware/partnerAuth':{},'../middleware/uploadMiddleware':{upload:{single:()=>()=>{}}},
    '../controllers/partner/authController':auth,'../controllers/partner/dashboardController':{},
    '../controllers/partner/requestController':{},'../controllers/partner/invoiceController':{},
    '../controllers/partner/settingsController':{},'../controllers/partner/commissionController':{},
    'express-rate-limit':limiter,'../utilities/loginRateStore':{LoginRateStore:Store},
  });
  assert.equal(options[0].store.namespace,'partner-account');
  assert.equal(options[1].store.namespace,'partner-ip');
  const resolver=routes.find(r=>r.url==='/login').handlers[1];
  const keys=[];
  for(const username of ['qa-id','01899000000','QA Company']){
    const req={body:{username,password:'test-only'},ip:'127.0.0.1'};let next=false;
    await resolver(req,response(),()=>{next=true;});assert(next);
    keys.push(options[0].keyGenerator(req));
  }
  assert.deepEqual(keys,['partner-account:12','partner-account:12','partner-account:12']);
  const invalid=response();await resolver({body:{username:[],password:'x'}},invalid,()=>assert.fail('invalid input continued'));
  assert.equal(invalid.code,400);
  auth.resolvePartnerAccount=async()=>{throw Error('offline');};
  const unavailable=response();await resolver({body:{username:'qa-id',password:'x'}},unavailable,()=>assert.fail('DB failure continued'));
  assert.equal(unavailable.code,503);
});

test('partner password changes reject plaintext rows without changing credentials', async () => {
  const controller=load('controllers/partner/settingsController.js', {
    path,fs,sharp:{},'../../middleware/uploadMiddleware':{},
    bcrypt:{hash:()=>assert.fail('plaintext authenticated'),compare:()=>assert.fail('nonhash compared')},
    '../../utilities/db':{query:()=>assert.fail('password mutated')},
  });
  const res=response();await controller.changePassword({reseller:{id:12,password:'legacy-value'},body:{current_password:'legacy-value',new_password:'new-test-value',confirm_password:'new-test-value'}},res);
  assert.equal(res.code,401);
});

const employeeAuth=(query,permissions)=>load('middleware/auth.js',{
  '../utilities/db':{query},jsonwebtoken:{verify:()=>({id:7,token_version:0})},
  '../utilities/authSecret':{getAuthSecret:()=> 'test-only'},
  '../utilities/permissionRegistry':{getEffectivePermissions:permissions||(async()=>({permissions:{},isSuperAdmin:false}))},
  '../config/env':{requestLogEnabled:false},
});
const req=()=>({method:'GET',originalUrl:'/api/protected',headers:{authorization:'Bearer test'}});

test('ordinary hot-cache reads immediately reject revocation from another worker', async () => {
  let version=0,fullQueries=0;
  const auth=employeeAuth(async(sql)=>{if(sql.includes('SELECT u.*'))fullQueries++;return {rows:[{id:7,status:'Active',token_version:version}]};});
  let allowed=0;await auth(req(),response(),()=>allowed++);assert.equal(allowed,1);
  version=1;const res=response();await auth(req(),res,()=>allowed++);
  assert.equal(res.code,401);assert.equal(allowed,1);assert.equal(fullQueries,1);
});

test('independent authentication workers reject shared-database deactivation', async () => {
  let status='Active';const query=async()=>({rows:[{id:7,status,token_version:0}]});
  const a=employeeAuth(query),b=employeeAuth(query);
  for(const worker of [a,b])await worker(req(),response(),()=>{});
  status='Inactive';a.evictAuthCache(7);
  const res=response();await b(req(),res,()=>assert.fail('other worker accepted inactive account'));
  assert.equal(res.code,401);
});

test('ordinary first read catches revocation during permission resolution', async () => {
  let version=0;const auth=employeeAuth(async()=>({rows:[{id:7,status:'Active',token_version:version}]}),async()=>{version=1;return {permissions:{},isSuperAdmin:false};});
  const res=response();await auth(req(),res,()=>assert.fail('revoked read allowed'));
  assert.equal(res.code,401);
});

test('warmed ordinary reads fail closed when shared session state cannot be verified', async () => {
  let outage=false;
  const auth=employeeAuth(async()=>{
    if(outage)throw Object.assign(Error('database unavailable'),{code:'ECONNREFUSED'});
    return {rows:[{id:7,status:'Active',token_version:0}]};
  });
  let allowed=0;await auth(req(),response(),()=>allowed++);assert.equal(allowed,1);
  outage=true;const res=response();await auth(req(),res,()=>allowed++);
  assert.equal(res.code,503);assert.equal(allowed,1);
});
