import chai, { expect } from 'chai';
import { Contract, BigNumber, constants } from 'ethers';
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle';
import { ecsign } from 'ethereumjs-util';

import { stakingRewardFixture } from './fixtures';
import { REWARD_DURATION, VESTING, expandTo18Decimals, mineBlock, getApprovalDigest, SPLIT } from './util';

import StakingReward from '../build/contracts/StakingReward.json';

chai.use(solidity);

context('StakingReward', async() => {
    const provider = new MockProvider({
        ganacheOptions: {
            hardfork: 'istanbul',
            mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
            gasLimit: 99999999
        },
    });

    const [wallet, staker, stakerSecond] = provider.getWallets();
    const loadFixture = createFixtureLoader([wallet], provider);

    let stakingReward: Contract;
    let rewardToken: Contract;
    let stakingToken: Contract;

    beforeEach(async() => {
        const fixture = await loadFixture(stakingRewardFixture);
        stakingReward = fixture.stakingReward;
        rewardToken = fixture.rewardToken;
        stakingToken = fixture.stakingToken;
    });

    it('rewardDuration', async() => {
        const rewardDuration = await stakingReward.rewardDuration();
        expect(rewardDuration).to.be.eq(REWARD_DURATION);
    });

    const reward = expandTo18Decimals(100);
    async function start(reward: BigNumber): Promise<{ startTime: BigNumber, vestingEndTime: BigNumber, rewardEndTime: BigNumber, totalSplits: BigNumber }> {
        // Send reward to the contract
        await rewardToken.transfer(stakingReward.address, reward);
        // Must be called by rewardDistributor
        await stakingReward.notifyRewardAmount(reward);
        
        const startTime: BigNumber = await stakingReward.lastUpdatedTime();
        const rewardEndTime: BigNumber = await stakingReward.periodFinish();
        const vestingEndTime: BigNumber = await stakingReward.vestingPeriod();
        const totalSplits: BigNumber = await stakingReward.split();

        return { startTime, vestingEndTime, rewardEndTime, totalSplits };
    }

    it('notifyRewardAmounts: take half, burn rest', async() => {
        // stake with staker
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { vestingEndTime, rewardEndTime } = await start(reward);
        await stakingReward.connect(staker).setVestingConfig(false);

        // fast-forward past the reward window
        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());

        // unstake
        await stakingReward.connect(staker).exit();

        const rewardAmount = await rewardToken.balanceOf(staker.address);

        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).div(2));
    });

    it('Cannot change config after claim', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { vestingEndTime, rewardEndTime } = await start(reward);
        await stakingReward.connect(staker).setVestingConfig(false);

        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());

        //unstake
        await stakingReward.connect(staker).exit();
        const rewardAmount = await rewardToken.balanceOf(staker.address);
        
        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).div(2));

        await expect(stakingReward.connect(staker).setVestingConfig(true)).to.revertedWith('Cannot update vesting schedule now')
    })

    it('No reward after burn', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { vestingEndTime, rewardEndTime } = await start(reward);
        await stakingReward.connect(staker).setVestingConfig(false);
        
        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());
        
        //unstake
        await stakingReward.connect(staker).exit();

        const rewardAmount = await rewardToken.balanceOf(staker.address);
        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).div(2));

        // Again calling getReward
        await stakingReward.connect(staker).getReward();
        const newRewardAmount = await rewardToken.balanceOf(staker.address);
        expect(newRewardAmount).to.be.eq(rewardAmount);
    })
})
