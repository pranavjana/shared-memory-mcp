import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import type { UserRecord, UserStore } from '../src/users.js';

test('Clerk sync verifies raw signatures, projects only user fields, and retries failed writes', async () => {
  const key = randomBytes(32);
  const records: UserRecord[] = [];
  const deleted: string[] = [];
  let unavailable = false;
  const users: UserStore = {
    async upsert(user) { if (unavailable) throw new Error('database unavailable'); records.push(user); },
    async markDeleted(id) { deleted.push(id); },
    async get() { return undefined; }, async health() {}, async close() {},
  };
  const app = createApp({
    publicUrl: 'https://memory.example.com', secretKey: 'sk_test_example',
    publishableKey: `pk_test_${Buffer.from('test.clerk.accounts.dev$').toString('base64')}`,
    accountPortalUrl: 'https://test.accounts.dev', webhookSigningSecret: `whsec_${key.toString('base64')}`,
  }, {users});
  const http = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => http.once('listening', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/webhooks/clerk`;
  const body = JSON.stringify({type:'user.created',data:{id:'user_test',primary_email_address_id:'primary',email_addresses:[{id:'secondary',email_address:'wrong@example.com'},{id:'primary',email_address:'correct@example.com'}],first_name:'Test',last_name:'User',image_url:'https://example.com/avatar.png',created_at:1000,updated_at:2000,private_metadata:{secret:'never-store'}}});
  const signed = (data: string) => {
    const id = `msg_${randomBytes(12).toString('hex')}`;
    const timestamp = Math.floor(Date.now()/1000).toString();
    const signature = createHmac('sha256',key).update(`${id}.${timestamp}.${data}`).digest('base64');
    return {'Content-Type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`};
  };
  try {
    const invalid = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(invalid.status,400);
    assert.equal(records.length,0);
    const headers = signed(body);
    const tampered = await fetch(url,{method:'POST',headers,body:body.replace('correct@example.com','tampered@example.com')});
    assert.equal(tampered.status,400);
    assert.equal(records.length,0);
    const success = await fetch(url,{method:'POST',headers,body});
    assert.equal(success.status,200);
    assert.equal(records[0].email,'correct@example.com');
    assert.equal('private_metadata' in records[0],false);
    const removed=JSON.stringify({type:'user.deleted',data:{id:'user_test',deleted:true,object:'user'}});
    assert.equal((await fetch(url,{method:'POST',headers:signed(removed),body:removed})).status,200);
    assert.deepEqual(deleted,['user_test']);
    unavailable=true;
    assert.equal((await fetch(url,{method:'POST',headers:signed(body),body})).status,503);
  } finally { await new Promise<void>(resolve => http.close(() => resolve())); }
});
