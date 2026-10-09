import express from 'express';
import 'dotenv/config';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, migrate } from './db.js';
import { createToken, hashPassword, readToken, verifyPassword } from './auth.js';
import { groqCompletion, groqTranscribe } from './groq.js';
import { decryptSecret, encryptSecret } from './secrets.js';

migrate();
const app = express();
app.set('trust proxy',1);
app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}}));
app.use(express.json({ limit: '64kb' }));
app.disable('x-powered-by');
const authLimiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many authentication attempts. Please try again later.'}});
const aiLimiter=rateLimit({windowMs:60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Voice AI rate limit reached. Please wait a moment.'}});

const asyncRoute = (fn: express.RequestHandler) => (req: express.Request, res: express.Response, next: express.NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
const registerSchema = z.object({ businessName: z.string().min(2).max(80), industry: z.string().min(2).max(40), name: z.string().min(2).max(60), email: z.string().email(), password: z.string().min(8).max(100) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(100) });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'nayi-voice-api', timestamp: new Date().toISOString() }));

app.post('/api/auth/register',authLimiter,asyncRoute(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Email already registered' });
  const workspaceId = randomUUID(), userId = randomUUID(), agentId = randomUUID(), now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO workspaces (id,name,industry,created_at) VALUES (?,?,?,?)').run(workspaceId,input.businessName,input.industry,now);
    db.prepare('INSERT INTO users (id,workspace_id,name,email,password_hash,created_at) VALUES (?,?,?,?,?,?)').run(userId,workspaceId,input.name,input.email.toLowerCase(),hashPassword(input.password),now);
    db.prepare('INSERT INTO agents (id,workspace_id,name,status,languages,system_prompt,created_at) VALUES (?,?,?,?,?,?,?)').run(agentId,workspaceId,'Meera','paused',JSON.stringify(['hi-IN','en-IN']),'You are a helpful multilingual business receptionist.',now);
    db.prepare('INSERT INTO business_settings (workspace_id,updated_at) VALUES (?,?)').run(workspaceId,now);
    const automationInsert=db.prepare('INSERT INTO automation_rules (id,workspace_id,type,name,enabled,delay_minutes,channel,message_template,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    automationInsert.run(randomUUID(),workspaceId,'appointment_reminder','Appointment reminder',1,1440,'dashboard','Hi {{customer}}, this is a reminder for your {{service}} appointment at {{time}}.',now,now);
    automationInsert.run(randomUUID(),workspaceId,'missed_call','Missed call follow-up',0,5,'dashboard','We noticed your call and will get back to you shortly.',now,now);
    automationInsert.run(randomUUID(),workspaceId,'post_call','Post-call follow-up',0,60,'dashboard','Thank you for speaking with us. Reply if you need any more help.',now,now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ token: await createToken(userId,workspaceId,'owner'), user: { id:userId,name:input.name,email:input.email }, workspace: { id:workspaceId,name:input.businessName,industry:input.industry } });
}));

app.post('/api/auth/login',authLimiter,asyncRoute(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = db.prepare('SELECT id, workspace_id, name, email, password_hash, role FROM users WHERE email = ?').get(input.email.toLowerCase()) as any;
  if (!user || !verifyPassword(input.password,user.password_hash)) return res.status(401).json({ error:'Invalid email or password' });
  res.json({ token:await createToken(user.id,user.workspace_id,user.role),user:{id:user.id,name:user.name,email:user.email} });
}));

app.use('/api', asyncRoute(async (req,res,next) => {
  const token = await readToken(req.header('authorization'));
  if (!token?.workspaceId) return res.status(401).json({ error:'Authentication required' });
  res.locals.auth = token; next();
}));

app.get('/api/dashboard', (req,res) => {
  const workspaceId = res.locals.auth.workspaceId as string;
  const agent = db.prepare('SELECT id,name,status,languages FROM agents WHERE workspace_id=? LIMIT 1').get(workspaceId);
  const calls = db.prepare('SELECT * FROM calls WHERE workspace_id=? ORDER BY started_at DESC LIMIT 10').all(workspaceId);
  const appointments = db.prepare('SELECT * FROM appointments WHERE workspace_id=? AND starts_at>=? ORDER BY starts_at LIMIT 5').all(workspaceId,new Date().toISOString());
  const metrics = db.prepare(`SELECT COUNT(*) totalCalls, COALESCE(SUM(duration_seconds),0) totalSeconds, SUM(CASE WHEN outcome='appointment_booked' THEN 1 ELSE 0 END) bookings, SUM(CASE WHEN outcome='human_handoff' THEN 1 ELSE 0 END) handoffs FROM calls WHERE workspace_id=?`).get(workspaceId);
  res.json({agent,calls,appointments,metrics});
});

app.get('/api/settings', (_req,res) => {
  const auth=res.locals.auth;const user=db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=? AND workspace_id=?').get(auth.sub,auth.workspaceId);
  const workspace=db.prepare('SELECT id,name,industry,timezone,created_at FROM workspaces WHERE id=?').get(auth.workspaceId);
  const audit=db.prepare('SELECT id,action,entity_type,metadata,created_at FROM audit_logs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 20').all(auth.workspaceId);
  res.json({user,workspace,audit,security:{passwordHashing:'scrypt',tokenExpiry:'7 days',rateLimits:true,securityHeaders:true}});
});

app.post('/api/settings/password',authLimiter,(req,res) => {
  const input=z.object({currentPassword:z.string().min(8),newPassword:z.string().min(10).max(100)}).parse(req.body);
  const auth=res.locals.auth;const user=db.prepare('SELECT id,password_hash FROM users WHERE id=? AND workspace_id=?').get(auth.sub,auth.workspaceId) as any;
  if(!user||!verifyPassword(input.currentPassword,user.password_hash))return res.status(401).json({error:'Current password is incorrect'});
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(input.newPassword),user.id);
  audit(auth.workspaceId,String(auth.sub),'password_changed','user',user.id,{});
  res.json({changed:true});
});

app.get('/api/security/session', (_req,res) => res.json({valid:true,userId:res.locals.auth.sub,workspaceId:res.locals.auth.workspaceId,expiresAt:res.locals.auth.exp}));

app.get('/api/integrations/telephony', (_req,res) => {
  const connection=db.prepare('SELECT id,provider,account_id,phone_number,status,last_checked_at,created_at FROM provider_connections WHERE workspace_id=? AND provider=?').get(res.locals.auth.workspaceId,'twilio');
  res.json({connection:connection??null,requirements:{publicBaseUrl:Boolean(process.env.PUBLIC_BASE_URL),webhookPath:'/webhooks/twilio/voice',streamPath:'/telephony/stream'}});
});

app.put('/api/integrations/telephony',authLimiter,asyncRoute(async(req,res)=>{
  const input=z.object({accountSid:z.string().regex(/^AC[a-fA-F0-9]{32}$/,'Invalid Twilio Account SID'),authToken:z.string().min(20).max(100),phoneNumber:z.string().regex(/^\+[1-9]\d{7,14}$/,'Use E.164 format such as +14155552671')}).parse(req.body);
  const authHeader=`Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString('base64')}`;
  const check=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}.json`,{headers:{authorization:authHeader}});
  if(!check.ok)return res.status(400).json({error:check.status===401?'Twilio credentials are invalid':`Twilio verification failed (${check.status})`});
  const now=new Date().toISOString(),id=randomUUID(),encrypted=encryptSecret(input.authToken);
  db.prepare(`INSERT INTO provider_connections (id,workspace_id,provider,account_id,encrypted_secret,phone_number,status,last_checked_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,provider) DO UPDATE SET account_id=excluded.account_id,encrypted_secret=excluded.encrypted_secret,phone_number=excluded.phone_number,status='verified',last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`).run(id,res.locals.auth.workspaceId,'twilio',input.accountSid,encrypted,input.phoneNumber,'verified',now,now,now);
  audit(res.locals.auth.workspaceId,String(res.locals.auth.sub),'telephony_connected','integration',id,{provider:'twilio',phoneNumber:input.phoneNumber.slice(0,4)+'***'});
  res.json({connected:true,status:'verified'});
}));

app.post('/api/integrations/telephony/test',authLimiter,asyncRoute(async(_req,res)=>{
  const row=db.prepare('SELECT account_id,encrypted_secret FROM provider_connections WHERE workspace_id=? AND provider=?').get(res.locals.auth.workspaceId,'twilio') as any;
  if(!row)return res.status(404).json({error:'Twilio is not connected'});
  const check=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${row.account_id}.json`,{headers:{authorization:`Basic ${Buffer.from(`${row.account_id}:${decryptSecret(row.encrypted_secret)}`).toString('base64')}`}});
  const status=check.ok?'verified':'error';db.prepare('UPDATE provider_connections SET status=?,last_checked_at=?,updated_at=? WHERE workspace_id=? AND provider=?').run(status,new Date().toISOString(),new Date().toISOString(),res.locals.auth.workspaceId,'twilio');
  if(!check.ok)return res.status(400).json({error:'Connection test failed'});res.json({ok:true,status});
}));

app.get('/api/calls', (_req,res) => {
  const workspaceId=res.locals.auth.workspaceId as string;
  const limit=Math.min(Number(_req.query.limit??50),100);
  const rows=db.prepare('SELECT id,caller_name,caller_phone,direction,status,outcome,summary,sentiment,duration_seconds,started_at FROM calls WHERE workspace_id=? ORDER BY started_at DESC LIMIT ?').all(workspaceId,limit);
  res.json({calls:rows});
});

app.post('/api/calls/browser/start', (_req,res) => {
  const id=randomUUID();const startedAt=new Date().toISOString();
  db.prepare(`INSERT INTO calls (id,workspace_id,caller_name,caller_phone,direction,status,outcome,summary,sentiment,duration_seconds,started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,res.locals.auth.workspaceId,'Browser visitor',null,'inbound','in_progress',null,null,'neutral',0,startedAt);
  res.status(201).json({id,startedAt});
});

app.patch('/api/calls/browser/:id/finish', (req,res) => {
  const input=z.object({summary:z.string().max(5000),outcome:z.enum(['enquiry_resolved','appointment_booked','human_handoff','incomplete']),sentiment:z.enum(['positive','neutral','negative']).default('neutral')}).parse(req.body);
  const call=db.prepare('SELECT started_at FROM calls WHERE id=? AND workspace_id=? AND status=?').get(req.params.id,res.locals.auth.workspaceId,'in_progress') as any;
  if(!call)return res.status(404).json({error:'Active browser call not found'});
  const duration=Math.max(1,Math.round((Date.now()-new Date(call.started_at).getTime())/1000));
  db.prepare('UPDATE calls SET status=?,outcome=?,summary=?,sentiment=?,duration_seconds=? WHERE id=? AND workspace_id=?').run('completed',input.outcome,input.summary,input.sentiment,duration,req.params.id,res.locals.auth.workspaceId);
  res.json({id:req.params.id,durationSeconds:duration,outcome:input.outcome});
});

app.get('/api/customers', (_req,res) => {
  const workspaceId=res.locals.auth.workspaceId as string;
  const customers=db.prepare(`SELECT caller_phone phone,MAX(COALESCE(caller_name,'Unknown caller')) name,COUNT(*) total_calls,MAX(started_at) last_contact,SUM(CASE WHEN outcome='appointment_booked' THEN 1 ELSE 0 END) bookings FROM calls WHERE workspace_id=? AND caller_phone IS NOT NULL GROUP BY caller_phone ORDER BY last_contact DESC`).all(workspaceId);
  res.json({customers});
});

app.post('/api/appointments', (req,res) => {
  const input=z.object({customerName:z.string().min(2).max(80),service:z.string().min(2).max(100),startsAt:z.string().datetime()}).parse(req.body);
  const appointment={id:randomUUID(),workspaceId:res.locals.auth.workspaceId,createdAt:new Date().toISOString()};
  db.prepare('INSERT INTO appointments (id,workspace_id,customer_name,service,starts_at,status,created_by) VALUES (?,?,?,?,?,?,?)').run(appointment.id,appointment.workspaceId,input.customerName,input.service,input.startsAt,'confirmed','dashboard');
  scheduleAppointmentReminder(appointment.workspaceId,appointment.id,input);
  res.status(201).json({id:appointment.id,...input,status:'confirmed'});
});

app.get('/api/automations', (_req,res) => {
  const workspaceId=res.locals.auth.workspaceId as string;
  const rules=db.prepare('SELECT id,type,name,enabled,delay_minutes,channel,message_template FROM automation_rules WHERE workspace_id=? ORDER BY created_at').all(workspaceId);
  const jobs=db.prepare('SELECT id,rule_id,related_type,related_id,status,scheduled_for,error,created_at FROM automation_jobs WHERE workspace_id=? ORDER BY scheduled_for DESC LIMIT 30').all(workspaceId);
  const counts=db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM automation_jobs WHERE workspace_id=?`).get(workspaceId);
  res.json({rules,jobs,counts});
});

app.patch('/api/automations/:id', (req,res) => {
  const input=z.object({enabled:z.boolean().optional(),delayMinutes:z.number().int().min(0).max(43200).optional(),channel:z.enum(['dashboard','whatsapp','sms','email']).optional(),messageTemplate:z.string().min(5).max(1000).optional()}).parse(req.body);
  const current=db.prepare('SELECT * FROM automation_rules WHERE id=? AND workspace_id=?').get(req.params.id,res.locals.auth.workspaceId) as any;
  if(!current)return res.status(404).json({error:'Automation not found'});
  db.prepare('UPDATE automation_rules SET enabled=?,delay_minutes=?,channel=?,message_template=?,updated_at=? WHERE id=? AND workspace_id=?').run(input.enabled===undefined?current.enabled:Number(input.enabled),input.delayMinutes??current.delay_minutes,input.channel??current.channel,input.messageTemplate??current.message_template,new Date().toISOString(),req.params.id,res.locals.auth.workspaceId);
  res.json({saved:true});
});

app.get('/api/appointments', (_req,res) => {
  const rows=db.prepare('SELECT id,customer_name,service,starts_at,status,created_by FROM appointments WHERE workspace_id=? ORDER BY starts_at').all(res.locals.auth.workspaceId);
  res.json({appointments:rows});
});

app.patch('/api/appointments/:id/status', (req,res) => {
  const input=z.object({status:z.enum(['confirmed','completed','cancelled','no_show'])}).parse(req.body);
  const result=db.prepare('UPDATE appointments SET status=? WHERE id=? AND workspace_id=?').run(input.status,req.params.id,res.locals.auth.workspaceId);
  if(!result.changes)return res.status(404).json({error:'Appointment not found'});
  res.json({id:req.params.id,status:input.status});
});

app.patch('/api/agent/status', (req,res) => {
  const status = z.object({status:z.enum(['live','paused'])}).parse(req.body).status;
  const workspaceId = res.locals.auth.workspaceId as string;
  db.prepare('UPDATE agents SET status=? WHERE workspace_id=?').run(status,workspaceId);
  res.json({status});
});

app.get('/api/setup', (_req,res) => {
  const workspaceId=res.locals.auth.workspaceId as string;
  const workspace=db.prepare('SELECT id,name,industry,timezone FROM workspaces WHERE id=?').get(workspaceId);
  const settings=db.prepare('SELECT * FROM business_settings WHERE workspace_id=?').get(workspaceId);
  const agent=db.prepare('SELECT id,name,status,languages,system_prompt FROM agents WHERE workspace_id=? LIMIT 1').get(workspaceId);
  const services=db.prepare('SELECT * FROM services WHERE workspace_id=? ORDER BY created_at').all(workspaceId);
  const knowledge=db.prepare('SELECT * FROM knowledge_entries WHERE workspace_id=? ORDER BY created_at DESC').all(workspaceId);
  res.json({workspace,settings,agent,services,knowledge});
});

app.put('/api/setup/business', (req,res) => {
  const input=z.object({name:z.string().min(2).max(80),description:z.string().max(1000),phone:z.string().max(30),address:z.string().max(300),openingTime:z.string().regex(/^\d{2}:\d{2}$/),closingTime:z.string().regex(/^\d{2}:\d{2}$/),transferNumber:z.string().max(30)}).parse(req.body);
  const workspaceId=res.locals.auth.workspaceId as string;
  db.prepare('UPDATE workspaces SET name=? WHERE id=?').run(input.name,workspaceId);
  db.prepare(`INSERT INTO business_settings (workspace_id,description,phone,address,opening_time,closing_time,transfer_number,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET description=excluded.description,phone=excluded.phone,address=excluded.address,opening_time=excluded.opening_time,closing_time=excluded.closing_time,transfer_number=excluded.transfer_number,updated_at=excluded.updated_at`).run(workspaceId,input.description,input.phone,input.address,input.openingTime,input.closingTime,input.transferNumber,new Date().toISOString());
  res.json({saved:true});
});

app.put('/api/setup/agent', (req,res) => {
  const input=z.object({name:z.string().min(2).max(40),systemPrompt:z.string().min(20).max(4000),languages:z.array(z.string()).min(1).max(5)}).parse(req.body);
  db.prepare('UPDATE agents SET name=?,system_prompt=?,languages=? WHERE workspace_id=?').run(input.name,input.systemPrompt,JSON.stringify(input.languages),res.locals.auth.workspaceId);
  res.json({saved:true});
});

app.post('/api/setup/services', (req,res) => {
  const input=z.object({name:z.string().min(2).max(80),durationMinutes:z.number().int().min(5).max(480),priceRupees:z.number().min(0).max(1000000).nullable()}).parse(req.body);
  const service={id:randomUUID(),workspaceId:res.locals.auth.workspaceId,createdAt:new Date().toISOString()};
  db.prepare('INSERT INTO services (id,workspace_id,name,duration_minutes,price_paise,created_at) VALUES (?,?,?,?,?,?)').run(service.id,service.workspaceId,input.name,input.durationMinutes,input.priceRupees===null?null:Math.round(input.priceRupees*100),service.createdAt);
  res.status(201).json({id:service.id,...input});
});

app.post('/api/setup/knowledge', (req,res) => {
  const input=z.object({question:z.string().min(3).max(300),answer:z.string().min(3).max(2000)}).parse(req.body);
  const entry={id:randomUUID(),createdAt:new Date().toISOString()};
  db.prepare('INSERT INTO knowledge_entries (id,workspace_id,question,answer,created_at) VALUES (?,?,?,?,?)').run(entry.id,res.locals.auth.workspaceId,input.question,input.answer,entry.createdAt);
  res.status(201).json({id:entry.id,...input});
});

app.post('/api/ai/respond',aiLimiter,asyncRoute(async (req,res) => {
  const input=z.object({message:z.string().min(1).max(1000),history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(2000)})).max(12).default([])}).parse(req.body);
  const agent=db.prepare('SELECT system_prompt FROM agents WHERE workspace_id=? LIMIT 1').get(res.locals.auth.workspaceId) as any;
  const workspace=db.prepare('SELECT name,industry FROM workspaces WHERE id=?').get(res.locals.auth.workspaceId) as any;
  const settings=db.prepare('SELECT description,address,opening_time,closing_time FROM business_settings WHERE workspace_id=?').get(res.locals.auth.workspaceId) as any;
  const services=db.prepare('SELECT name,duration_minutes,price_paise FROM services WHERE workspace_id=? AND active=1 LIMIT 30').all(res.locals.auth.workspaceId) as any[];
  const knowledge=db.prepare('SELECT question,answer FROM knowledge_entries WHERE workspace_id=? LIMIT 40').all(res.locals.auth.workspaceId) as any[];
  const businessContext=JSON.stringify({business:workspace,details:settings,services:services.map(s=>({...s,price_rupees:s.price_paise==null?null:s.price_paise/100})),approvedAnswers:knowledge});
  const system=`${agent?.system_prompt??''}\nCurrent time: ${new Date().toISOString()}. Verified business context: ${businessContext}\nReply naturally in the caller's language. Keep phone replies under 3 short sentences. Use only verified context for business facts. Never invent availability, prices, or policies. Use tools for availability and bookings. Never claim a booking succeeded unless book_appointment returned success.`;
  const tools=[
    {type:'function',function:{name:'check_availability',description:'Check open appointment slots for a service on a date.',parameters:{type:'object',properties:{service:{type:'string'},date:{type:'string',description:'Date in YYYY-MM-DD format'}},required:['service','date'],additionalProperties:false}}},
    {type:'function',function:{name:'book_appointment',description:'Book an appointment only after the caller provided their name, service and exact chosen start time.',parameters:{type:'object',properties:{customerName:{type:'string'},service:{type:'string'},startsAt:{type:'string',description:'ISO 8601 timestamp with timezone offset'}},required:['customerName','service','startsAt'],additionalProperties:false}}}
  ];
  const messages:any[]=[{role:'system',content:system},...input.history.slice(-8)];
  const actions:string[]=[];
  let responseMessage:any;
  for(let round=0;round<3;round++){
    responseMessage=await groqCompletion(messages,tools);
    if(!responseMessage)return res.json({reply:'Main abhi AI service se connect nahi kar pa rahi. Kripya thodi der baad try karein.',provider:'local-demo'});
    if(!responseMessage.tool_calls?.length)break;
    messages.push(responseMessage);
    for(const call of responseMessage.tool_calls.slice(0,2)){
      let result:any;
      try{const args=JSON.parse(call.function.arguments||'{}');result=executeAgentTool(call.function.name,args,res.locals.auth.workspaceId);if(result?.appointmentId)actions.push('appointment_booked')}catch(error){result={success:false,error:error instanceof Error?error.message:'Tool failed'}}
      messages.push({role:'tool',tool_call_id:call.id,name:call.function.name,content:JSON.stringify(result)});
    }
  }
  res.json({reply:responseMessage?.content||(actions.length?'Appointment successfully booked.':'Please choose one of the available times.'),provider:'groq',actions});
}));

app.post('/api/ai/transcribe',express.raw({type:['audio/webm','audio/ogg','audio/wav','application/octet-stream'],limit:'15mb'}),asyncRoute(async(req,res)=>{
  if(!Buffer.isBuffer(req.body)||req.body.length<100)return res.status(400).json({error:'Audio recording is empty'});
  const text=await groqTranscribe(req.body,req.header('content-type')?.split(';')[0]??'audio/webm');
  if(!text)return res.status(503).json({error:'Speech recognition is not configured'});
  res.json({text,provider:'groq-whisper'});
}));

function audit(workspaceId:string,userId:string|undefined,action:string,entityType:string,entityId:string|undefined,metadata:object){
  db.prepare('INSERT INTO audit_logs (id,workspace_id,user_id,action,entity_type,entity_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,userId??null,action,entityType,entityId??null,JSON.stringify(metadata),new Date().toISOString());
}

export function executeAgentTool(name:string,args:any,workspaceId:string){
  if(name==='check_availability'){
    const service=db.prepare('SELECT name,duration_minutes FROM services WHERE workspace_id=? AND lower(name)=lower(?) AND active=1').get(workspaceId,args.service) as any;
    if(!service)return {success:false,error:'Service not found'};
    const settings=db.prepare('SELECT opening_time,closing_time FROM business_settings WHERE workspace_id=?').get(workspaceId) as any;
    const start=new Date(`${args.date}T${settings?.opening_time??'09:00'}:00+05:30`);const close=new Date(`${args.date}T${settings?.closing_time??'18:00'}:00+05:30`);
    if(Number.isNaN(start.getTime()))return {success:false,error:'Invalid date'};
    const existing=db.prepare(`SELECT starts_at FROM appointments WHERE workspace_id=? AND status='confirmed' AND starts_at>=? AND starts_at<?`).all(workspaceId,start.toISOString(),close.toISOString()) as any[];
    const occupied=new Set(existing.map(x=>new Date(x.starts_at).getTime()));const slots:string[]=[];
    for(let time=start.getTime();time+service.duration_minutes*60000<=close.getTime();time+=30*60000){if(time>Date.now()&&!occupied.has(time))slots.push(new Date(time).toISOString());if(slots.length===5)break}
    return {success:true,service:service.name,durationMinutes:service.duration_minutes,availableSlots:slots};
  }
  if(name==='book_appointment'){
    const service=db.prepare('SELECT name,duration_minutes FROM services WHERE workspace_id=? AND lower(name)=lower(?) AND active=1').get(workspaceId,args.service) as any;
    if(!service)return {success:false,error:'Service not found'};
    const startsAt=new Date(args.startsAt);if(Number.isNaN(startsAt.getTime())||startsAt.getTime()<=Date.now())return {success:false,error:'Appointment time must be in the future'};
    const endsAt=new Date(startsAt.getTime()+service.duration_minutes*60000);
    const conflict=db.prepare(`SELECT id FROM appointments WHERE workspace_id=? AND status='confirmed' AND starts_at>=? AND starts_at<? LIMIT 1`).get(workspaceId,new Date(startsAt.getTime()-service.duration_minutes*60000+1).toISOString(),endsAt.toISOString());
    if(conflict)return {success:false,error:'That time is no longer available'};
    const id=randomUUID();db.prepare('INSERT INTO appointments (id,workspace_id,customer_name,service,starts_at,status,created_by) VALUES (?,?,?,?,?,?,?)').run(id,workspaceId,String(args.customerName).slice(0,80),service.name,startsAt.toISOString(),'confirmed','ai');
    scheduleAppointmentReminder(workspaceId,id,{customerName:String(args.customerName),service:service.name,startsAt:startsAt.toISOString()});
    return {success:true,appointmentId:id,customerName:args.customerName,service:service.name,startsAt:startsAt.toISOString()};
  }
  return {success:false,error:'Unknown tool'};
}

function scheduleAppointmentReminder(workspaceId:string,appointmentId:string,input:{customerName:string;service:string;startsAt:string}){
  const rule=db.prepare(`SELECT id,delay_minutes,message_template,channel FROM automation_rules WHERE workspace_id=? AND type='appointment_reminder' AND enabled=1 LIMIT 1`).get(workspaceId) as any;
  if(!rule)return;
  const scheduled=new Date(new Date(input.startsAt).getTime()-rule.delay_minutes*60000);
  if(scheduled.getTime()<=Date.now())return;
  db.prepare('INSERT INTO automation_jobs (id,workspace_id,rule_id,related_type,related_id,status,scheduled_for,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),workspaceId,rule.id,'appointment',appointmentId,'pending',scheduled.toISOString(),JSON.stringify({...input,channel:rule.channel,template:rule.message_template}),new Date().toISOString());
}

app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error:'Invalid request',details:error.issues });
  console.error(error); res.status(500).json({error:'Internal server error'});
});

const port = Number(process.env.API_PORT ?? 8787);
if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`Nayi Voice API listening on http://127.0.0.1:${port}`));

export default app;
