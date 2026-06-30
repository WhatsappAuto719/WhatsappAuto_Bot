const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// ============================================================
// آپ کا Gemini AI کلائنٹ
// ============================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// ============================================================
// ایڈمن نمبر — صرف یہ نمبر سروسز تبدیل کرسکتا ہے
// ============================================================
const ADMIN_NUMBER = '923076926854'; // 03076926854 کا انٹرنیشنل فارمیٹ (92 کے ساتھ، بغیر + یا 0)

const SERVICES_FILE = path.join(__dirname, 'services.json');

// ============================================================
// سروسز فائل پڑھیں/لکھیں
// ============================================================
function loadServices() {
  try {
    const raw = fs.readFileSync(SERVICES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('سروسز فائل پڑھنے میں مسئلہ:', err);
    return { businessInfo: { contactNumber: '03076926854', businessName: 'Services' }, services: [], nextId: 1 };
  }
}

function saveServices(data) {
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// سروسز کو AI کے لیے ٹیکسٹ میں تبدیل کریں
// ============================================================
function buildServicesPrompt() {
  const data = loadServices();
  let text = `آپ ایک فری لانسر کا WhatsApp سیلز بوٹ ہیں۔ آپ کا کام کسٹمرز کو درج ذیل سروسز کے بارے میں مکمل معلومات دینا ہے۔\n\n=== سروسز اور پیکجز ===\n\n`;

  for (const s of data.services) {
    text += `${s.id}. ${s.name}:\n${s.details}\nسیٹ اپ فیس: ${s.setupFee}\nماہانہ: ${s.monthlyFee}\n\n`;
  }

  text += `رابطہ: ${data.businessInfo.contactNumber}\n\n`;
  text += `=== اہم ہدایات ===\n`;
  text += `- اردو میں بات کریں\n`;
  text += `- دوستانہ اور پیشہ ورانہ لہجہ رکھیں\n`;
  text += `- سوال کے مطابق مناسب پیکج تجویز کریں\n`;
  text += `- آخر میں ہمیشہ رابطہ نمبر دیں: ${data.businessInfo.contactNumber}\n`;
  text += `- اگر کوئی قیمت کم کروانا چاہے تو بتائیں کہ پیکجز پہلے سے بہت مناسب ہیں\n`;
  text += `- زیادہ لمبا جواب نہ دیں، مختصر اور واضح رہیں\n`;

  return text;
}

// ============================================================
// بوٹ کا عام (کسٹمر) جواب جنریٹ کریں
// ============================================================
async function generateReply(userMessage, conversationHistory) {
  try {
    const SERVICES_DATA = buildServicesPrompt();

    let historyText = '';
    for (const msg of conversationHistory) {
      const role = msg.role === 'user' ? 'کسٹمر' : 'بوٹ';
      historyText += `${role}: ${msg.content}\n`;
    }

    const fullPrompt = `${SERVICES_DATA}\n\n=== گفتگو کی تاریخ ===\n${historyText}\n\nکسٹمر کا نیا پیغام: ${userMessage}\n\nبوٹ کا جواب (صرف اردو میں، مختصر اور واضح):`;

    const result = await model.generateContent(fullPrompt);
    return result.response.text();
  } catch (error) {
    console.error('AI Error:', error);
    const data = loadServices();
    return `معذرت، ابھی جواب نہیں دے سکتا۔ براہ کرم ${data.businessInfo.contactNumber} پر کال کریں۔`;
  }
}

// ============================================================
// ایڈمن کمانڈز ہینڈل کریں
// ============================================================
function isAdminCommand(text) {
  return text.trim().startsWith('/');
}

function handleAdminCommand(text) {
  const data = loadServices();
  const trimmed = text.trim();

  // /list — تمام سروسز دکھائیں
  if (trimmed === '/list') {
    if (data.services.length === 0) return '📋 ابھی کوئی سروس موجود نہیں۔';
    let out = '📋 *موجودہ سروسز:*\n\n';
    for (const s of data.services) {
      out += `*${s.id}.* ${s.name}\n💰 سیٹ اپ: ${s.setupFee} | ماہانہ: ${s.monthlyFee}\n\n`;
    }
    return out;
  }

  // /help — کمانڈز کی فہرست
  if (trimmed === '/help' || trimmed === '/menu') {
    return `🤖 *ایڈمن کمانڈز*\n\n` +
      `📋 /list — تمام سروسز دیکھیں\n\n` +
      `➕ نئی سروس ایڈ کرنے کے لیے یہ فارمیٹ بھیجیں:\n` +
      `/addservice\nنام: [سروس کا نام]\nتفصیل: [تفصیل]\nسیٹ اپ: [قیمت]\nماہانہ: [قیمت]\n\n` +
      `❌ /delete [نمبر] — سروس ہٹائیں (مثلاً /delete 3)\n\n` +
      `✏️ سروس ایڈٹ کرنے کے لیے یہ فارمیٹ بھیجیں:\n` +
      `/editservice [نمبر]\nنام: [نیا نام]\nتفصیل: [نئی تفصیل]\nسیٹ اپ: [نئی قیمت]\nماہانہ: [نئی قیمت]\n\n` +
      `📞 /setcontact [نمبر] — رابطہ نمبر بدلیں`;
  }

  // /addservice — نئی سروس شامل کریں
  if (trimmed.startsWith('/addservice')) {
    const lines = trimmed.split('\n').slice(1);
    const fields = parseFields(lines);

    if (!fields['نام']) {
      return '⚠️ غلط فارمیٹ۔ یہ طریقہ استعمال کریں:\n\n/addservice\nنام: سروس کا نام\nتفصیل: تفصیل یہاں\nسیٹ اپ: Rs.5000\nماہانہ: Rs.1000';
    }

    const newService = {
      id: data.nextId,
      name: fields['نام'] || '',
      details: fields['تفصیل'] || '',
      setupFee: fields['سیٹ اپ'] || 'رابطہ کریں',
      monthlyFee: fields['ماہانہ'] || '-',
    };

    data.services.push(newService);
    data.nextId += 1;
    saveServices(data);

    return `✅ نئی سروس شامل ہوگئی!\n\n*${newService.id}. ${newService.name}*\n${newService.details}\n💰 ${newService.setupFee} | ${newService.monthlyFee}`;
  }

  // /editservice [id] — موجودہ سروس میں ترمیم کریں
  if (trimmed.startsWith('/editservice')) {
    const firstLine = trimmed.split('\n')[0];
    const idMatch = firstLine.match(/\/editservice\s+(\d+)/);
    if (!idMatch) {
      return '⚠️ غلط فارمیٹ۔ مثال:\n\n/editservice 2\nنام: نیا نام\nتفصیل: نئی تفصیل\nسیٹ اپ: Rs.5000\nماہانہ: Rs.1000';
    }

    const id = parseInt(idMatch[1]);
    const service = data.services.find(s => s.id === id);
    if (!service) return `⚠️ سروس نمبر ${id} نہیں ملی۔ /list سے چیک کریں۔`;

    const lines = trimmed.split('\n').slice(1);
    const fields = parseFields(lines);

    if (fields['نام']) service.name = fields['نام'];
    if (fields['تفصیل']) service.details = fields['تفصیل'];
    if (fields['سیٹ اپ']) service.setupFee = fields['سیٹ اپ'];
    if (fields['ماہانہ']) service.monthlyFee = fields['ماہانہ'];

    saveServices(data);
    return `✅ سروس نمبر ${id} اپڈیٹ ہوگئی!\n\n*${service.name}*\n${service.details}\n💰 ${service.setupFee} | ${service.monthlyFee}`;
  }

  // /delete [id] — سروس ہٹائیں
  if (trimmed.startsWith('/delete')) {
    const idMatch = trimmed.match(/\/delete\s+(\d+)/);
    if (!idMatch) return '⚠️ غلط فارمیٹ۔ مثال: /delete 3';

    const id = parseInt(idMatch[1]);
    const index = data.services.findIndex(s => s.id === id);
    if (index === -1) return `⚠️ سروس نمبر ${id} نہیں ملی۔`;

    const removed = data.services.splice(index, 1)[0];
    saveServices(data);
    return `🗑️ سروس ہٹا دی گئی: "${removed.name}"`;
  }

  // /setcontact — رابطہ نمبر بدلیں
  if (trimmed.startsWith('/setcontact')) {
    const numMatch = trimmed.match(/\/setcontact\s+(\S+)/);
    if (!numMatch) return '⚠️ غلط فارمیٹ۔ مثال: /setcontact 03001234567';

    data.businessInfo.contactNumber = numMatch[1];
    saveServices(data);
    return `✅ رابطہ نمبر اپڈیٹ ہوگیا: ${numMatch[1]}`;
  }

  return '⚠️ نامعلوم کمانڈ۔ /help لکھیں مدد کے لیے۔';
}

// مدد کرنے والا فنکشن: "نام: کچھ" والی لائنوں کو آبجیکٹ میں بدلیں
function parseFields(lines) {
  const fields = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.substring(0, idx).trim();
    const value = line.substring(idx + 1).trim();
    fields[key] = value;
  }
  return fields;
}

// ============================================================
// گفتگو کی تاریخ (میموری)
// ============================================================
const conversations = new Map();

function getHistory(jid) {
  if (!conversations.has(jid)) conversations.set(jid, []);
  return conversations.get(jid);
}

function addToHistory(jid, role, content) {
  const history = getHistory(jid);
  history.push({ role, content });
  if (history.length > 10) history.splice(0, 2);
}

// ============================================================
// WhatsApp کنیکشن
// ============================================================
async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const qrcode = require('qrcode-terminal');

  const sock = makeWASocket({
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: ['AutoBot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n==============================================');
      console.log('📱 QR کوڈ سکین کریں WhatsApp سے!');
      console.log('WhatsApp > Linked Devices > Link a Device');
      console.log('==============================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n==============================================\n');
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
          : true;
      console.log('کنیکشن بند ہوگیا، دوبارہ کوشش:', shouldReconnect);
      if (shouldReconnect) connectWhatsApp();
    } else if (connection === 'open') {
      const data = loadServices();
      console.log('✅ WhatsApp بوٹ چل رہا ہے!');
      console.log(`📞 نمبر: ${data.businessInfo.contactNumber}`);
      console.log('🤖 AI جوابات فعال ہیں');
      console.log(`👑 ایڈمن نمبر: ${ADMIN_NUMBER}`);
    }
  });

  // ============================================================
  // آنے والے میسجز پر کارروائی
  // ============================================================
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;

    for (const msg of msgs) {
      if (msg.key.fromMe) continue;

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!text) continue;

      const from = msg.key.remoteJid;
      const senderNumber = from.split('@')[0];
      console.log(`\n📩 میسج آیا (${senderNumber}): ${text}`);

      await sock.sendPresenceUpdate('composing', from);

      try {
        let reply;

        // ============================================
        // ایڈمن کمانڈ چیک کریں
        // ============================================
        if (isAdminCommand(text)) {
          if (senderNumber === ADMIN_NUMBER) {
            reply = handleAdminCommand(text);
          } else {
            reply = null; // ایڈمن کے علاوہ کوئی کمانڈ نہیں چلا سکتا
          }
        } else {
          // ============================================
          // عام کسٹمر میسج — AI جواب دے
          // ============================================
          const history = getHistory(from);
          reply = await generateReply(text, history);
          addToHistory(from, 'user', text);
          addToHistory(from, 'assistant', reply);
        }

        if (reply) {
          await sock.sendMessage(from, { text: reply });
          console.log(`✅ جواب بھیجا: ${reply.substring(0, 50)}...`);
        }

      } catch (err) {
        console.error('میسج ایرر:', err);
        const data = loadServices();
        await sock.sendMessage(from, {
          text: `معذرت، کچھ مسئلہ ہوا۔ براہ کرم ${data.businessInfo.contactNumber} پر رابطہ کریں۔`
        });
      }

      await sock.sendPresenceUpdate('paused', from);
    }
  });

  return sock;
}

// ============================================================
// بوٹ شروع کریں
// ============================================================
console.log('🚀 WhatsApp بوٹ شروع ہو رہا ہے...');
connectWhatsApp().catch(console.error);
