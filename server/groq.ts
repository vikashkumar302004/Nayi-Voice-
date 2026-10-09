type ChatMessage = { role:'system'|'user'|'assistant'; content:string };

const keys = () => (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '')
  .split(',').map(key => key.trim()).filter(Boolean);
let cursor = 0;

export async function groqChat(messages:ChatMessage[]) {
  const pool = keys();
  if (!pool.length) return null;
  let lastStatus = 500;
  for (let attempt=0; attempt<pool.length; attempt++) {
    const index=(cursor+attempt)%pool.length;
    const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{authorization:`Bearer ${pool[index]}`,'content-type':'application/json'},
      body:JSON.stringify({model:process.env.GROQ_MODEL??'openai/gpt-oss-20b',temperature:.3,max_completion_tokens:180,messages})
    });
    if(response.ok){cursor=(index+1)%pool.length;const data=await response.json() as any;return data.choices?.[0]?.message?.content as string|undefined}
    lastStatus=response.status;
    if(![401,403,429,500,502,503,504].includes(response.status)) break;
  }
  throw new Error(`AI provider unavailable (${lastStatus})`);
}
