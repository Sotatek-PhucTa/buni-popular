import Web3 from "web3";
import fs from "fs";
import HDWalletProviders from "@truffle/hdwallet-provider";
import {BigNumber} from "ethers";


const config = JSON.parse(fs.readFileSync("./config/sys_config.json", "utf-8"));
const privateKey = config["mnemonic"].trim();
const factoryAddress = config["factory_address"].trim();
// const api = config["kovan_api"].trim();
const api = config["kovan_api"].trim();
const web3 = new Web3(new HDWalletProviders(privateKey, api));

function getAbi(buildPath: string) {
    const buildData = JSON.parse(fs.readFileSync(buildPath, "utf-8"));
    return buildData["abi"];
}

const factoryContractAbi = getAbi("./build/contracts/StakingRewardsFactory.json");

const factoryContract = new web3.eth.Contract(factoryContractAbi, factoryAddress); 

function convertToStandard(x: number | string | BigNumber) {
    if (typeof(x) === 'string')
        return "0".repeat(24) + x.slice(2);
    else {
        const tx = x.toString(16);
        return "0".repeat(64 - tx.length) + tx;
    }
}
async function deployNewFarm(farmInfo: any, accountAddress: string) {
    if (!farmInfo["available"])
        return;
    console.log("Deploying\n " + JSON.stringify(farmInfo) + " with address " + accountAddress);
    const tx = {
        from: accountAddress,
        to: factoryAddress,
        data: factoryContract.methods.deploy(
            farmInfo["staking_token"],
            farmInfo["reward_amount"],
            farmInfo["reward_duration"],
            farmInfo["vesting_period"],
            farmInfo["splits"]
        ).encodeABI()
    }

    const signedTx = await web3.eth.signTransaction(tx, tx.from);
    console.log("Signed transaction " + JSON.stringify(signedTx));
    await web3.eth.sendSignedTransaction(signedTx.raw);
    console.log("Deploy suceess\n");
    
    const farmDeployedInfo = await 
        factoryContract.methods.stakingRewardInfosByStakingToken(farmInfo["staking_token"])
        .call({from: accountAddress});

    
    
    console.log("Deployed farm " );
    console.log(farmDeployedInfo);
    console.log("-----------------------------------------------");
}
// Deploy contract 
const farmInfos = JSON.parse(fs.readFileSync("./config/farm_config.json", "utf-8"))["kovan"];

(async() => {
    const accountAddress = await web3.eth.getAccounts();
    for (let farmInfo of farmInfos) {
        await deployNewFarm(farmInfo, accountAddress[0]);
    }
})();
