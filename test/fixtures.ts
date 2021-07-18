import chai from 'chai';
import { Contract, Wallet, BigNumber, providers } from 'ethers';
import { solidity, deployContract } from 'ethereum-waffle';

import { expandTo18Decimals, SPLIT, VESTING, REWARD_DURATION } from './util';

import TestBEP20 from '../build/contracts/TestBEP20.json';
import StakingRewardsFactory from '../build/contracts/StakingRewardsFactory.json';

chai.use(solidity);

const NUMBER_OF_STAKING_TOKENS = 4;

interface StakingRewardsFixture {
    stakingReward: Contract,
    rewardToken: Contract,
    stakingToken: Contract
}

interface StakingRewardsFactoryFixture {
    rewardToken: Contract,
    stakingTokens: Contract[],
    genesis: number,
    rewardAmounts: BigNumber[],
    stakingRewardsFactory: Contract
}
export async function stakingRewardsFactoryFixture(
    [wallet]: Wallet[],
    provider: providers.Web3Provider
): Promise<StakingRewardsFactoryFixture> {
    const rewardToken = await deployContract(wallet, TestBEP20, [expandTo18Decimals(1_000_000_000)]);

    const stakingTokens = [];
    for (let i = 0; i < NUMBER_OF_STAKING_TOKENS; i++) {
        const stakingToken = await deployContract(wallet, TestBEP20, [expandTo18Decimals(1_000_000_000)]);
        stakingTokens.push(stakingToken);
    }

    // deploy the staking rewards factory
    const { timestamp: now } = await provider.getBlock('latest');
    const genesis = now + 60 * 60;
    const rewardAmounts: BigNumber[] = new Array(stakingTokens.length).fill(expandTo18Decimals(10));
    const stakingRewardsFactory = await deployContract(wallet, StakingRewardsFactory, [rewardToken.address, genesis]);

    return { rewardToken, stakingTokens, genesis, rewardAmounts, stakingRewardsFactory };
}
