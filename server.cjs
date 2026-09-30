require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cron = require('node-cron');

const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let latestMatrixState = null;
let lastFiredTimestamp = 0;

// API endpoint receiving matrix updates from React UI
app.post('/api/matrix-update', (req, res) => {
  latestMatrixState = req.body;
  res.status(200).send({ status: 'Matrix state updated' });
});

// Helper to check 100% expansion and CISD requirements
function isTimeframeAligned(tfData, targetDirection) {
  if (!tfData) return false;
  return (
    tfData.expansionPercentage === 100 &&
    tfData.cisdConfirmed === true &&
    tfData.signalDirection === targetDirection
  );
}

// Background Evaluator
async function evaluateConfluence() {
  if (!latestMatrixState) return;

  const { W1, D1, H4, H1 } = latestMatrixState;
  const direction = D1?.signalDirection;

  if (!direction) return;

  const isDailySetup =
    isTimeframeAligned(D1, direction) &&
    isTimeframeAligned(H4, direction) &&
    isTimeframeAligned(H1, direction);

  const isWeeklySetup = isTimeframeAligned(W1, direction) && isDailySetup;

  const now = Date.now();
  const cooldownPeriod = 5 * 60 * 1000;

  if ((isDailySetup || isWeeklySetup) && (now - lastFiredTimestamp > cooldownPeriod)) {
    lastFiredTimestamp = now;
    const modelTitle = isWeeklySetup ? 'WEEKLY + DAILY MACRO ALIGNMENT' : 'DAILY EXPANSION MODEL';
    
    console.log(`[TRIGGER] High-Probability Alignment Detected: ${modelTitle}`);
    await captureAndSendSnapshot(modelTitle, direction);
  }
}

// Native Telegram Dispatcher using Node 24 built-in fetch
async function sendTelegramPhoto(imageBuffer, caption) {
  const formData = new FormData();
  formData.append('chat_id', CHAT_ID);
  formData.append('caption', caption);
  formData.append('parse_mode', 'Markdown');
  formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'snapshot.png');

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API Error: ${result.description}`);
  }
  return result;
}

// Puppeteer Screenshot Engine
async function captureAndSendSnapshot(modelTitle, direction) {
  try {
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(process.env.TERMINAL_URL, { waitUntil: 'networkidle2' });

    const imageBuffer = await page.screenshot({ fullPage: false });
    await browser.close();

    const caption = 
      `🚨 *HIGH-PROBABILITY TDT ALIGNMENT*\n\n` +
      `*Model:* ${modelTitle}\n` +
      `*Direction:* ${direction}\n` +
      `*Status:* 100% Expansion & CISD Confirmed\n` +
      `*Timestamp:* ${new Date().toLocaleTimeString()} SAST`;

    await sendTelegramPhoto(imageBuffer, caption);
    console.log('[SUCCESS] Telegram snapshot dispatched.');
  } catch (error) {
    console.error('[ERROR] Snapshot dispatch failed:', error);
  }
}

cron.schedule('* * * * *', () => {
  evaluateConfluence();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[ACTIVE] TDT Background Engine online on port ${PORT}`);
});
