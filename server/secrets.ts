import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const key=()=>createHash('sha256').update(process.env.APP_SECRET??'dev-only-change-this-secret').digest();
export function encryptSecret(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);const tag=cipher.getAuthTag();return [iv,tag,encrypted].map(x=>x.toString('base64url')).join('.')}
export function decryptSecret(value:string){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8')}
