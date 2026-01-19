import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              AgentPay Protocol Deployment                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO");
  console.log("");

  // 1. Deploy AgentPayGateway
  console.log("1️⃣  Deploying AgentPayGateway...");
  const AgentPayGateway = await ethers.getContractFactory("AgentPayGateway");
  const gateway = await AgentPayGateway.deploy(deployer.address);
  await gateway.waitForDeployment();
  const gatewayAddress = await gateway.getAddress();
  console.log("   ✅ AgentPayGateway deployed to:", gatewayAddress);
  console.log("");

  // 2. Deploy SettlementEngine
  console.log("2️⃣  Deploying SettlementEngine...");
  const SettlementEngine = await ethers.getContractFactory("SettlementEngine");
  const settlement = await SettlementEngine.deploy(gatewayAddress);
  await settlement.waitForDeployment();
  const settlementAddress = await settlement.getAddress();
  console.log("   ✅ SettlementEngine deployed to:", settlementAddress);
  console.log("");

  // 3. Deploy EscrowManager
  console.log("3️⃣  Deploying EscrowManager...");
  const EscrowManager = await ethers.getContractFactory("EscrowManager");
  const escrow = await EscrowManager.deploy(deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("   ✅ EscrowManager deployed to:", escrowAddress);
  console.log("");

  // 4. Deploy AgentWallet
  console.log("4️⃣  Deploying AgentWallet...");
  const AgentWallet = await ethers.getContractFactory("AgentWallet");
  const agentWallet = await AgentWallet.deploy();
  await agentWallet.waitForDeployment();
  const agentWalletAddress = await agentWallet.getAddress();
  console.log("   ✅ AgentWallet deployed to:", agentWalletAddress);
  console.log("");

  // 5. Configure contracts
  console.log("5️⃣  Configuring contracts...");

  // Authorize settlement engine as agent on gateway
  await gateway.setAuthorizedAgent(settlementAddress, true);
  console.log("   ✅ Settlement engine authorized on gateway");

  // Authorize deployer as agent (for testing)
  await gateway.setAuthorizedAgent(deployer.address, true);
  console.log("   ✅ Deployer authorized as agent");
  console.log("");

  // 6. Save deployment addresses
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    contracts: {
      AgentPayGateway: gatewayAddress,
      SettlementEngine: settlementAddress,
      EscrowManager: escrowAddress,
      AgentWallet: agentWalletAddress,
    },
    timestamp: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `deployment-${deploymentInfo.chainId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(deploymentInfo, null, 2));

  // Also save as latest
  fs.writeFileSync(path.join(deploymentsDir, "latest.json"), JSON.stringify(deploymentInfo, null, 2));

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    DEPLOYMENT COMPLETE                         ");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Contract Addresses:");
  console.log(`  AgentPayGateway:  ${gatewayAddress}`);
  console.log(`  SettlementEngine: ${settlementAddress}`);
  console.log(`  EscrowManager:    ${escrowAddress}`);
  console.log(`  AgentWallet:      ${agentWalletAddress}`);
  console.log("");
  console.log("Add these to your .env file:");
  console.log(`  AGENTPAY_GATEWAY_ADDRESS=${gatewayAddress}`);
  console.log(`  SETTLEMENT_ENGINE_ADDRESS=${settlementAddress}`);
  console.log(`  ESCROW_MANAGER_ADDRESS=${escrowAddress}`);
  console.log(`  AGENT_WALLET_ADDRESS=${agentWalletAddress}`);
  console.log("");
  console.log(`Deployment saved to: ${path.join(deploymentsDir, filename)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
