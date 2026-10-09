process.env.NODE_ENV = 'test';
process.env.DATABASE_FILE = './data/smoke-test.db';

const [{ default: request }, appModule] = await Promise.all([
  import('supertest'), import('./index.js')
]);
const app=appModule.default;

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
const appointment=await request(app).post('/api/appointments').set('authorization',`Bearer ${token}`).send({customerName:'Test Customer',service:'Consultation',startsAt:new Date(Date.now()+86400000).toISOString()}).expect(201);
await request(app).patch(`/api/appointments/${appointment.body.id}/status`).set('authorization',`Bearer ${token}`).send({status:'completed'}).expect(200);
const appointments=await request(app).get('/api/appointments').set('authorization',`Bearer ${token}`).expect(200);
const browserCall=await request(app).post('/api/calls/browser/start').set('authorization',`Bearer ${token}`).expect(201);
await request(app).patch(`/api/calls/browser/${browserCall.body.id}/finish`).set('authorization',`Bearer ${token}`).send({summary:'Caller asked about consultation.',outcome:'enquiry_resolved',sentiment:'positive'}).expect(200);
const calls=await request(app).get('/api/calls').set('authorization',`Bearer ${token}`).expect(200);
const wav=Buffer.alloc(44+16000*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const transcription=await request(app).post('/api/ai/transcribe').set('authorization',`Bearer ${token}`).set('content-type','audio/wav').send(wav).expect(200);
const ai = await request(app).post('/api/ai/respond').set('authorization',`Bearer ${token}`).send({message:'Kal appointment chahiye',history:[{role:'user',content:'Kal appointment chahiye'}]}).expect(200);
const bookingDate=new Date(Date.now()+172800000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const toolBooking=appModule.executeAgentTool('book_appointment',{customerName:'Riya',service:'Consultation',startsAt:`${bookingDate}T10:00:00+05:30`},registration.body.workspace.id);
if(!toolBooking.success)throw new Error(`Booking tool failed: ${JSON.stringify(toolBooking)}`);
const automations=await request(app).get('/api/automations').set('authorization',`Bearer ${token}`).expect(200);
if(automations.body.rules.length!==3||automations.body.jobs.length<1)throw new Error('Automation rules or reminder job missing');
await request(app).patch(`/api/automations/${automations.body.rules[1].id}`).set('authorization',`Bearer ${token}`).send({enabled:true,delayMinutes:30}).expect(200);
const settings=await request(app).get('/api/settings').set('authorization',`Bearer ${token}`).expect(200);
await request(app).post('/api/settings/password').set('authorization',`Bearer ${token}`).send({currentPassword:'SecurePass123!',newPassword:'NewSecurePass456!'}).expect(200);
await request(app).post('/api/auth/login').send({email,password:'NewSecurePass456!'}).expect(200);
const auditLog=await request(app).get('/api/settings').set('authorization',`Bearer ${token}`).expect(200);

console.log(JSON.stringify({
  health:health.body.ok,
  authenticated:Boolean(token),
  agent:dashboard.body.agent.name,
  initialStatus:dashboard.body.agent.status,
  toggledStatus:toggled.body.status,
  aiProvider:ai.body.provider,
  hasReply:Boolean(ai.body.reply),
  services:setup.body.services.length,
  knowledge:setup.body.knowledge.length,
  appointments:appointments.body.appointments.length
  ,aiBooking:true
  ,transcriptionProvider:transcription.body.provider
  ,savedCalls:calls.body.calls.length
  ,automationRules:automations.body.rules.length
  ,queuedJobs:automations.body.jobs.length
  ,securityHeaders:Boolean(settings.headers['content-security-policy'])
  ,auditEvents:auditLog.body.audit.length
}));
