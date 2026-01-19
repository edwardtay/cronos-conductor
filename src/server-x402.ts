/**
 * x402 API Gateway
 * Pay-per-call API services for AI agents
 * No API keys, no subscriptions - just micropayments
 */

import express from "express";
import cors from "cors";
import axios from "axios";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Cronos Testnet
const provider = new ethers.JsonRpcProvider(
  process.env.CRONOS_TESTNET_RPC || "https://evm-t3.cronos.org"
);

// Payment receiver address
const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS || "0x3D101003b1f7E1dFe6f4ee7d1b587f656c3a651F";

// Track paid requests (in production: use Redis/DB with TTL)
const paidRequests: Map<string, { paidAt: number; txHash: string }> = new Map();

// ============ SERVICE PRICING (in CRO) ============
const SERVICES = {
  translate: { price: "0.001", name: "Translation", unit: "per request" },
  weather: { price: "0.002", name: "Weather Data", unit: "per query" },
  price: { price: "0.0005", name: "Crypto Price", unit: "per ticker" },
  summarize: { price: "0.005", name: "Text Summary", unit: "per 1000 chars" },
  sentiment: { price: "0.003", name: "Sentiment Analysis", unit: "per text" },
};

// ============ x402 MIDDLEWARE ============
function x402Paywall(service: keyof typeof SERVICES) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const paymentProof = req.headers["x-payment"] as string;
    const requestId = req.headers["x-request-id"] as string || `${service}-${Date.now()}`;

    // Check if already paid
    if (paymentProof) {
      const paid = paidRequests.get(paymentProof);
      if (paid) {
        (req as any).paymentVerified = true;
        return next();
      }

      // Verify on-chain
      try {
        const receipt = await provider.getTransactionReceipt(paymentProof);
        if (receipt && receipt.status === 1) {
          paidRequests.set(paymentProof, { paidAt: Date.now(), txHash: paymentProof });
          (req as any).paymentVerified = true;
          return next();
        }
      } catch (e) {
        // Invalid tx hash
      }
    }

    // Return 402 Payment Required
    const pricing = SERVICES[service];
    const amountWei = ethers.parseEther(pricing.price);

    res.status(402);
    res.setHeader("X-Payment", "required");
    res.setHeader("X-Payment-Address", PAYMENT_ADDRESS);
    res.setHeader("X-Payment-Amount", amountWei.toString());
    res.setHeader("X-Payment-Currency", "CRO");
    res.setHeader("X-Payment-Network", "cronos-testnet");
    res.setHeader("X-Payment-ChainId", "338");

    res.json({
      error: "Payment Required",
      status: 402,
      service: pricing.name,
      price: `${pricing.price} CRO ${pricing.unit}`,
      payment: {
        address: PAYMENT_ADDRESS,
        amount: pricing.price,
        currency: "CRO",
        network: "cronos-testnet",
        chainId: 338,
      },
      instructions: "Send payment, then retry with header: X-Payment: <txHash>",
    });
  };
}

// ============ PAID API SERVICES ============

// Translation Service
app.get("/api/translate", x402Paywall("translate"), async (req, res) => {
  const { text, to = "es" } = req.query;

  if (!text) {
    return res.status(400).json({ error: "Missing 'text' parameter" });
  }

  // Simple translation mapping (in production: use real API)
  const translations: Record<string, Record<string, string>> = {
    en: {
      hello: "hello", world: "world", "good morning": "good morning",
      "how are you": "how are you", thanks: "thanks", goodbye: "goodbye",
    },
    es: {
      hello: "hola", world: "mundo", "good morning": "buenos días",
      "how are you": "¿cómo estás?", thanks: "gracias", goodbye: "adiós",
    },
    fr: {
      hello: "bonjour", world: "monde", "good morning": "bonjour",
      "how are you": "comment allez-vous?", thanks: "merci", goodbye: "au revoir",
    },
    de: {
      hello: "hallo", world: "welt", "good morning": "guten morgen",
      "how are you": "wie geht es dir?", thanks: "danke", goodbye: "auf wiedersehen",
    },
    ja: {
      hello: "こんにちは", world: "世界", "good morning": "おはよう",
      "how are you": "お元気ですか", thanks: "ありがとう", goodbye: "さようなら",
    },
    zh: {
      hello: "你好", world: "世界", "good morning": "早上好",
      "how are you": "你好吗", thanks: "谢谢", goodbye: "再见",
    },
  };

  const inputText = (text as string).toLowerCase().trim();
  const targetLang = to as string;
  const translated = translations[targetLang]?.[inputText] || `[${targetLang}] ${text}`;

  res.json({
    success: true,
    original: text,
    translated,
    language: targetLang,
    cost: "0.001 CRO",
  });
});

// Weather Service
app.get("/api/weather", x402Paywall("weather"), async (req, res) => {
  const { city = "Singapore" } = req.query;

  // Simulated weather data (in production: use OpenWeatherMap)
  const weatherData: Record<string, any> = {
    singapore: { temp: 31, condition: "Partly Cloudy", humidity: 75 },
    tokyo: { temp: 18, condition: "Clear", humidity: 45 },
    london: { temp: 12, condition: "Rainy", humidity: 85 },
    "new york": { temp: 8, condition: "Cloudy", humidity: 60 },
    dubai: { temp: 28, condition: "Sunny", humidity: 40 },
    sydney: { temp: 24, condition: "Sunny", humidity: 55 },
  };

  const cityLower = (city as string).toLowerCase();
  const weather = weatherData[cityLower] || { temp: 20, condition: "Unknown", humidity: 50 };

  res.json({
    success: true,
    city: city,
    temperature: weather.temp,
    unit: "celsius",
    condition: weather.condition,
    humidity: weather.humidity,
    cost: "0.002 CRO",
  });
});

// Crypto Price Service (Real data from Crypto.com)
app.get("/api/price", x402Paywall("price"), async (req, res) => {
  const { symbol = "CRO_USD" } = req.query;

  try {
    const response = await axios.get("https://api.crypto.com/exchange/v1/public/get-tickers", {
      timeout: 5000,
    });

    const ticker = response.data?.result?.data?.find((t: any) => t.i === symbol);

    if (ticker) {
      res.json({
        success: true,
        symbol: ticker.i,
        price: parseFloat(ticker.a),
        change24h: (parseFloat(ticker.c) * 100).toFixed(2) + "%",
        high24h: parseFloat(ticker.h),
        low24h: parseFloat(ticker.l),
        volume24h: parseFloat(ticker.vv),
        timestamp: new Date().toISOString(),
        cost: "0.0005 CRO",
      });
    } else {
      res.json({
        success: false,
        error: "Symbol not found",
        availableSymbols: ["CRO_USD", "BTC_USD", "ETH_USD", "CRO_USDT"],
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Text Summarization Service
app.post("/api/summarize", x402Paywall("summarize"), async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing 'text' in body" });
  }

  // Simple extractive summary (in production: use LLM)
  const sentences = text.split(/[.!?]+/).filter((s: string) => s.trim().length > 10);
  const summary = sentences.slice(0, Math.min(3, sentences.length)).join(". ") + ".";

  res.json({
    success: true,
    original_length: text.length,
    summary,
    summary_length: summary.length,
    reduction: Math.round((1 - summary.length / text.length) * 100) + "%",
    cost: "0.005 CRO",
  });
});

// Sentiment Analysis Service
app.post("/api/sentiment", x402Paywall("sentiment"), async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing 'text' in body" });
  }

  // Simple keyword-based sentiment (in production: use ML model)
  const positive = ["good", "great", "excellent", "amazing", "love", "happy", "best", "wonderful", "fantastic", "bullish"];
  const negative = ["bad", "terrible", "awful", "hate", "worst", "sad", "poor", "horrible", "bearish", "crash"];

  const words = text.toLowerCase().split(/\W+/);
  const posCount = words.filter((w: string) => positive.includes(w)).length;
  const negCount = words.filter((w: string) => negative.includes(w)).length;

  let sentiment = "neutral";
  let score = 0;

  if (posCount > negCount) {
    sentiment = "positive";
    score = Math.min(posCount / words.length * 10, 1);
  } else if (negCount > posCount) {
    sentiment = "negative";
    score = -Math.min(negCount / words.length * 10, 1);
  }

  res.json({
    success: true,
    text: text.slice(0, 100) + (text.length > 100 ? "..." : ""),
    sentiment,
    score: score.toFixed(2),
    confidence: Math.abs(score) > 0.3 ? "high" : "medium",
    cost: "0.003 CRO",
  });
});

// ============ FREE ENDPOINTS ============

// Service catalog
app.get("/api/services", (req, res) => {
  res.json({
    name: "x402 API Gateway",
    description: "Pay-per-call API services. No API keys, no subscriptions.",
    network: "Cronos Testnet",
    paymentAddress: PAYMENT_ADDRESS,
    services: Object.entries(SERVICES).map(([id, svc]) => ({
      id,
      name: svc.name,
      price: `${svc.price} CRO`,
      unit: svc.unit,
      endpoint: `/api/${id}`,
    })),
    usage: {
      step1: "Call any endpoint",
      step2: "Receive 402 with payment details",
      step3: "Send CRO to payment address",
      step4: "Retry with header: X-Payment: <txHash>",
    },
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============ DASHBOARD UI ============
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>x402 API Gateway</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/ethers@6.9.0/dist/ethers.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0a;
      --card: #141414;
      --border: #262626;
      --text: #fafafa;
      --muted: #a3a3a3;
      --accent: #3b82f6;
      --success: #22c55e;
      --warning: #f59e0b;
      --error: #ef4444;
    }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    h1 { font-size: 24px; font-weight: 600; }
    h1 span { color: var(--warning); }
    .subtitle { color: var(--muted); font-size: 14px; margin-top: 4px; }
    .wallet-btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      font-family: inherit;
    }
    .wallet-btn:hover { opacity: 0.9; }
    .wallet-btn.connected { background: var(--success); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .card-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .price-tag {
      background: var(--warning);
      color: black;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .service-list { display: flex; flex-direction: column; gap: 12px; }
    .service-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: var(--bg);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .service-item:hover { background: #1a1a1a; }
    .service-item.selected { border: 1px solid var(--accent); }
    .service-name { font-weight: 500; }
    .service-price { color: var(--warning); font-size: 13px; }
    .input-group { margin-bottom: 16px; }
    .input-group label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .input-group input, .input-group select, .input-group textarea {
      width: 100%;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
    }
    .input-group textarea { min-height: 80px; resize: vertical; }
    .btn {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      margin-bottom: 12px;
    }
    .btn-primary { background: var(--accent); color: white; }
    .btn-warning { background: var(--warning); color: black; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .response-box {
      background: var(--bg);
      border-radius: 8px;
      padding: 16px;
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
      overflow: auto;
    }
    .status-402 { color: var(--warning); }
    .status-200 { color: var(--success); }
    .flow-step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }
    .step-num {
      width: 24px;
      height: 24px;
      background: var(--accent);
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }
    .step-num.warning { background: var(--warning); color: black; }
    .step-num.success { background: var(--success); }
    code {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }
    footer {
      text-align: center;
      padding: 24px;
      color: var(--muted);
      font-size: 12px;
      margin-top: 32px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>x<span>402</span> API Gateway</h1>
        <div class="subtitle">Pay-per-call APIs. No keys. No subscriptions. Just micropayments.</div>
      </div>
      <button class="wallet-btn" id="walletBtn" onclick="connectWallet()">Connect Wallet</button>
    </header>

    <div class="grid">
      <!-- Services -->
      <div class="card">
        <div class="card-title">Available Services</div>
        <div class="service-list" id="serviceList">
          <div class="service-item selected" data-service="translate" data-type="get">
            <div>
              <div class="service-name">Translation</div>
              <div style="font-size:12px;color:var(--muted);">GET /api/translate?text=hello&to=es</div>
            </div>
            <div class="service-price">0.001 CRO</div>
          </div>
          <div class="service-item" data-service="weather" data-type="get">
            <div>
              <div class="service-name">Weather Data</div>
              <div style="font-size:12px;color:var(--muted);">GET /api/weather?city=Tokyo</div>
            </div>
            <div class="service-price">0.002 CRO</div>
          </div>
          <div class="service-item" data-service="price" data-type="get">
            <div>
              <div class="service-name">Crypto Price</div>
              <div style="font-size:12px;color:var(--muted);">GET /api/price?symbol=BTC_USD</div>
            </div>
            <div class="service-price">0.0005 CRO</div>
          </div>
          <div class="service-item" data-service="sentiment" data-type="post">
            <div>
              <div class="service-name">Sentiment Analysis</div>
              <div style="font-size:12px;color:var(--muted);">POST /api/sentiment {text}</div>
            </div>
            <div class="service-price">0.003 CRO</div>
          </div>
          <div class="service-item" data-service="summarize" data-type="post">
            <div>
              <div class="service-name">Text Summary</div>
              <div style="font-size:12px;color:var(--muted);">POST /api/summarize {text}</div>
            </div>
            <div class="service-price">0.005 CRO</div>
          </div>
        </div>
      </div>

      <!-- Try It -->
      <div class="card">
        <div class="card-title">
          <span>Try It</span>
          <span class="price-tag" id="currentPrice">0.001 CRO</span>
        </div>

        <div id="inputArea">
          <div class="input-group" id="getParams">
            <label>Query Parameters</label>
            <input type="text" id="queryParams" placeholder="text=hello&to=es" />
          </div>
          <div class="input-group" id="postBody" style="display:none;">
            <label>Request Body (JSON)</label>
            <textarea id="requestBody" placeholder='{"text": "Your text here..."}'></textarea>
          </div>
        </div>

        <button class="btn btn-primary" onclick="makeRequest()">1. Request (GET 402)</button>
        <button class="btn btn-warning" id="payBtn" onclick="payAndRetry()" disabled>2. Pay & Retry</button>

        <div id="statusText" style="font-size:13px;margin-bottom:12px;color:var(--muted);"></div>

        <div class="response-box" id="response">Click "Request" to start...</div>
      </div>
    </div>

    <!-- How It Works -->
    <div class="card" style="margin-top:24px;">
      <div class="card-title">How x402 Works</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;">
        <div class="flow-step" style="flex-direction:column;text-align:center;">
          <div class="step-num">1</div>
          <div style="font-size:13px;margin-top:8px;"><strong>Request</strong><br/><span style="color:var(--muted);font-size:11px;">Call any endpoint</span></div>
        </div>
        <div class="flow-step" style="flex-direction:column;text-align:center;">
          <div class="step-num warning">2</div>
          <div style="font-size:13px;margin-top:8px;"><strong>402 Response</strong><br/><span style="color:var(--muted);font-size:11px;">Get payment details</span></div>
        </div>
        <div class="flow-step" style="flex-direction:column;text-align:center;">
          <div class="step-num">3</div>
          <div style="font-size:13px;margin-top:8px;"><strong>Pay On-Chain</strong><br/><span style="color:var(--muted);font-size:11px;">Send CRO</span></div>
        </div>
        <div class="flow-step" style="flex-direction:column;text-align:center;">
          <div class="step-num">4</div>
          <div style="font-size:13px;margin-top:8px;"><strong>Retry + Proof</strong><br/><span style="color:var(--muted);font-size:11px;">X-Payment: txHash</span></div>
        </div>
        <div class="flow-step" style="flex-direction:column;text-align:center;">
          <div class="step-num success">5</div>
          <div style="font-size:13px;margin-top:8px;"><strong>200 OK</strong><br/><span style="color:var(--muted);font-size:11px;">Get response</span></div>
        </div>
      </div>
    </div>

    <footer>
      x402 API Gateway on Cronos Testnet. Micropayments for AI agents.
    </footer>
  </div>

  <script>
    let provider = null;
    let signer = null;
    let currentService = 'translate';
    let currentType = 'get';
    let lastPaymentData = null;

    // Select service
    document.querySelectorAll('.service-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.service-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        currentService = item.dataset.service;
        currentType = item.dataset.type;

        // Update price
        const prices = { translate: '0.001', weather: '0.002', price: '0.0005', sentiment: '0.003', summarize: '0.005' };
        document.getElementById('currentPrice').textContent = prices[currentService] + ' CRO';

        // Show/hide input areas
        document.getElementById('getParams').style.display = currentType === 'get' ? 'block' : 'none';
        document.getElementById('postBody').style.display = currentType === 'post' ? 'block' : 'none';

        // Set default params
        const defaults = {
          translate: 'text=hello&to=es',
          weather: 'city=Tokyo',
          price: 'symbol=BTC_USD',
          sentiment: '',
          summarize: '',
        };
        document.getElementById('queryParams').value = defaults[currentService] || '';
      });
    });

    async function connectWallet() {
      if (!window.ethereum) return alert('Install MetaMask');

      try {
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        const addr = await signer.getAddress();

        document.getElementById('walletBtn').textContent = addr.slice(0, 6) + '...' + addr.slice(-4);
        document.getElementById('walletBtn').classList.add('connected');

        // Switch to Cronos Testnet
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x152' }],
          });
        } catch (e) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x152',
              chainName: 'Cronos Testnet',
              nativeCurrency: { name: 'CRO', symbol: 'CRO', decimals: 18 },
              rpcUrls: ['https://evm-t3.cronos.org'],
              blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
            }],
          });
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function makeRequest() {
      const responseEl = document.getElementById('response');
      const statusEl = document.getElementById('statusText');
      const payBtn = document.getElementById('payBtn');

      let url = '/api/' + currentService;
      let options = { method: 'GET' };

      if (currentType === 'get') {
        const params = document.getElementById('queryParams').value;
        if (params) url += '?' + params;
      } else {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/json' };
        const body = document.getElementById('requestBody').value || '{"text": "This is a test"}';
        options.body = body;
      }

      statusEl.textContent = 'Requesting...';

      try {
        const res = await fetch(url, options);
        const data = await res.json();

        if (res.status === 402) {
          responseEl.innerHTML = '<span class="status-402">HTTP 402 Payment Required</span>\\n\\n' + JSON.stringify(data, null, 2);
          statusEl.innerHTML = '<span style="color:var(--warning);">Payment required.</span> Click "Pay & Retry" to continue.';
          payBtn.disabled = false;
          lastPaymentData = { url, options, payment: data.payment };
        } else {
          responseEl.innerHTML = '<span class="status-200">HTTP 200 OK</span>\\n\\n' + JSON.stringify(data, null, 2);
          statusEl.innerHTML = '<span style="color:var(--success);">Success!</span>';
          payBtn.disabled = true;
        }
      } catch (e) {
        responseEl.textContent = 'Error: ' + e.message;
        statusEl.textContent = 'Request failed';
      }
    }

    async function payAndRetry() {
      if (!signer) return alert('Connect wallet first');
      if (!lastPaymentData) return alert('Make a request first');

      const responseEl = document.getElementById('response');
      const statusEl = document.getElementById('statusText');
      const payBtn = document.getElementById('payBtn');

      try {
        payBtn.disabled = true;
        statusEl.textContent = 'Sending payment...';

        const tx = await signer.sendTransaction({
          to: lastPaymentData.payment.address,
          value: ethers.parseEther(lastPaymentData.payment.amount),
        });

        statusEl.textContent = 'Waiting for confirmation...';
        await tx.wait();

        statusEl.textContent = 'Retrying with payment proof...';

        // Retry with payment header
        const options = { ...lastPaymentData.options };
        options.headers = { ...options.headers, 'X-Payment': tx.hash };

        const res = await fetch(lastPaymentData.url, options);
        const data = await res.json();

        responseEl.innerHTML = '<span class="status-200">HTTP 200 OK</span>\\n\\n' + JSON.stringify(data, null, 2);
        statusEl.innerHTML = '<span style="color:var(--success);">Paid & accessed!</span> <a href="https://explorer.cronos.org/testnet/tx/' + tx.hash + '" target="_blank" style="color:var(--accent);">View tx</a>';

      } catch (e) {
        statusEl.textContent = 'Failed: ' + e.message;
        payBtn.disabled = false;
      }
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║           x402 API Gateway                        ║");
  console.log("║     Pay-per-call APIs on Cronos                   ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log("");
  console.log("Dashboard: http://localhost:" + PORT);
  console.log("");
  console.log("Services:");
  Object.entries(SERVICES).forEach(([id, svc]) => {
    console.log("  /api/" + id.padEnd(12) + svc.price + " CRO " + svc.unit);
  });
  console.log("");
  console.log("Payment Address: " + PAYMENT_ADDRESS);
  console.log("");
});
