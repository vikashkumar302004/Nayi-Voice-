process.env.NODE_ENV = 'test';
process.env.DATABASE_FILE = './data/smoke-test.db';

const [{ default: request }, { default: app }] = await Promise.all([
  import('supertest'), import('./index.js')
]);

const health = await request(app).get('/api/health').expect(200);
const email = `smoke-${Date.now()}@nayi.local`;
const registration = await request(app).post('/api/auth/register').send({
  businessName:'Smoke Clinic', industry:'clinic', name:'Smoke Owner', email, password:'SecurePass123!'
}).expect(201);
const token = registration.body.token;
const dashboard = await request(app).get('/api/dashboard').set('authorization',`Bearer ${token}`).expect(200);
const toggled = await request(app).patch('/api/agent/status').set('authorization',`Bearer ${token}`).send({status:'live'}).expect(200);
await request(app).put('/api/setup/business').set('authorization',`Bearer ${token}`).send({name:'Smoke Clinic',description:'A test clinic',phone:'',address:'',openingTime:'09:00',closingTime:'18:00',transferNumber:''}).expect(200);
await request(app).post('/api/setup/services').set('authorization',`Bearer ${token}`).send({name:'Consultation',durationMinutes:30,priceRupees:500}).expect(201);
await request(app).post('/api/setup/knowledge').set('authorization',`Bearer ${token}`).send({question:'Do you accept walk-ins?',answer:'Yes, subject to availability.'}).expect(201);
const setup=await request(app).get('/api/setup').set('authorization',`Bearer ${token}`).expect(200);
const ai = await request(app).post('/api/ai/respond').set('authorization',`Bearer ${token}`).send({message:'Kal appointment chahiye',history:[{role:'user',content:'Kal appointment chahiye'}]}).expect(200);

console.log(JSON.stringify({
  health:health.body.ok,
  authenticated:Boolean(token),
  agent:dashboard.body.agent.name,
  initialStatus:dashboard.body.agent.status,
  toggledStatus:toggled.body.status,
  aiProvider:ai.body.provider,
  hasReply:Boolean(ai.body.reply),
  services:setup.body.services.length,
  knowledge:setup.body.knowledge.length
}));
