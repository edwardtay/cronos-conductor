import { ethers } from "hardhat";

async function main() {
  console.log("Deploying AgentWallet...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO");

  const AgentWallet = await ethers.getContractFactory("AgentWallet");
  const wallet = await AgentWallet.deploy();
  await wallet.waitForDeployment();

  const address = await wallet.getAddress();
  console.log("AgentWallet deployed to:", address);
  console.log("");
  console.log("Add to .env:");
  console.log(`AGENT_WALLET_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
