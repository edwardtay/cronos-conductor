import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Contract ABIs
const GATEWAY_ABI = [
  "function createPayment(address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash) external payable returns (bytes32)",
  "function executePayment(bytes32 paymentId, bytes proof) external",
  "function cancelPayment(bytes32 paymentId) external",
  "function getPayment(bytes32 paymentId) external view returns (tuple(bytes32 id, address from, address to, address token, uint256 amount, uint256 deadline, bytes32 conditionHash, uint8 status))",
  "function getUserPayments(address user) external view returns (bytes32[])",
  "event PaymentCreated(bytes32 indexed id, address indexed from, address indexed to, address token, uint256 amount, uint256 deadline)",
  "event PaymentExecuted(bytes32 indexed id, address indexed executor)",
];

// Provider
const provider = new ethers.JsonRpcProvider(
  process.env.CRONOS_TESTNET_RPC || "https://evm-t3.cronos.org"
);

// Contract instances (read-only without signer)
const gatewayAddress = process.env.AGENTPAY_GATEWAY_ADDRESS || ethers.ZeroAddress;
const gateway = new ethers.Contract(gatewayAddress, GATEWAY_ABI, provider);

// API Routes

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get network info
app.get("/api/network", async (req, res) => {
  try {
    const [blockNumber, network, feeData] = await Promise.all([
      provider.getBlockNumber(),
      provider.getNetwork(),
      provider.getFeeData(),
    ]);

    res.json({
      chainId: Number(network.chainId),
      blockNumber,
      gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") : "0",
      contracts: {
        gateway: process.env.AGENTPAY_GATEWAY_ADDRESS || "Not deployed",
        settlement: process.env.SETTLEMENT_ENGINE_ADDRESS || "Not deployed",
        escrow: process.env.ESCROW_MANAGER_ADDRESS || "Not deployed",
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get balance
app.get("/api/balance/:address", async (req, res) => {
  try {
    const balance = await provider.getBalance(req.params.address);
    res.json({
      address: req.params.address,
      balance: ethers.formatEther(balance),
      balanceWei: balance.toString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment details
app.get("/api/payment/:paymentId", async (req, res) => {
  try {
    if (gatewayAddress === ethers.ZeroAddress) {
      return res.status(400).json({ error: "Gateway not deployed" });
    }

    const payment = await gateway.getPayment(req.params.paymentId);
    const statusMap = ["Pending", "Executed", "Cancelled", "Refunded"];

    res.json({
      id: payment.id,
      from: payment.from,
      to: payment.to,
      token: payment.token,
      amount: ethers.formatEther(payment.amount),
      deadline: new Date(Number(payment.deadline) * 1000).toISOString(),
      status: statusMap[payment.status] || "Unknown",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get user payments
app.get("/api/payments/:address", async (req, res) => {
  try {
    if (gatewayAddress === ethers.ZeroAddress) {
      return res.status(400).json({ error: "Gateway not deployed" });
    }

    const paymentIds = await gateway.getUserPayments(req.params.address);
    res.json({ address: req.params.address, payments: paymentIds });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Prepare payment transaction (for frontend to sign)
app.post("/api/prepare-payment", (req, res) => {
  try {
    const { to, token, amount, deadlineMinutes, condition } = req.body;

    if (!to || !amount) {
      return res.status(400).json({ error: "Missing required fields: to, amount" });
    }

    const tokenAddress = token || ethers.ZeroAddress;
    const amountWei = ethers.parseEther(amount);
    const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes || 60) * 60;
    const conditionHash = condition
      ? ethers.keccak256(ethers.toUtf8Bytes(condition))
      : ethers.ZeroHash;

    const iface = new ethers.Interface(GATEWAY_ABI);
    const data = iface.encodeFunctionData("createPayment", [
      to,
      tokenAddress,
      amountWei,
      deadline,
      conditionHash,
    ]);

    res.json({
      to: gatewayAddress,
      data,
      value: tokenAddress === ethers.ZeroAddress ? amountWei.toString() : "0",
      details: {
        recipient: to,
        token: tokenAddress,
        amount,
        deadline: new Date(deadline * 1000).toISOString(),
        hasCondition: !!condition,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentPay Protocol - x402 Payment Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/ethers@6.9.0/dist/ethers.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
      min-height: 100vh;
      color: #fff;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      text-align: center;
      padding: 40px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    header h1 {
      font-size: 2.5rem;
      background: linear-gradient(90deg, #00d4ff, #7b2ff7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }
    header p { color: #8b8b8b; font-size: 1.1rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
      margin-top: 30px;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(10px);
    }
    .card h2 {
      font-size: 1.2rem;
      color: #00d4ff;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: #8b8b8b; }
    .stat-value { color: #fff; font-weight: 600; }
    .stat-value.success { color: #00ff88; }
    .stat-value.warning { color: #ffaa00; }
    input, select {
      width: 100%;
      padding: 12px 16px;
      margin-bottom: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #00d4ff;
    }
    input::placeholder { color: #666; }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(90deg, #00d4ff, #7b2ff7);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      margin-top: 10px;
    }
    .wallet-info {
      background: rgba(0,212,255,0.1);
      border: 1px solid rgba(0,212,255,0.3);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .wallet-address {
      font-family: monospace;
      font-size: 12px;
      word-break: break-all;
    }
    .tx-list { max-height: 200px; overflow-y: auto; }
    .tx-item {
      padding: 10px;
      background: rgba(255,255,255,0.02);
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .tx-hash {
      color: #00d4ff;
      font-family: monospace;
      text-decoration: none;
    }
    .tx-hash:hover { text-decoration: underline; }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .status-pending { background: #ffaa00; color: #000; }
    .status-success { background: #00ff88; color: #000; }
    .status-error { background: #ff4444; color: #fff; }
    .alert {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .alert-info { background: rgba(0,212,255,0.2); border: 1px solid #00d4ff; }
    .alert-success { background: rgba(0,255,136,0.2); border: 1px solid #00ff88; }
    .alert-error { background: rgba(255,68,68,0.2); border: 1px solid #ff4444; }
    #notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 16px 24px;
      border-radius: 8px;
      display: none;
      z-index: 1000;
    }
    .tracks {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 15px;
    }
    .track-badge {
      padding: 6px 12px;
      background: rgba(123,47,247,0.3);
      border: 1px solid #7b2ff7;
      border-radius: 20px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>AgentPay Protocol</h1>
      <p>AI-Powered Autonomous Payment Orchestration on Cronos EVM</p>
      <div class="tracks">
        <span class="track-badge">Main Track</span>
        <span class="track-badge">AI Agentic Finance</span>
        <span class="track-badge">Crypto.com Integration</span>
      </div>
    </header>

    <div class="grid">
      <!-- Wallet Connection -->
      <div class="card">
        <h2>🔗 Wallet Connection</h2>
        <div id="wallet-section">
          <button id="connectBtn" onclick="connectWallet()">Connect MetaMask</button>
        </div>
        <div id="wallet-info" class="wallet-info" style="display: none;">
          <div class="stat-row">
            <span class="stat-label">Address</span>
            <span id="walletAddress" class="wallet-address stat-value"></span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Balance</span>
            <span id="walletBalance" class="stat-value success"></span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Network</span>
            <span id="networkName" class="stat-value"></span>
          </div>
        </div>
      </div>

      <!-- Network Status -->
      <div class="card">
        <h2>🌐 Network Status</h2>
        <div class="stat-row">
          <span class="stat-label">Chain ID</span>
          <span id="chainId" class="stat-value">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Block Number</span>
          <span id="blockNumber" class="stat-value">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Gas Price</span>
          <span id="gasPrice" class="stat-value">Loading...</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Gateway Contract</span>
          <span id="gatewayStatus" class="stat-value warning">Checking...</span>
        </div>
      </div>

      <!-- Create Payment -->
      <div class="card">
        <h2>💸 Create Payment</h2>
        <input type="text" id="paymentTo" placeholder="Recipient Address (0x...)" />
        <input type="text" id="paymentAmount" placeholder="Amount in CRO" />
        <input type="number" id="paymentDeadline" placeholder="Deadline (minutes)" value="60" />
        <input type="text" id="paymentCondition" placeholder="Condition (optional)" />
        <button onclick="createPayment()" id="createPaymentBtn" disabled>Create Payment</button>
      </div>

      <!-- Create Escrow -->
      <div class="card">
        <h2>🔒 Create Escrow</h2>
        <input type="text" id="escrowBeneficiary" placeholder="Beneficiary Address (0x...)" />
        <input type="text" id="escrowArbiter" placeholder="Arbiter Address (optional)" />
        <input type="text" id="escrowAmount" placeholder="Amount in CRO" />
        <input type="number" id="escrowReleaseDays" placeholder="Release in days" value="7" />
        <button onclick="createEscrow()" id="createEscrowBtn" disabled>Create Escrow</button>
      </div>

      <!-- Recent Transactions -->
      <div class="card">
        <h2>📋 Recent Transactions</h2>
        <div id="txList" class="tx-list">
          <p style="color: #666; text-align: center; padding: 20px;">No transactions yet</p>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card">
        <h2>⚡ Quick Actions</h2>
        <button onclick="refreshNetwork()">🔄 Refresh Network Status</button>
        <button class="btn-secondary" onclick="window.open('https://cronos.org/faucet', '_blank')">
          🚰 Get Testnet CRO
        </button>
        <button class="btn-secondary" onclick="window.open('https://explorer.cronos.org/testnet', '_blank')">
          🔍 Open Explorer
        </button>
      </div>
    </div>
  </div>

  <div id="notification"></div>

  <script>
    let provider = null;
    let signer = null;
    let userAddress = null;
    const transactions = [];

    // Contract addresses from server
    let contracts = {};

    // Initialize
    async function init() {
      await refreshNetwork();
      setInterval(refreshNetwork, 30000); // Refresh every 30s
    }

    // Connect wallet
    async function connectWallet() {
      if (!window.ethereum) {
        showNotification('Please install MetaMask!', 'error');
        return;
      }

      try {
        provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        // Check network
        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);

        if (chainId !== 338 && chainId !== 25) {
          showNotification('Please switch to Cronos Testnet (Chain ID: 338)', 'error');
          // Try to switch network
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x152' }], // 338 in hex
            });
          } catch (switchError) {
            // Network not added, try to add it
            if (switchError.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: '0x152',
                  chainName: 'Cronos Testnet',
                  nativeCurrency: { name: 'CRO', symbol: 'tCRO', decimals: 18 },
                  rpcUrls: ['https://evm-t3.cronos.org'],
                  blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
                }],
              });
            }
          }
        }

        // Update UI
        document.getElementById('connectBtn').style.display = 'none';
        document.getElementById('wallet-info').style.display = 'block';
        document.getElementById('walletAddress').textContent =
          userAddress.slice(0, 6) + '...' + userAddress.slice(-4);

        // Get balance
        const balance = await provider.getBalance(userAddress);
        document.getElementById('walletBalance').textContent =
          parseFloat(ethers.formatEther(balance)).toFixed(4) + ' CRO';

        document.getElementById('networkName').textContent =
          chainId === 338 ? 'Cronos Testnet' : chainId === 25 ? 'Cronos Mainnet' : 'Unknown';

        // Enable buttons
        document.getElementById('createPaymentBtn').disabled = false;
        document.getElementById('createEscrowBtn').disabled = false;

        showNotification('Wallet connected!', 'success');
      } catch (error) {
        console.error(error);
        showNotification('Failed to connect wallet: ' + error.message, 'error');
      }
    }

    // Refresh network status
    async function refreshNetwork() {
      try {
        const response = await fetch('/api/network');
        const data = await response.json();

        document.getElementById('chainId').textContent = data.chainId;
        document.getElementById('blockNumber').textContent = data.blockNumber.toLocaleString();
        document.getElementById('gasPrice').textContent = data.gasPrice + ' Gwei';

        contracts = data.contracts;

        if (data.contracts.gateway !== 'Not deployed') {
          document.getElementById('gatewayStatus').textContent = 'Deployed ✓';
          document.getElementById('gatewayStatus').className = 'stat-value success';
        } else {
          document.getElementById('gatewayStatus').textContent = 'Not Deployed';
          document.getElementById('gatewayStatus').className = 'stat-value warning';
        }
      } catch (error) {
        console.error('Failed to refresh network:', error);
      }
    }

    // Create payment
    async function createPayment() {
      if (!signer) {
        showNotification('Please connect wallet first', 'error');
        return;
      }

      const to = document.getElementById('paymentTo').value;
      const amount = document.getElementById('paymentAmount').value;
      const deadline = document.getElementById('paymentDeadline').value;
      const condition = document.getElementById('paymentCondition').value;

      if (!to || !amount) {
        showNotification('Please fill in recipient and amount', 'error');
        return;
      }

      try {
        showNotification('Preparing transaction...', 'info');

        // Get prepared transaction from server
        const response = await fetch('/api/prepare-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, amount, deadlineMinutes: parseInt(deadline), condition }),
        });

        const txData = await response.json();

        if (txData.error) {
          throw new Error(txData.error);
        }

        showNotification('Please confirm in MetaMask...', 'info');

        // Send transaction
        const tx = await signer.sendTransaction({
          to: txData.to,
          data: txData.data,
          value: txData.value,
        });

        addTransaction({
          hash: tx.hash,
          type: 'Create Payment',
          status: 'pending',
          amount: amount + ' CRO',
        });

        showNotification('Transaction submitted! Waiting for confirmation...', 'info');

        const receipt = await tx.wait();

        updateTransactionStatus(tx.hash, receipt.status === 1 ? 'success' : 'error');
        showNotification('Payment created successfully!', 'success');

        // Clear form
        document.getElementById('paymentTo').value = '';
        document.getElementById('paymentAmount').value = '';
        document.getElementById('paymentCondition').value = '';
      } catch (error) {
        console.error(error);
        showNotification('Failed: ' + error.message, 'error');
      }
    }

    // Create escrow
    async function createEscrow() {
      if (!signer) {
        showNotification('Please connect wallet first', 'error');
        return;
      }

      const beneficiary = document.getElementById('escrowBeneficiary').value;
      const amount = document.getElementById('escrowAmount').value;

      if (!beneficiary || !amount) {
        showNotification('Please fill in beneficiary and amount', 'error');
        return;
      }

      showNotification('Escrow creation coming soon!', 'info');
    }

    // Transaction management
    function addTransaction(tx) {
      transactions.unshift(tx);
      renderTransactions();
    }

    function updateTransactionStatus(hash, status) {
      const tx = transactions.find(t => t.hash === hash);
      if (tx) {
        tx.status = status;
        renderTransactions();
      }
    }

    function renderTransactions() {
      const container = document.getElementById('txList');
      if (transactions.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No transactions yet</p>';
        return;
      }

      container.innerHTML = transactions.map(tx => \`
        <div class="tx-item">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>\${tx.type}</span>
            <span class="status-badge status-\${tx.status}">\${tx.status.toUpperCase()}</span>
          </div>
          <div style="margin-top: 8px;">
            <a href="https://explorer.cronos.org/testnet/tx/\${tx.hash}" target="_blank" class="tx-hash">
              \${tx.hash.slice(0, 10)}...\${tx.hash.slice(-8)}
            </a>
            <span style="float: right; color: #00ff88;">\${tx.amount}</span>
          </div>
        </div>
      \`).join('');
    }

    // Notification
    function showNotification(message, type) {
      const el = document.getElementById('notification');
      el.textContent = message;
      el.className = 'alert alert-' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    // Listen for account/network changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', () => location.reload());
      window.ethereum.on('chainChanged', () => location.reload());
    }

    // Initialize
    init();
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    AgentPay Protocol                         ║");
  console.log("║          AI-Powered Payment Orchestration on Cronos          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`🚀 Server running at: http://localhost:${PORT}`);
  console.log("");
  console.log("📋 API Endpoints:");
  console.log(`   GET  /api/health           - Health check`);
  console.log(`   GET  /api/network          - Network info`);
  console.log(`   GET  /api/balance/:address - Get balance`);
  console.log(`   GET  /api/payment/:id      - Get payment details`);
  console.log(`   POST /api/prepare-payment  - Prepare payment tx`);
  console.log("");
  console.log("📝 Contract Status:");
  console.log(`   Gateway:    ${process.env.AGENTPAY_GATEWAY_ADDRESS || "Not deployed"}`);
  console.log(`   Settlement: ${process.env.SETTLEMENT_ENGINE_ADDRESS || "Not deployed"}`);
  console.log(`   Escrow:     ${process.env.ESCROW_MANAGER_ADDRESS || "Not deployed"}`);
  console.log("");
  console.log("💡 Deploy contracts: npm run deploy:testnet");
  console.log("");
});
