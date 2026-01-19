import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { AgentPayAgent, AgentConfig } from "./agent/AgentPayAgent";
import { ContractAddresses } from "./services/ContractService";

dotenv.config();

// Export all modules
export { AgentPayAgent, AgentConfig } from "./agent/AgentPayAgent";
export { ContractService, ContractAddresses } from "./services/ContractService";
export { CryptoComService, cryptoComService } from "./integrations/CryptoComService";
export { VVSFinanceService, CRONOS_TESTNET_ADDRESSES, CRONOS_MAINNET_ADDRESSES } from "./integrations/VVSFinanceService";

/**
 * Quick start function for AgentPay
 */
export async function createAgent(options?: Partial<AgentConfig>): Promise<AgentPayAgent> {
  const config: AgentConfig = {
    privateKey: options?.privateKey || process.env.PRIVATE_KEY || "",
    rpcUrl: options?.rpcUrl || process.env.CRONOS_TESTNET_RPC || "https://evm-t3.cronos.org",
    anthropicApiKey: options?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
    contractAddresses: options?.contractAddresses || {
      gateway: process.env.AGENTPAY_GATEWAY_ADDRESS || "",
      settlement: process.env.SETTLEMENT_ENGINE_ADDRESS || "",
      escrow: process.env.ESCROW_MANAGER_ADDRESS || "",
    },
    isMainnet: options?.isMainnet || false,
  };

  return new AgentPayAgent(config);
}

// CLI entry point
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    AgentPay Protocol                         ║");
  console.log("║     AI-Powered Payment Orchestration on Cronos EVM           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  // Check configuration
  if (!process.env.PRIVATE_KEY) {
    console.log("⚠️  No PRIVATE_KEY found. Running in read-only mode.");
    console.log("   Set PRIVATE_KEY in .env to enable transactions.");
    console.log("");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  No ANTHROPIC_API_KEY found. AI features will be limited.");
    console.log("   Set ANTHROPIC_API_KEY in .env to enable AI decision making.");
    console.log("");
  }

  // Verify contract addresses
  const requiredAddresses = [
    "AGENTPAY_GATEWAY_ADDRESS",
    "SETTLEMENT_ENGINE_ADDRESS",
    "ESCROW_MANAGER_ADDRESS",
  ];

  const missingAddresses = requiredAddresses.filter((addr) => !process.env[addr]);
  if (missingAddresses.length > 0) {
    console.log("⚠️  Missing contract addresses:");
    missingAddresses.forEach((addr) => console.log(`   - ${addr}`));
    console.log("");
    console.log("   Deploy contracts first: npm run deploy:testnet");
    console.log("");
    return;
  }

  // Create and start agent
  console.log("🚀 Initializing AgentPay Agent...");
  const agent = await createAgent();
  console.log(`✅ Agent address: ${agent.getAddress()}`);
  console.log("");

  // Example: Analyze CRO market
  console.log("📊 Running market analysis...");
  const analysis = await agent.analyzeMarket({ symbols: ["CRO_USD", "CRO_USDT"] });
  console.log("Market Analysis:", JSON.stringify(analysis, null, 2));
  console.log("");

  // Start agent loop
  console.log("🔄 Starting agent loop (Ctrl+C to stop)...");
  await agent.start();
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
