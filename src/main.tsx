import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowUpRight, CalendarDays, ChevronDown, Clock3, Headphones, LayoutDashboard, MessageCircle, Phone, PhoneCall, Settings, Sparkles, Users, WandSparkles } from 'lucide-react';
import './styles.css';
import './auth.css';
import './studio.css';
import './operations.css';
import { AuthScreen } from './AuthScreen';
import { VoiceLab } from './VoiceLab';
import { Session, setAgentStatus } from './api';
import { AgentStudio } from './AgentStudio';
import { OperationsPage } from './OperationsPage';

type NavKey = 'Overview' | 'Calls' | 'Agent' | 'Customers' | 'Automations';

const calls = [
  { name: 'Ananya Sharma', phone: '+91 98••• 4210', intent: 'Appointment booked', time: '2 min ago', duration: '03:42', tone: 'positive' },
  { name: 'Rohit Mehta', phone: '+91 87••• 1904', intent: 'Pricing enquiry', time: '18 min ago', duration: '02:18', tone: 'neutral' },
  { name: 'Priya Nair', phone: '+91 99••• 7701', intent: 'Rescheduled visit', time: '34 min ago', duration: '04:06', tone: 'positive' },
  { name: 'Unknown caller', phone: '+91 76••• 3382', intent: 'Human handoff', time: '1 hr ago', duration: '01:51', tone: 'warning' },
];

const nav: { label: NavKey; icon: React.ElementType }[] = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Calls', icon: PhoneCall },
  { label: 'Agent', icon: Sparkles }, { label: 'Customers', icon: Users },
  { label: 'Automations', icon: WandSparkles },
];

function App() {
  const [active, setActive] = useState<NavKey>('Overview');
  const [live, setLive] = useState(true);
  const [voiceOpen,setVoiceOpen]=useState(false);

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><PhoneCall size={19}/></div><span>Nayi Voice</span><b>beta</b></div>
      <nav>{nav.map(({label, icon: Icon}) => <button key={label} className={active === label ? 'active' : ''} onClick={() => setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="side-bottom">
        <button><Settings size={18}/>Settings</button>
        <div className="profile"><div className="avatar">AK</div><div><strong>Arjun Kapoor</strong><small>Aura Clinic</small></div><ChevronDown size={16}/></div>
      </div>
    </aside>

    <main>
      <header><div><span className="eyebrow">FRIDAY, 9 OCTOBER</span><h1>Good morning.</h1><p>Your AI receptionist is handling calls while you focus on customers.</p></div><div className="header-actions"><button className="ghost"><CalendarDays size={17}/>Last 7 days<ChevronDown size={15}/></button><button className="primary" onClick={()=>setVoiceOpen(true)}><Phone size={17}/>Test your agent</button></div></header>

      {active==='Agent'?<AgentStudio/>:active==='Calls'||active==='Customers'?<OperationsPage view={active}/>:<><section className="agent-strip">
        <div className="agent-icon"><span></span><Activity size={22}/></div>
        <div className="agent-copy"><div><strong>Meera</strong><span className={live ? 'status live' : 'status'}>{live ? 'Live' : 'Paused'}</span></div><p>Hindi + English · Front desk agent</p></div>
        <div className="agent-stats"><span><b>18</b> calls today</span><i></i><span><b>7</b> bookings</span><i></i><span><b>96%</b> answered</span></div>
        <button className="toggle-wrap" onClick={async()=>{const next=!live;setLive(next);try{await setAgentStatus(next?'live':'paused')}catch{setLive(!next)}}}><span>{live ? 'Accepting calls' : 'Calls paused'}</span><i className={live ? 'toggle on' : 'toggle'}><b></b></i></button>
      </section>

      <section className="metrics">
        <Metric icon={PhoneCall} label="Total calls" value="124" delta="12.4%" note="vs. previous week" />
        <Metric icon={CalendarDays} label="Appointments" value="38" delta="8.1%" note="31% conversion" />
        <Metric icon={Clock3} label="Time saved" value="9.6h" delta="2.3h" note="this week" />
        <Metric icon={Users} label="Human handoffs" value="11" delta="8.9%" note="of all calls" neutral />
      </section>

      <section className="grid">
        <div className="panel activity-panel">
          <div className="panel-head"><div><h2>Call activity</h2><p>Volume and outcomes across the week</p></div><div className="legend"><span><i className="dot teal"></i>Answered</span><span><i className="dot gold"></i>Booked</span></div></div>
          <div className="chart">
            {[['MON',54,25],['TUE',72,34],['WED',48,30],['THU',86,46],['FRI',68,38],['SAT',40,19],['SUN',26,11]].map(([d,a,b]) => <div className="bar-group" key={d}><div className="bars"><i style={{height: `${a}%`}}></i><i style={{height: `${b}%`}}></i></div><small>{d}</small></div>)}
          </div>
        </div>

        <div className="panel next-panel">
          <div className="panel-head"><div><h2>Next appointments</h2><p>Booked by Meera</p></div><button className="icon-btn"><ArrowUpRight size={18}/></button></div>
          <Appointment time="10:30" initials="AS" name="Ananya Sharma" service="Dental consultation" color="mint"/>
          <Appointment time="11:15" initials="RM" name="Rohit Mehta" service="Follow-up visit" color="sand"/>
          <Appointment time="12:00" initials="PN" name="Priya Nair" service="Routine check-up" color="lavender"/>
        </div>
      </section>

      <section className="panel calls-panel">
        <div className="panel-head"><div><h2>Recent conversations</h2><p>AI summaries, outcomes and customer sentiment</p></div><button className="text-btn">View all calls <ArrowUpRight size={15}/></button></div>
        <div className="call-table">
          <div className="tr th"><span>CALLER</span><span>OUTCOME</span><span>TIME</span><span>DURATION</span><span></span></div>
          {calls.map((call, i) => <div className="tr" key={i}><span className="caller"><i><Headphones size={16}/></i><em><strong>{call.name}</strong><small>{call.phone}</small></em></span><span><b className={`pill ${call.tone}`}>{call.intent}</b></span><span>{call.time}</span><span>{call.duration}</span><button className="icon-btn"><ArrowUpRight size={16}/></button></div>)}
        </div>
      </section>

      <section className="insight"><div className="insight-icon"><MessageCircle size={20}/></div><div><span>MEERA'S INSIGHT</span><p>Most callers ask about evening availability. Opening one extra 6:30 PM slot could capture approximately <strong>5 more bookings each week.</strong></p></div><button>Review suggestion</button></section></>}
    </main>{voiceOpen&&<VoiceLab onClose={()=>setVoiceOpen(false)}/>} 
  </div>
}

function Metric({icon: Icon,label,value,delta,note,neutral=false}:{icon:React.ElementType,label:string,value:string,delta:string,note:string,neutral?:boolean}) { return <div className="metric"><div className="metric-top"><span>{label}</span><i><Icon size={18}/></i></div><strong>{value}</strong><p><b className={neutral ? 'neutral' : ''}>{neutral ? '' : '↑ '}{delta}</b> {note}</p></div> }
function Appointment({time,initials,name,service,color}:{time:string,initials:string,name:string,service:string,color:string}) { return <div className="appointment"><time>{time}</time><div className={`mini-avatar ${color}`}>{initials}</div><div><strong>{name}</strong><small>{service}</small></div><button>Details</button></div> }

function Root(){const [session,setSession]=useState<Session|null>(()=>localStorage.getItem('nayi_token')?{token:localStorage.getItem('nayi_token')!,user:JSON.parse(localStorage.getItem('nayi_user')||'{}')}:null);return session?<App/>:<AuthScreen onDone={setSession}/>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
