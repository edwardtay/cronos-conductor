/**
 * AgentPay Protocol - Demo Script
 *
 * This script demonstrates the core capabilities of AgentPay:
 * 1. Creating payments
 * 2. Batch payments
 * 3. Recurring payments
 * 4. Escrow creation
 * 5. Market analysis
 * 6. DeFi operations
 */

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { createAgent, AgentPayAgent } from "../src";

dotenv.config();

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                AgentPay Protocol Demo                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Check environment
  if (!process.env.PRIVATE_KEY) {
    console.log("⚠️  Demo running in read-only mode (no PRIVATE_KEY set)");
    console.log("   Set PRIVATE_KEY in .env to enable transactions\n");
  }

  // Create agent
  console.log("🤖 Creating AgentPay Agent...\n");

  const agent = await createAgent({
    privateKey: process.env.PRIVATE_KEY,
    rpcUrl: process.env.CRONOS_TESTNET_RPC || "https://evm-t3.cronos.org",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    contractAddresses: {
      gateway: process.env.AGENTPAY_GATEWAY_ADDRESS || ethers.ZeroAddress,
      settlement: process.env.SETTLEMENT_ENGINE_ADDRESS || ethers.ZeroAddress,
      escrow: process.env.ESCROW_MANAGER_ADDRESS || ethers.ZeroAddress,
    },
  });

  console.log(`   Agent Address: ${agent.getAddress()}`);
  console.log("");

  // Demo 1: Market Analysis
  console.log("─── Demo 1: Market Analysis ────────────────────────────────────\n");

  try {
    console.log("📊 Analyzing CRO/USD market...\n");

    const analysis = await agent.analyzeMarket({
      symbols: ["CRO_USD"],
    });

    console.log("   Market Analysis Result:");
    console.log(JSON.stringify(analysis, null, 2));
    console.log("");
  } catch (error: any) {
    console.log("   Skipped (API not available):", error.message);
    console.log("");
  }

  // Demo 2: Payment Creation (simulation)
  console.log("─── Demo 2: Payment Creation ───────────────────────────────────\n");

  console.log("💸 Creating payment request...\n");

  const paymentParams = {
    to: "0x742d35Cc6634C0532925a3b844Bc9e7595f5e0D4", // Example recipient
    token: ethers.ZeroAddress, // Native CRO
    amount: "1.0",
    deadline: 3600,
  };

  console.log("   Payment Parameters:");
  console.log(`     To: ${paymentParams.to}`);
  console.log(`     Amount: ${paymentParams.amount} CRO`);
  console.log(`     Deadline: ${paymentParams.deadline} seconds`);
  console.log("");

  if (process.env.PRIVATE_KEY && process.env.AGENTPAY_GATEWAY_ADDRESS) {
    try {
      const result = await agent.executePayment(paymentParams);
      console.log("   ✅ Payment created!");
      console.log(`   Payment ID: ${result.paymentId}`);
      console.log(`   TX Hash: ${result.txHash}`);
    } catch (error: any) {
      console.log("   ❌ Payment failed:", error.message);
    }
  } else {
    console.log("   ⏭️  Skipped (set PRIVATE_KEY and deploy contracts first)");
  }
  console.log("");

  // Demo 3: Batch Payments
  console.log("─── Demo 3: Batch Payments ─────────────────────────────────────\n");

  console.log("📦 Creating batch payment...\n");

  const batchParams = {
    payments: [
      { to: "0xAlice000000000000000000000000000000000001", token: ethers.ZeroAddress, amount: "5.0" },
      { to: "0xBob00000000000000000000000000000000000002", token: ethers.ZeroAddress, amount: "3.0" },
      { to: "0xCharlie0000000000000000000000000000000003", token: ethers.ZeroAddress, amount: "2.0" },
    ],
  };

  console.log("   Batch contains 3 payments:");
  for (const p of batchParams.payments) {
    console.log(`     - ${p.to.substring(0, 10)}... : ${p.amount} CRO`);
  }
  console.log("");
  console.log("   ⏭️  Batch execution would be atomic (all or none)");
  console.log("");

  // Demo 4: Recurring Payment
  console.log("─── Demo 4: Recurring Payment ──────────────────────────────────\n");

  console.log("🔄 Setting up recurring payment...\n");

  const recurringParams = {
    to: "0xServiceProvider0000000000000000000000000",
    token: ethers.ZeroAddress,
    amount: "10.0",
    intervalDays: 7,
    count: 4,
  };

  console.log("   Recurring Payment Schedule:");
  console.log(`     Recipient: ${recurringParams.to.substring(0, 15)}...`);
  console.log(`     Amount: ${recurringParams.amount} CRO`);
  console.log(`     Interval: Every ${recurringParams.intervalDays} days`);
  console.log(`     Count: ${recurringParams.count} payments`);
  console.log(`     Total: ${parseFloat(recurringParams.amount) * recurringParams.count} CRO`);
  console.log("");

  // Demo 5: Milestone Escrow
  console.log("─── Demo 5: Milestone Escrow ───────────────────────────────────\n");

  console.log("🔒 Creating milestone escrow...\n");

  const escrowParams = {
    beneficiary: "0xFreelancer00000000000000000000000000000",
    token: ethers.ZeroAddress,
    milestones: [
      { description: "Project design and wireframes", amount: "500.0" },
      { description: "Frontend development", amount: "1500.0" },
      { description: "Backend development", amount: "1500.0" },
      { description: "Testing and deployment", amount: "500.0" },
    ],
  };

  console.log("   Milestone Escrow:");
  console.log(`     Beneficiary: ${escrowParams.beneficiary.substring(0, 15)}...`);
  console.log("     Milestones:");

  let total = 0;
  for (const m of escrowParams.milestones) {
    console.log(`       - ${m.description}: ${m.amount} CRO`);
    total += parseFloat(m.amount);
  }
  console.log(`     Total Locked: ${total} CRO`);
  console.log("");

  // Demo 6: Portfolio View
  console.log("─── Demo 6: Portfolio View ─────────────────────────────────────\n");

  const portfolio = agent.getPortfolio();
  if (portfolio) {
    console.log("   Current Portfolio:");
    for (const position of portfolio.positions) {
      console.log(`     ${position.token}: ${ethers.formatEther(position.amount)} (~$${position.valueUsd.toFixed(2)})`);
    }
    console.log(`     Total Value: ~$${portfolio.totalValueUsd.toFixed(2)}`);
  } else {
    console.log("   Portfolio not yet loaded");
  }
  console.log("");

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                        Demo Complete                           ");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Deploy contracts: npm run deploy:testnet");
  console.log("  2. Update .env with contract addresses");
  console.log("  3. Run agent: npm run agent");
  console.log("");
}

main().catch(console.error);
