const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('http');
const qrcode = require('qrcode');

// ============================================================
// Gemini AI
// ============================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const ADMIN_NUMBER = '923076926854';
const SERVICES_FILE = path.join(__dirname, 'services.json');

// QR کوڈ محفوظ کریں
let currentQR = null;

// ============================================================
// ویب سرور — QR کوڈ دکھانے کے لیے
// ============================================================
const PORT = process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
  if (req.url === '/qr' || req.url === '/') {
    if (!currentQR) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:50px">
        <h2>✅ WhatsApp بوٹ پہلے سے کنیکٹ ہے!</h2>
        <p>یا QR کوڈ ابھی لوڈ ہو رہا ہے — 10 سیکنڈ بعد Refresh کریں</p>
        <script>setTimeout(()=>location.reload(),10000)</script>
        </body></html>
      `);
    } else {
      try {
        const qrImage = await qrcode.toDataURL(currentQR);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:30px">
          <h2>📱 WhatsApp QR کوڈ سکین کریں</h2>
          <img src="${qrImage}" style="width:300px;height:300px;border:10px solid white;border-radius:10px"/>
          <p>WhatsApp ➡ Linked Devices ➡ Link a Device</p>
          <p style="color:yellow">⚠️ یہ کوڈ 60 سیکنڈ میں بدل جاتا ہے — جلدی سکین کریں!</p>
          <script>setTimeout(()=>location.reload(),30000)</script>
          </body></html>
        `);
      } catch (e) {
        res.writeHead(500);
        res.end('QR Error: ' + e.message);
      }
    }
  } else {
    res.writeHead(200);
    res.end('WhatsApp Bot Running ✅');
  }
});
server.listen(PORT, () => console.log(`🌐 ویب سرور چل رہا ہے: Port ${PORT}`));

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
  text += `ہدایات: اردو میں، مختصر، دوستانہ، آخر میں نمبر دیں: ${data.businessInfo.contactNumber}`;
  return text;
}

async function generateReply(userMessage, history) {
  try {
    let historyText = history.map(m => `${m.role === 'user' ? 'کسٹمر' : 'بوٹ'}: ${m.content}`).join('\n');
    const prompt = `${buildServicesPrompt()}\n\nگفتگو:\n${historyText}\n\nکسٹمر: ${userMessage}\nبوٹ:`;
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e) {
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
// گفتگو کی تاریخ
// ============================================================
const conversations = new Map();
function getHistory(jid) {
  if (!conversations.has(jid)) conversations.set(jid, []);
  return conversations.get(jid);
}
function addToHistory(jid, role, content) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > 10) h.splice(0, 2);
}

// ============================================================
// WhatsApp کنیکشن
// ============================================================
async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: ['AutoBot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      console.log('📱 QR کوڈ تیار ہے — /qr صفحہ کھولیں');
    }

    if (connection === 'close') {
      currentQR = null;
      const retry = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;
      if (retry) connectWhatsApp();
    } else if (connection === 'open') {
      currentQR = null;
      console.log('✅ WhatsApp بوٹ کنیکٹ ہوگیا!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;
    for (const msg of msgs) {
      if (msg.key.fromMe) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!text) continue;
      const from = msg.key.remoteJid;
      const sender = from.split('@')[0];

      await sock.sendPresenceUpdate('composing', from);
      try {
        let reply;
        if (text.trim().startsWith('/') && sender === ADMIN_NUMBER) {
          reply = handleAdminCommand(text);
        } else if (!text.trim().startsWith('/')) {
          const history = getHistory(from);
          reply = await generateReply(text, history);
          addToHistory(from, 'user', text);
          addToHistory(from, 'assistant', reply);
        }
        if (reply) await sock.sendMessage(from, { text: reply });
      } catch (e) {
        console.error('Error:', e);
      }
      await sock.sendPresenceUpdate('paused', from);
    }
  });
}

console.log('🚀 بوٹ شروع ہو رہا ہے...');
connectWhatsApp().catch(console.error);

// Railway کو stable رکھنے کے لیے
process.on('SIGTERM', () => {
  console.log('SIGTERM موصول، بوٹ بند نہیں ہوگا...');
});
process.on('SIGINT', () => {
  console.log('SIGINT موصول');
});
