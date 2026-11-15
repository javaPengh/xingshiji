import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const credentials = z.object({ username:z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, '用户名需为3–32位小写英文、数字或下划线'), password:z.string().min(10,'密码至少10个字符').max(128) });
const fail = (message,status=400) => Object.assign(new Error(message),{status});

export function createAccounts(directory, { maxUsers=100, dailyAiLimit=50, sessionDays=30 }={}) {
  fs.mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'accounts.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,userId TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(userId TEXT NOT NULL,date TEXT NOT NULL,calls INTEGER NOT NULL,PRIMARY KEY(userId,date));
    CREATE TABLE IF NOT EXISTS ai_reservations(userId TEXT NOT NULL,businessKey TEXT NOT NULL,date TEXT NOT NULL,PRIMARY KEY(userId,businessKey));`);
  const attempts=new Map();
  const publicUser = row => ({ id:row.id,username:row.username });
  async function passwordHash(password,salt) { return (await derive(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex'); }
  function session(user) {
    const token=randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+sessionDays*86400000);
    return { token,user:publicUser(user) };
  }
  function limit(key,maximum,windowMs) {
    const now=Date.now();
    if (attempts.size>10000) for (const [name,item] of attempts) if(item.until<=now) attempts.delete(name);
    let counter=attempts.get(key);
    if (!counter || counter.until<=now) { counter={count:0,until:now+windowMs};attempts.set(key,counter); }
    if (++counter.count>maximum) throw fail('尝试过于频繁，请稍后再试。',429);
  }
  return {
    close:()=>db.close(),
    limit,
    async register(value,ip='local') {
      limit('register:'+ip,5,3600000);
      const body=credentials.parse(value);
      if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n>=maxUsers) throw fail('当前服务的注册名额已满。',403);
      if (db.prepare('SELECT id FROM users WHERE username=?').get(body.username)) throw fail('这个用户名不可用。',409);
      const salt=randomBytes(16).toString('hex');const hash=await passwordHash(body.password,salt);
      // Recheck after asynchronous hashing; simultaneous requests cannot exceed the account cap.
      if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n>=maxUsers) throw fail('当前服务的注册名额已满。',403);
      const user={id:randomUUID(),username:body.username};
      try { db.prepare('INSERT INTO users(id,username,salt,hash,createdAt) VALUES(?,?,?,?,?)').run(user.id,user.username,salt,hash,new Date().toISOString()); }
      catch(error) { if(error.code?.includes('CONSTRAINT')) throw fail('这个用户名不可用。',409);throw error; }
      return session(user);
    },
    async login(value,ip='local') {
      const body=credentials.parse(value);
      limit('login-ip:'+ip,30,600000);limit('login-user:'+body.username,10,600000);
      const user=db.prepare('SELECT * FROM users WHERE username=?').get(body.username);
      const actual=await passwordHash(body.password,user?.salt||'invalid-account-salt');
      const expected=user?.hash||'0'.repeat(128);
      if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')) || !user || user.disabled) throw fail('用户名或密码不正确。',401);
      return session(user);
    },
    authenticate(token) {
      if(!token || token.length>200) return null;
      const row=db.prepare('SELECT u.id,u.username FROM sessions s JOIN users u ON s.userId=u.id WHERE s.hash=? AND s.expires>? AND u.disabled=0').get(digest(token),Date.now());
      return row?publicUser(row):null;
    },
    logout:token=>db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)),
    reserveAi(userId,businessKey=null) {
      const date=new Date().toISOString().slice(0,10);
      if(businessKey!==null&&!/^[a-f0-9]{64}$/.test(businessKey))throw fail('AI任务标识不正确');
      db.exec('BEGIN IMMEDIATE');try{
       if(businessKey&&db.prepare('SELECT 1 FROM ai_reservations WHERE userId=? AND businessKey=?').get(userId,businessKey)){db.exec('COMMIT');return;}
       const used=db.prepare('SELECT calls FROM usage WHERE userId=? AND date=?').get(userId,date)?.calls||0;
       if(used>=dailyAiLimit)throw fail('今天的 AI 请求次数已用完，请明天再试。',429);
       db.prepare('INSERT INTO usage VALUES(?,?,1) ON CONFLICT(userId,date) DO UPDATE SET calls=calls+1').run(userId,date);
       if(businessKey)db.prepare('INSERT INTO ai_reservations VALUES(?,?,?)').run(userId,businessKey,date);
       db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
  };
}
