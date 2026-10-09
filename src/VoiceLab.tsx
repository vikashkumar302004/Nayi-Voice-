import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Sparkles, Volume2, X } from 'lucide-react';
import { askAgent } from './api';

type Line={role:'user'|'assistant';content:string};
export function VoiceLab({onClose}:{onClose:()=>void}){
  const [lines,setLines]=useState<Line[]>([{role:'assistant',content:'Namaste! Main Meera bol rahi hoon. Main aapki kaise madad kar sakti hoon?'}]);
  const [listening,setListening]=useState(false);const [busy,setBusy]=useState(false);const recognition=useRef<any>(null);
  useEffect(()=>{speak(lines[0].content);return()=>speechSynthesis.cancel()},[]);
  function speak(text:string){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='hi-IN';utterance.rate=.98;speechSynthesis.speak(utterance)}
  async function send(message:string){const next=[...lines,{role:'user' as const,content:message}];setLines(next);setBusy(true);try{const result=await askAgent(message,next.slice(-8));const updated=[...next,{role:'assistant' as const,content:result.reply}];setLines(updated);speak(result.reply)}catch{const reply='Main abhi server se connect nahi kar pa rahi. Kripya ek baar phir try karein.';setLines([...next,{role:'assistant',content:reply}]);speak(reply)}finally{setBusy(false)}}
  function toggle(){if(listening){recognition.current?.stop();setListening(false);return}const SpeechRecognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!SpeechRecognition){alert('Voice recognition Chrome ya Edge mein available hai.');return}const r=new SpeechRecognition();r.lang='hi-IN';r.interimResults=false;r.onresult=(e:any)=>send(e.results[0][0].transcript);r.onend=()=>setListening(false);r.onerror=()=>setListening(false);recognition.current=r;r.start();setListening(true)}
  return <div className="modal-backdrop"><div className="voice-lab"><div className="voice-head"><div><span><Sparkles size={16}/> FREE BROWSER TEST</span><h2>Talk to Meera</h2></div><button onClick={onClose}><X/></button></div><div className="voice-orb"><i className={listening?'pulse':''}><Volume2/></i><strong>{listening?'Listening…':busy?'Thinking…':'Ready to talk'}</strong><small>No phone call charges</small></div><div className="transcript">{lines.map((line,i)=><div key={i} className={`bubble ${line.role}`}>{line.content}</div>)}</div><div className="voice-controls"><button className={listening?'mic active':'mic'} onClick={toggle} disabled={busy}>{listening?<MicOff/>:<Mic/>}</button><button className="hangup" onClick={onClose}><PhoneOff/></button></div><p className="voice-hint">Tap the microphone and speak in Hindi, Hinglish or English.</p></div></div>
}
