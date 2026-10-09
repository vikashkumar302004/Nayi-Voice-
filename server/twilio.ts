import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export function twilioSignature(url:string,params:Record<string,string>,authToken:string){
  const payload=url+Object.keys(params).sort().map(key=>key+params[key]).join('');
  return createHmac('sha1',authToken).update(payload).digest('base64');
}
export function validateTwilioSignature(url:string,params:Record<string,string>,authToken:string,provided?:string){
  if(!provided)return false;const expected=Buffer.from(twilioSignature(url,params,authToken));const actual=Buffer.from(provided);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
const streamSecret=()=>new TextEncoder().encode(process.env.APP_SECRET??'dev-only-change-this-secret');
export function createStreamToken(workspaceId:string,callSid:string){return new SignJWT({workspaceId,callSid,purpose:'twilio-stream'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('5m').sign(streamSecret())}
export async function verifyStreamToken(token:string){const result=await jwtVerify(token,streamSecret());if(result.payload.purpose!=='twilio-stream')throw new Error('Invalid stream purpose');return result.payload}
export function xmlEscape(value:string){return value.replace(/[<>&'"]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[char]!))}
