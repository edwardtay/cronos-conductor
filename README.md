# Cronos Conductor

**AI Agent Orchestration with x402 Payment Protocol on Cronos EVM**

[![Live Demo](https://img.shields.io/badge/Live-Demo-22c55e)](https://cronos-conductor.vercel.app)
[![Cronos](https://img.shields.io/badge/Cronos-EVM-002D74)](https://cronos.org)
[![x402](https://img.shields.io/badge/x402-Protocol-f59e0b)](https://www.x402.org)
[![A2A](https://img.shields.io/badge/A2A-Protocol-8b5cf6)](https://google.github.io/A2A)
[![MCP](https://img.shields.io/badge/MCP-Server-22c55e)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

## Live Deployment

| Component | URL |
|-----------|-----|
| **Frontend** | https://cronos-conductor.vercel.app |
| **Backend API** | https://cronos-conductor-660587902574.asia-southeast1.run.app |
| **Network** | Cronos Testnet (338) + Mainnet (25) for swaps |

## Overview

Cronos Conductor is an AI agent orchestration system that uses the **x402 HTTP Payment Protocol** to enable machine-to-machine payments. A central **Conductor Agent** uses Groq AI for intent detection and coordinates multiple specialized sub-agents via the **A2A (Agent-to-Agent) Protocol**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CRONOS CONDUCTOR                                   │
│                                                                             │
│    User Query ──► Conductor Agent ──► A2A Discovery ──► Sub-Agents          │
│                        │                                    │               │
│                   Groq AI                           x402 Payment            │
│               (Intent Detection)               (Pay-per-query)              │
│                                                                             │
│    "Should I buy CRO?" ──► [Sentiment] + [Risk] + [Arbitrage] ──► Answer    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Architecture

```
                              Cronos Conductor Architecture

    ┌──────────────┐                                    ┌──────────────────────┐
    │    User      │                                    │   External AI        │
    │  (Browser)   │                                    │  (Claude, GPT, etc)  │
    └──────┬───────┘                                    └──────────┬───────────┘
           │                                                       │
           │ Natural Language Query                    MCP Protocol│
           ▼                                                       ▼
    ┌──────────────────────────────────────────────────────────────────────────┐
    │                         CONDUCTOR AGENT                                  │
    │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
    │  │   Groq AI       │  │  A2A Discovery  │  │  x402 Payment   │          │
    │  │ Intent Detection│  │  Find Agents    │  │  Pay-per-query  │          │
    │  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
    └──────────────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
    ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
    │ Arbitrage Scanner │  │ Sentiment Analyzer│  │ Portfolio Risk    │
    │   0.08 CRO        │  │   0.06 CRO        │  │   0.05 CRO        │
    │                   │  │                   │  │                   │
    │ • CEX/DEX spreads │  │ • Whale tracking  │  │ • Sharpe ratio    │
    │ • Flash loan calc │  │ • TVL analysis    │  │ • VaR calculation │
    │ • Profit after gas│  │ • Price momentum  │  │ • Max drawdown    │
    └───────────────────┘  └───────────────────┘  └───────────────────┘
                    │                  │                  │
                    ▼                  ▼                  ▼
    ┌───────────────────┐  ┌───────────────────┐
    │ Contract Auditor  │  │ Trade Executor    │
    │   0.10 CRO        │  │   0.03 CRO        │
    │                   │  │                   │
    │ • GoPlus security │  │ • Route optimize  │
    │ • Bytecode scan   │  │ • Split routing   │
    │ • Risk scoring    │  │ • MEV protection  │
    └───────────────────┘  └───────────────────┘
```

## Key Features

### 1. x402 Payment Protocol
HTTP 402 "Payment Required" enables pay-per-query access to AI agents:
```
Request ──► 402 Payment Required ──► X-Payment Header ──► 200 OK + Data
```

### 2. A2A (Agent-to-Agent) Protocol
Agents discover and negotiate with each other:
```javascript
GET /api/a2a/agents           // List all available agents
GET /api/a2a/agent/:id        // Get agent capabilities
GET /api/a2a/search?capability=sentiment  // Find by capability
```

### 3. Groq AI Integration
LLM-powered intent detection and analysis (not just API wrappers):
- **Conductor**: Detects user intent → selects appropriate agents
- **Sub-Agents**: Each provides AI-powered analysis of their data

### 4. Real Swap Execution (Mainnet)
Execute real trades on Cronos Mainnet via VVS Finance:
- CRO → USDC/USDT swaps
- Route optimization with MEV protection
- User signs transaction via MetaMask

### 5. Smart Wallet System
CREATE2 counterfactual wallets for predictable addresses:
```javascript
// Get wallet address before deployment
const walletAddress = await factory.getWalletAddress(ownerAddress);
// Deploy when needed
await factory.createWallet(ownerAddress);
```

### 6. MCP Server
Model Context Protocol for external AI assistants:
```bash
npm run mcp  # Start MCP server for Claude/GPT integration
```

### 7. Cryptographic Payment Proofs
Every payment generates a verifiable receipt:
```json
{
  "receiptId": "PAY-abc123",
  "hash": "0x...",           // keccak256 hash
  "signature": "0x...",      // EIP-191 signature
  "verifyUrl": "/api/proof/verify/PAY-abc123"
}
```

## AI Agents (x402-Gated)

| Agent | Price | Capabilities | APIs Used |
|-------|-------|--------------|-----------|
| **Conductor** | 0.02 CRO | Intent detection, agent orchestration | Groq AI |
| **Arbitrage Scanner** | 0.08 CRO | CEX/DEX spreads, flash loan opportunities | CoinGecko, DexScreener, VVS |
| **Sentiment Analyzer** | 0.06 CRO | Whale tracking, TVL, momentum | DefiLlama, CoinGecko, On-chain |
| **Portfolio Risk** | 0.05 CRO | Sharpe ratio, VaR, diversification | CoinGecko, On-chain balances |
| **Contract Auditor** | 0.10 CRO | Security scan, vulnerability scoring | GoPlus Security, Bytecode |
| **Trade Executor** | 0.03 CRO | Route optimization, MEV protection | DexScreener, VVS Router |

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Add your PRIVATE_KEY and GROQ_API_KEY
```

### 3. Run the Server
```bash
npm run dev
```

### 4. Open Dashboard
```
http://localhost:3005
```

### Or try the live demo
```
https://cronos-conductor.vercel.app
```

## API Endpoints

### Conductor (Orchestration)
```bash
# Ask the Conductor to coordinate agents
curl -X POST http://localhost:3005/api/x402/conductor \
  -H "Content-Type: application/json" \
  -H "X-Payment: <proof>" \
  -d '{"goal": "Should I buy CRO right now?"}'
```

### Individual Agents
```bash
# Arbitrage opportunities
curl http://localhost:3005/api/x402/agent/arbitrage?size=1000 \
  -H "X-Payment: <proof>"

# Market sentiment
curl http://localhost:3005/api/x402/agent/sentiment \
  -H "X-Payment: <proof>"

# Portfolio risk analysis
curl http://localhost:3005/api/x402/agent/risk?address=0x... \
  -H "X-Payment: <proof>"

# Contract security audit
curl http://localhost:3005/api/x402/agent/audit?address=0x... \
  -H "X-Payment: <proof>"

# Trade execution route
curl -X POST http://localhost:3005/api/x402/agent/executor \
  -H "Content-Type: application/json" \
  -H "X-Payment: <proof>" \
  -d '{"amountIn": "100", "tokenOut": "USDC"}'
```

### A2A Discovery
```bash
# List all agents
curl http://localhost:3005/api/a2a/agents

# Search by capability
curl http://localhost:3005/api/a2a/search?capability=risk
```

### Payment & Proofs
```bash
# Pay for a service
curl -X POST http://localhost:3005/api/agent/pay \
  -H "Content-Type: application/json" \
  -d '{"serviceId": "agent-sentiment"}'

# Verify payment receipt
curl http://localhost:3005/api/proof/verify/<receiptId>
```

## Smart Contracts

| Contract | Address (Cronos Testnet) | Purpose |
|----------|--------------------------|---------|
| SmartWalletFactory | `0x32537e25eE45e72382320F2abCA8b872c7384d81` | CREATE2 counterfactual wallets |
| AgentWallet | `0x14Cf3DA6Da69F0b5C42cb068D5e92b1fb9c3323C` | Autonomous spending with limits |
| AgentPayGateway | `0xc9995e5d8a059C4B6409488e3D30b04CB78b6120` | Payment routing |
| SettlementEngine | `0x8407391932E10Ced2459b6A628dc617462eE190a` | Transaction settlement |
| EscrowManager | `0x390c17AC063F7E64c93ccC1E3a9381b14D68fB64` | Escrow for complex flows |

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Dashboard UI (HTML/CSS/JS) |
| Backend | Express.js + TypeScript |
| AI/LLM | Groq (llama-3.1-8b-instant) |
| Blockchain | Cronos EVM (Testnet + Mainnet) |
| Smart Contracts | Solidity (AgentWallet, Gateway) |
| DeFi | VVS Finance (Swaps, Liquidity) |
| Protocols | x402, A2A, MCP |

## Project Structure

```
cronos-conductor/
├── contracts/                # Smart Contracts
│   ├── SmartWalletFactory.sol  # CREATE2 counterfactual wallets
│   ├── AgentWallet.sol         # Spending limits & execution
│   ├── AgentPayGateway.sol     # Payment routing
│   ├── SettlementEngine.sol    # Settlement logic
│   └── EscrowManager.sol       # Escrow management
├── src/
│   ├── x402-server.ts        # Main server (all agents, APIs, x402)
│   └── mcp-server.ts         # MCP protocol server
├── public/
│   ├── index.html            # Dashboard UI
│   └── logo.svg              # Logo
├── scripts/
│   └── deploy.ts             # Contract deployment
├── .env.example              # Environment template
├── hardhat.config.ts         # Hardhat configuration
└── README.md
```

## x402 Protocol Headers

When a request requires payment:
```
HTTP/1.1 402 Payment Required
X-Payment: required
X-Payment-Address: 0x15ECEE...
X-Payment-Amount: 80000000000000000
X-Payment-Currency: CRO
X-Payment-Network: cronos-testnet
X402-Version: 1
```

After payment:
```
HTTP/1.1 200 OK
X-Payment-Receipt: PAY-abc123
```

## Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      Security Layers                            │
├─────────────────────────────────────────────────────────────────┤
│  1. Per-Transaction Limit  │  Max 0.5 CRO per call              │
│  2. Daily Spending Cap     │  Max 5.0 CRO per day               │
│  3. Expiry Time            │  Permissions auto-expire           │
│  4. Revocable              │  Owner can revoke instantly        │
│  5. On-Chain Enforcement   │  Smart contract validates all      │
│  6. Cryptographic Proofs   │  EIP-191 signed receipts           │
│  7. On-Chain Verification  │  Payment tx verified via RPC       │
└─────────────────────────────────────────────────────────────────┘
```

### Security Checklist

- [x] **No Hardcoded Secrets**: All API keys and private keys loaded from environment variables
- [x] **Input Validation**: All API inputs validated and sanitized
- [x] **No Command Injection**: No use of exec/spawn with user input
- [x] **No SQL Injection**: No raw SQL queries (uses ethers.js for blockchain)
- [x] **Rate Limiting**: Payment-gated endpoints (x402) prevent abuse
- [x] **CORS Configured**: Proper cross-origin settings
- [x] **Mainnet Swap Safety**: User must explicitly confirm and sign mainnet transactions
- [x] **Payment Verification**: On-chain verification of payment transactions

## Environment Variables

```bash
# Required
PRIVATE_KEY=           # Wallet private key
GROQ_API_KEY=          # Groq AI API key (free at console.groq.com)

# Optional
CRONOS_TESTNET_RPC=https://evm-t3.cronos.org
CRONOS_MAINNET_RPC=https://evm.cronos.org
```

## Scripts

```bash
npm run dev           # Start server locally
npm run mcp           # Start MCP server for external AI
npm run build         # Compile TypeScript
npm run deploy:testnet # Deploy contracts to Cronos Testnet
```

## Links

- **Live Demo**: https://cronos-conductor.vercel.app
- **API Endpoint**: https://cronos-conductor-660587902574.asia-southeast1.run.app
- **SmartWalletFactory**: [Cronoscan](https://testnet.cronoscan.com/address/0x32537e25eE45e72382320F2abCA8b872c7384d81)
- **AgentWallet**: [Cronoscan](https://testnet.cronoscan.com/address/0x14Cf3DA6Da69F0b5C42cb068D5e92b1fb9c3323C)
- **x402 Protocol**: [x402.org](https://www.x402.org)
- **A2A Protocol**: [Google A2A](https://google.github.io/A2A)
- **Cronos Facilitator**: [facilitator.cronoslabs.org](https://facilitator.cronoslabs.org)

## License

MIT

---

*Cronos Conductor - AI Agent Orchestration with x402 Payment Protocol*
