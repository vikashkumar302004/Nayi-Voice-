type ChatMessage = { role:'system'|'user'|'assistant'; content:string };

const keys = () => (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '')
  .split(',').map(key => key.trim()).filter(Boolean);
let cursor = 0;

export async function groqCompletion(messages:any[], tools?:any[]) {
  const pool = keys();
  if (!pool.length) return null;
  let lastStatus = 500;
  for (let attempt=0; attempt<pool.length; attempt++) {
    const index=(cursor+attempt)%pool.length;
    const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{authorization:`Bearer ${pool[index]}`,'content-type':'application/json'},
      body:JSON.stringify({model:process.env.GROQ_MODEL??'openai/gpt-oss-20b',temperature:.2,max_completion_tokens:260,messages,...(tools?.length?{tools,tool_choice:'auto'}:{})})
    });
    if(response.ok){cursor=(index+1)%pool.length;const data=await response.json() as any;return data.choices?.[0]?.message}
    lastStatus=response.status;
    if(response.status===400){const detail=(await response.text()).slice(0,500);throw new Error(`AI provider rejected request (400): ${detail}`)}
    if(![401,403,429,500,502,503,504].includes(response.status)) break;
  }
  throw new Error(`AI provider unavailable (${lastStatus})`);
}

export async function groqChat(messages:ChatMessage[]) {
  const message=await groqCompletion(messages);
  return message?.content as string|undefined|null;
}

export async function groqTranscribe(audio:Buffer,mimeType:string){
  const pool=keys();if(!pool.length)return null;let lastStatus=500;
  for(let attempt=0;attempt<pool.length;attempt++){
    const index=(cursor+attempt)%pool.length;const form=new FormData();
    form.append('file',new Blob([audio],{type:mimeType}),mimeType.includes('ogg')?'speech.ogg':'speech.webm');
    form.append('model','whisper-large-v3-turbo');form.append('response_format','json');form.append('temperature','0');
    const response=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${pool[index]}`},body:form});
    if(response.ok){cursor=(index+1)%pool.length;const data=await response.json() as any;return data.text as string}
    lastStatus=response.status;if(![401,403,429,500,502,503,504].includes(response.status))break;
  }
  throw new Error(`Transcription provider unavailable (${lastStatus})`);
}
