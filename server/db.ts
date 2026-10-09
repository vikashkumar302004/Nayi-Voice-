import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DATABASE_FILE ?? './data/nayi-voice.db');
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paused', languages TEXT NOT NULL,
      system_prompt TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, caller_name TEXT,
      caller_phone TEXT, direction TEXT NOT NULL, status TEXT NOT NULL,
      outcome TEXT, summary TEXT, sentiment TEXT, duration_seconds INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, customer_name TEXT NOT NULL,
      service TEXT NOT NULL, starts_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
      created_by TEXT NOT NULL DEFAULT 'ai', FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS business_settings (
      workspace_id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      opening_time TEXT NOT NULL DEFAULT '09:00', closing_time TEXT NOT NULL DEFAULT '18:00',
      working_days TEXT NOT NULL DEFAULT '["Mon","Tue","Wed","Thu","Fri","Sat"]',
      transfer_number TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30, price_paise INTEGER,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, question TEXT NOT NULL,
      answer TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, type TEXT NOT NULL,
      name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
      delay_minutes INTEGER NOT NULL DEFAULT 0, channel TEXT NOT NULL DEFAULT 'dashboard',
      message_template TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE TABLE IF NOT EXISTS automation_jobs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, rule_id TEXT NOT NULL,
      related_type TEXT NOT NULL, related_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      scheduled_for TEXT NOT NULL, payload TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(rule_id) REFERENCES automation_rules(id)
    );
    CREATE INDEX IF NOT EXISTS calls_workspace_started ON calls(workspace_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS appointments_workspace_start ON appointments(workspace_id, starts_at);
    CREATE INDEX IF NOT EXISTS services_workspace ON services(workspace_id);
    CREATE INDEX IF NOT EXISTS knowledge_workspace ON knowledge_entries(workspace_id);
    CREATE INDEX IF NOT EXISTS automation_rules_workspace ON automation_rules(workspace_id);
    CREATE INDEX IF NOT EXISTS automation_jobs_schedule ON automation_jobs(workspace_id,status,scheduled_for);
  `);
  db.exec(`
    INSERT INTO automation_rules (id,workspace_id,type,name,enabled,delay_minutes,channel,message_template,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),w.id,'appointment_reminder','Appointment reminder',1,1440,'dashboard','Hi {{customer}}, this is a reminder for your {{service}} appointment at {{time}}.',datetime('now'),datetime('now') FROM workspaces w
    WHERE NOT EXISTS (SELECT 1 FROM automation_rules r WHERE r.workspace_id=w.id AND r.type='appointment_reminder');
    INSERT INTO automation_rules (id,workspace_id,type,name,enabled,delay_minutes,channel,message_template,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),w.id,'missed_call','Missed call follow-up',0,5,'dashboard','We noticed your call and will get back to you shortly.',datetime('now'),datetime('now') FROM workspaces w
    WHERE NOT EXISTS (SELECT 1 FROM automation_rules r WHERE r.workspace_id=w.id AND r.type='missed_call');
    INSERT INTO automation_rules (id,workspace_id,type,name,enabled,delay_minutes,channel,message_template,created_at,updated_at)
    SELECT lower(hex(randomblob(16))),w.id,'post_call','Post-call follow-up',0,60,'dashboard','Thank you for speaking with us. Reply if you need any more help.',datetime('now'),datetime('now') FROM workspaces w
    WHERE NOT EXISTS (SELECT 1 FROM automation_rules r WHERE r.workspace_id=w.id AND r.type='post_call');
  `);
}
