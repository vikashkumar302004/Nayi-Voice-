import express from 'express';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, migrate } from './db.js';
import { createToken, hashPassword, readToken, verifyPassword } from './auth.js';
import { groqCompletion } from './groq.js';

migrate();
const app = express();
app.use(express.json({ limit: '64kb' }));
app.disable('x-powered-by');

const asyncRoute = (fn: express.RequestHandler) => (req: express.Request, res: express.Response, next: express.NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);
const registerSchema = z.object({ businessName: z.string().min(2).max(80), industry: z.string().min(2).max(40), name: z.string().min(2).max(60), email: z.string().email(), password: z.string().min(8).max(100) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(100) });

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'nayi-voice-api', timestamp: new Date().toISOString() }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
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
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ token: await createToken(userId,workspaceId,'owner'), user: { id:userId,name:input.name,email:input.email }, workspace: { id:workspaceId,name:input.businessName,industry:input.industry } });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
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

app.get('/api/calls', (_req,res) => {
  const workspaceId=res.locals.auth.workspaceId as string;
  const limit=Math.min(Number(_req.query.limit??50),100);
  const rows=db.prepare('SELECT id,caller_name,caller_phone,direction,status,outcome,summary,sentiment,duration_seconds,started_at FROM calls WHERE workspace_id=? ORDER BY started_at DESC LIMIT ?').all(workspaceId,limit);
  res.json({calls:rows});
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
  res.status(201).json({id:appointment.id,...input,status:'confirmed'});
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

app.post('/api/ai/respond', asyncRoute(async (req,res) => {
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
    return {success:true,appointmentId:id,customerName:args.customerName,service:service.name,startsAt:startsAt.toISOString()};
  }
  return {success:false,error:'Unknown tool'};
}

app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error:'Invalid request',details:error.issues });
  console.error(error); res.status(500).json({error:'Internal server error'});
});

const port = Number(process.env.API_PORT ?? 8787);
if (process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`Nayi Voice API listening on http://127.0.0.1:${port}`));

export default app;
