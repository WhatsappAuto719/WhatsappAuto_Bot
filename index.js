const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// ============================================================
// Gemini AI
// ============================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// ============================================================
// Whapi کنفیگریشن
// ============================================================
const WHAPI_URL = process.env.WHAPI_URL;
const WHAPI_TOKEN = process.env.WHAPI_TOKEN;
const ADMIN_NUMBER = '923076926854';
const SERVICES_FILE = path.join(__dirname, 'services.json');
const PORT = process.env.PORT || 3000;

// ============================================================
// سروسز فائل
// ============================================================
function loadServices() {
  try {
    return JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf-8'));
  } catch {
    return { businessInfo: { contactNumber: '03076926854', businessName: 'Services' }, services: [], nextId: 1 };
  }
}
function saveServices(data) {
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function buildServicesPrompt() {
  const data = loadServices();
  let text = `آپ ایک فری لانسر کا WhatsApp سیلز بوٹ ہیں۔ کسٹمرز کو سروسز کے بارے میں مکمل معلومات دیں۔\n\n=== سروسز ===\n\n`;
  for (const s of data.services) {
    text += `${s.id}. ${s.name}:\n${s.details}\nسیٹ اپ: ${s.setupFee} | ماہانہ: ${s.monthlyFee}\n\n`;
  }
  text += `رابطہ: ${data.businessInfo.contactNumber}\n`;
  text += `ہدایات: اردو میں جواب دیں، مختصر اور دوستانہ رہیں، آخر میں نمبر دیں: ${data.businessInfo.contactNumber}`;
  return text;
}

// ============================================================
// Whapi سے میسج بھیجیں
// ============================================================
async function sendMessage(to, text) {
  const url = `${WHAPI_URL}/messages/text`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WHAPI_TOKEN}`
    },
    body: JSON.stringify({ to, body: text })
  });
  return response.json();
}

// ============================================================
// AI جواب بنائیں
// ============================================================
const conversations = new Map();

async function generateReply(userMessage, from) {
  try {
    if (!conversations.has(from)) conversations.set(from, []);
    const history = conversations.get(from);
    let historyText = history.map(m => `${m.role === 'user' ? 'کسٹمر' : 'بوٹ'}: ${m.content}`).join('\n');
    const prompt = `${buildServicesPrompt()}\n\nگفتگو:\n${historyText}\n\nکسٹمر: ${userMessage}\nبوٹ:`;
    const result = await model.generateContent(prompt);
    const reply = result.response.text();
    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 10) history.splice(0, 2);
    return reply;
  } catch (e) {
    console.error('AI Error:', e);
    return `معذرت، مسئلہ ہوا۔ براہ کرم ${loadServices().businessInfo.contactNumber} پر کال کریں۔`;
  }
}

// ============================================================
// ایڈمن کمانڈز
// ============================================================
function parseFields(lines) {
  const f = {};
  for (const l of lines) {
    const i = l.indexOf(':');
    if (i !== -1) f[l.substring(0, i).trim()] = l.substring(i + 1).trim();
  }
  return f;
}

function handleAdminCommand(text) {
  const data = loadServices();
  const t = text.trim();

  if (t === '/list') {
    if (!data.services.length) return '📋 کوئی سروس نہیں';
    return '📋 *سروسز:*\n\n' + data.services.map(s => `*${s.id}.* ${s.name}\n💰 ${s.setupFee} | ${s.monthlyFee}`).join('\n\n');
  }
  if (t === '/help') {
    return `🤖 *ایڈمن کمانڈز*\n\n/list — سروسز دیکھیں\n/addservice — نئی سروس\n/editservice [نمبر] — ترمیم\n/delete [نمبر] — ہٹائیں\n/setcontact [نمبر] — نمبر بدلیں`;
  }
  if (t.startsWith('/addservice')) {
    const f = parseFields(t.split('\n').slice(1));
    if (!f['نام']) return '⚠️ فارمیٹ:\n/addservice\nنام: ...\nتفصیل: ...\nسیٹ اپ: ...\nماہانہ: ...';
    const s = { id: data.nextId, name: f['نام'], details: f['تفصیل'] || '', setupFee: f['سیٹ اپ'] || '-', monthlyFee: f['ماہانہ'] || '-' };
    data.services.push(s);
    data.nextId++;
    saveServices(data);
    return `✅ سروس شامل: *${s.name}*`;
  }
  if (t.startsWith('/editservice')) {
    const id = parseInt((t.split('\n')[0].match(/\d+/) || [])[0]);
    const s = data.services.find(x => x.id === id);
    if (!s) return `⚠️ سروس ${id} نہیں ملی`;
    const f = parseFields(t.split('\n').slice(1));
    if (f['نام']) s.name = f['نام'];
    if (f['تفصیل']) s.details = f['تفصیل'];
    if (f['سیٹ اپ']) s.setupFee = f['سیٹ اپ'];
    if (f['ماہانہ']) s.monthlyFee = f['ماہانہ'];
    saveServices(data);
    return `✅ سروس ${id} اپڈیٹ ہوگئی`;
  }
  if (t.startsWith('/delete')) {
    const id = parseInt((t.match(/\d+/) || [])[0]);
    const i = data.services.findIndex(x => x.id === id);
    if (i === -1) return `⚠️ سروس ${id} نہیں ملی`;
    const name = data.services.splice(i, 1)[0].name;
    saveServices(data);
    return `🗑️ ہٹا دی: "${name}"`;
  }
  if (t.startsWith('/setcontact')) {
    const num = (t.match(/\/setcontact\s+(\S+)/) || [])[1];
    if (!num) return '⚠️ مثال: /setcontact 03001234567';
    data.businessInfo.contactNumber = num;
    saveServices(data);
    return `✅ نمبر اپڈیٹ: ${num}`;
  }
  return '⚠️ نامعلوم کمانڈ۔ /help لکھیں';
}

// ============================================================
// Webhook Server — Whapi سے میسجز وصول کریں
// ============================================================
const http = require('http');
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const messages = data.messages || [];

        for (const msg of messages) {
          if (msg.from_me) continue;
          if (msg.type !== 'text') continue;

          const text = msg.text?.body;
          const from = msg.from;
          const sender = from.replace('@s.whatsapp.net', '').replace('@g.us', '');

          if (!text) continue;
          console.log(`📩 میسج: ${sender}: ${text}`);

          let reply;
          if (text.trim().startsWith('/') && sender === ADMIN_NUMBER) {
            reply = handleAdminCommand(text);
          } else if (!text.trim().startsWith('/')) {
            reply = await generateReply(text, from);
          }

          if (reply) {
            await sendMessage(from, reply);
            console.log(`✅ جواب بھیجا`);
          }
        }
      } catch (e) {
        console.error('Webhook Error:', e);
      }
      res.writeHead(200);
      res.end('OK');
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>✅ WhatsApp بوٹ چل رہا ہے!</h2>');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 بوٹ چل رہا ہے! Port: ${PORT}`);
  console.log(`📞 نمبر: 03076926854`);
  console.log(`🤖 Whapi + Gemini AI فعال`);
});

process.on('SIGTERM', () => console.log('بوٹ بند نہیں ہوگا...'));
