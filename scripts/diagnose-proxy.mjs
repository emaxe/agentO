#!/usr/bin/env node
/**
 * Diagnostic script: tests HttpsProxyAgent → external proxy → api.openai.com.
 * Set API_KEY and PROXY_URL before running, then:
 *   node scripts/diagnose-proxy.mjs
 */

import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const API_KEY  = process.env.OPENAI_API_KEY ?? 'YOUR_API_KEY_HERE';
const PROXY_URL = 'http://185.18.52.90:6100/';
const MODEL    = 'gpt-5.4';

const agent = new HttpsProxyAgent(PROXY_URL);

const body = JSON.stringify({
  model: MODEL,
  messages: [{ role: 'user', content: 'say hello in one word' }],
  max_completion_tokens: 20,
  stream: false,
});

const req = https.request('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  agent,
  headers: {
    'authorization': `Bearer ${API_KEY}`,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  },
}, (res) => {
  console.log('STATUS:', res.statusCode);
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => console.log('BODY:', Buffer.concat(chunks).toString('utf-8')));
});

req.on('error', (e) => console.error('ERROR:', e.message));
req.write(body);
req.end();
