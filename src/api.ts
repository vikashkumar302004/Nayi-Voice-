export type Session = { token:string; user:{id:string;name:string;email:string}; workspace?:{id:string;name:string;industry:string} };

async function api<T>(path:string, options:RequestInit = {}):Promise<T> {
  const token = localStorage.getItem('nayi_token');
  const response = await fetch(`/api${path}`, { ...options, headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`} : {}),...options.headers} });
  const body = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong');
  return body;
}
export const register = (body:object) => api<Session>('/auth/register',{method:'POST',body:JSON.stringify(body)});
export const login = (body:object) => api<Session>('/auth/login',{method:'POST',body:JSON.stringify(body)});
export const setAgentStatus = (status:'live'|'paused') => api<{status:string}>('/agent/status',{method:'PATCH',body:JSON.stringify({status})});
export const askAgent = (message:string, history:{role:string;content:string}[]) => api<{reply:string;provider:string;actions?:string[]}>('/ai/respond',{method:'POST',body:JSON.stringify({message,history})});
export const getSetup = () => api<any>('/setup');
export const saveBusiness = (body:object) => api<{saved:boolean}>('/setup/business',{method:'PUT',body:JSON.stringify(body)});
export const saveAgent = (body:object) => api<{saved:boolean}>('/setup/agent',{method:'PUT',body:JSON.stringify(body)});
export const addService = (body:object) => api<any>('/setup/services',{method:'POST',body:JSON.stringify(body)});
export const addKnowledge = (body:object) => api<any>('/setup/knowledge',{method:'POST',body:JSON.stringify(body)});
export const getCalls = () => api<{calls:any[]}>('/calls');
export const getCustomers = () => api<{customers:any[]}>('/customers');
export const createAppointment = (body:object) => api<any>('/appointments',{method:'POST',body:JSON.stringify(body)});
export const getAppointments = () => api<{appointments:any[]}>('/appointments');
export const updateAppointmentStatus = (id:string,status:string) => api<any>(`/appointments/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});
export async function transcribeAudio(blob:Blob){
  const token=localStorage.getItem('nayi_token');
  const response=await fetch('/api/ai/transcribe',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':blob.type||'audio/webm'},body:blob});
  const body=await response.json();if(!response.ok)throw new Error(body.error??'Transcription failed');return body as {text:string;provider:string};
}
export const getDashboard = () => api<any>('/dashboard');
export const startBrowserCall = () => api<{id:string;startedAt:string}>('/calls/browser/start',{method:'POST'});
export const finishBrowserCall = (id:string,body:object) => api<any>(`/calls/browser/${id}/finish`,{method:'PATCH',body:JSON.stringify(body)});
export const getAutomations = () => api<any>('/automations');
export const updateAutomation = (id:string,body:object) => api<any>(`/automations/${id}`,{method:'PATCH',body:JSON.stringify(body)});
