import chai, { expect } from 'chai';
import { Contract, BigNumber, constants } from 'ethers';
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle';
import { ecsign } from 'ethereumjs-util';

import { stakingRewardFixture } from './fixtures';
import { REWARD_DURATION, expandTo18Decimals, mineBlock, getApprovalDigest, SPLIT } from './util';


chai.use(solidity);

context('StakingReward', async() => {
    const provider = new MockProvider({
        ganacheOptions: {
            hardfork: 'istanbul',
            mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
            gasLimit: 99999999
        },
    });

    const [wallet, staker, secondStaker] = provider.getWallets();
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
    async function start(reward: BigNumber): Promise<{ startTime: BigNumber, vestingEndTime: BigNumber, rewardEndTime: BigNumber, totalSplits: BigNumber,
        splitWindow: BigNumber }> {
        // Send reward to the contract
        await rewardToken.transfer(stakingReward.address, reward);
        // Must be called by rewardDistributor
        await stakingReward.notifyRewardAmount(reward);
        
        const startTime: BigNumber = await stakingReward.lastUpdatedTime();
        const rewardEndTime: BigNumber = await stakingReward.periodFinish();
        const vestingEndTime: BigNumber = await stakingReward.vestingPeriod();
        const totalSplits: BigNumber = await stakingReward.split();
        const splitWindow: BigNumber = await stakingReward.splitWindow();

        return { startTime, vestingEndTime, rewardEndTime, totalSplits, splitWindow };
    }

    it('Stake and contract has correct state', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const totalSupply = await stakingReward.totalSupply();
        const balance = await stakingReward.balanceOf(staker.address);
        expect(totalSupply).to.be.eq(stake);
        expect(balance).to.be.eq(stake);
    })

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

    it('stake and withdraw after half of time', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { startTime, vestingEndTime, rewardEndTime } = await start(reward);

        await mineBlock(provider, startTime.add(rewardEndTime.sub(startTime).div(2)).toNumber());
        await stakingReward.connect(staker).withdraw(stake.div(2));

        const stakeBalance = await stakingReward.balanceOf(staker.address);
        expect(stakeBalance).to.be.eq(stake.sub(stake.div(2)));
        const totalSupply = await stakingReward.totalSupply();
        expect(totalSupply).to.be.eq(stakeBalance);

        await mineBlock(provider, rewardEndTime.add(vestingEndTime).add(1).toNumber());
        await stakingReward.connect(staker).getReward();
        const rewardBalance = await rewardToken.balanceOf(staker.address);
        expect(rewardBalance.sub(reward.div(REWARD_DURATION).mul(REWARD_DURATION))).lte(rewardBalance.div(10000));
        //expect(rewardBalance).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION));

    })

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
    });

    it('get full reward', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { vestingEndTime, rewardEndTime } = await start(reward);

        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());

        //unstake
        await stakingReward.connect(staker).exit();

        const rewardAmount = await rewardToken.balanceOf(staker.address);
        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION));
    });

    it('get full reward with setConfig', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);
        const { vestingEndTime, rewardEndTime } = await start(reward);
        await stakingReward.connect(staker).setVestingConfig(true);

        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());


        //unstake
        await stakingReward.connect(staker).exit();

        const rewardAmount = await rewardToken.balanceOf(staker.address);
        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION));
    });


    context('get part of reward after a release', async() => {
        let rewardEndTime: BigNumber;
        let splitWindow: BigNumber;
        beforeEach(async() => {
            const stake = expandTo18Decimals(2);
            await stakingToken.transfer(staker.address, stake);
            await stakingToken.connect(staker).approve(stakingReward.address, stake);
            await stakingReward.connect(staker).stake(stake);
            ({ rewardEndTime, splitWindow } =  await start(reward)) ;
        });
        it('First', async() => {
            await mineBlock(provider, rewardEndTime.toNumber());
            await stakingReward.connect(staker).getReward();
            const rewardBalance = await rewardToken.balanceOf(staker.address);
            expect(rewardBalance).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).div(SPLIT));
            const stakerSplit = await stakingReward.hasClaimed(staker.address);
            expect(stakerSplit).to.be.eq(1);
        });

        it('Second', async() => {
            await mineBlock(provider, rewardEndTime.add(splitWindow).toNumber());
            await stakingReward.connect(staker).getReward();
            const rewardBalance = await rewardToken.balanceOf(staker.address);
            expect(rewardBalance).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).mul(2).div(SPLIT));
            const stakerSplit = await stakingReward.hasClaimed(staker.address);
            expect(stakerSplit).to.be.eq(2);
        });

        it('Third', async() => {
            await mineBlock(provider, rewardEndTime.add(splitWindow.mul(2)).toNumber());
            await stakingReward.connect(staker).getReward();
            const rewardBalance = await rewardToken.balanceOf(staker.address);
            expect(rewardBalance).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).mul(3).div(SPLIT));
            const stakerSplit = await stakingReward.hasClaimed(staker.address);
            expect(stakerSplit).to.be.eq(3);
        });

        it('Forth', async() => {
            await mineBlock(provider, rewardEndTime.add(splitWindow.mul(3)).toNumber());
            await stakingReward.connect(staker).getReward();
            const rewardBalance = await rewardToken.balanceOf(staker.address);
            expect(rewardBalance).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).mul(4).div(SPLIT));
            const stakerSplit = await stakingReward.hasClaimed(staker.address);
            expect(stakerSplit).to.be.eq(4);
        });
    })
    it('Get reward after each release', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { rewardEndTime, totalSplits, splitWindow } = await start(reward);


        for (let i = 0; i < totalSplits.toNumber(); i++) {
            const oldBalance = await rewardToken.balanceOf(staker.address);
            mineBlock(provider, rewardEndTime.add(splitWindow.mul(i)).toNumber());
            await stakingReward.connect(staker).getReward();
            const newBalance = await rewardToken.balanceOf(staker.address);
            expect(newBalance.sub(oldBalance)).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).div(totalSplits));
        }

    });

    context('#Check availableReward', async() => {
        let rewardEndTime: BigNumber;
        let totalSplits: BigNumber;
        let splitWindow: BigNumber;
        let vestingEndTime: BigNumber;
        beforeEach(async() => {
            const stake = expandTo18Decimals(2);
            await stakingToken.transfer(staker.address, stake);
            await stakingToken.connect(staker).approve(stakingReward.address, stake);
            await stakingReward.connect(staker).stake(stake);
            ({ vestingEndTime, rewardEndTime, totalSplits, splitWindow } = await start(reward));
        });

        it('Set hasOptForVesting = false', async() => {
            await stakingReward.connect(staker).setVestingConfig(false);
            await mineBlock(provider, rewardEndTime.add(vestingEndTime).add(1).toNumber());
            const available1 = await stakingReward.availableReward(staker.address);
            expect(available1).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION).div(2));
            await stakingReward.connect(staker).getReward();
            const available2 = await stakingReward.availableReward(staker.address);
            expect(available2).to.be.eq(0);
        });

        it('Dont set hasOptForVesting, and dont get reward each release', async() => {

            await mineBlock(provider, rewardEndTime.sub(1).toNumber());
            const actualRewarded = reward.div(REWARD_DURATION).mul(REWARD_DURATION);
            expect(await stakingReward.availableReward(staker.address)).to.be.eq(0);
            for (let i = 0; i < totalSplits.toNumber(); i++) {
                await mineBlock(provider, rewardEndTime.add(splitWindow.mul(i)).toNumber());
                const available = await stakingReward.availableReward(staker.address);
                expect(available).to.be.eq(actualRewarded.mul(i + 1).div(totalSplits));
            } 
        });
        
        it('Dont set hasOptForVesting, and get reward after each release', async() => {
            const actualRewarded = reward.div(REWARD_DURATION).mul(REWARD_DURATION);
            for (let i = 0; i < totalSplits.toNumber(); i++) {
                await mineBlock(provider, rewardEndTime.add(splitWindow.mul(i)).toNumber());
                const available = await stakingReward.availableReward(staker.address);
                expect(available).to.be.eq(actualRewarded.div(totalSplits));
                await stakingReward.connect(staker).getReward();
            } 
        });
    })

    it('stake with permit', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);

        const nonce = await stakingToken.nonces(staker.address);
        const deadline = constants.MaxUint256;
        const digest = await getApprovalDigest(
            stakingToken,
            { owner: staker.address, spender: stakingReward.address, value: stake },
            nonce,
            deadline
        );
        const { v, r, s } = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(staker.privateKey.slice(2), 'hex'));
        await stakingReward.connect(staker).stakeWithPermit(stake, deadline, v, r, s);

        const { vestingEndTime, rewardEndTime } = await start(reward);

        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());

        await stakingReward.connect(staker).exit();
        const rewardAmount = await rewardToken.balanceOf(staker.address);

        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(REWARD_DURATION))
    });

    it('Stake half of the time', async() => {
        const { startTime, rewardEndTime } = await start(reward);

        await mineBlock(provider, startTime.add(rewardEndTime.sub(startTime).div(2)).toNumber());

        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);
        const stakeStartTime: BigNumber = await stakingReward.lastUpdatedTime();

        await mineBlock(provider, rewardEndTime.add(1).toNumber());

        await stakingReward.connect(staker).exit();
        const stakeEndTime: BigNumber = await stakingReward.lastUpdatedTime();

        const rewardAmount = await rewardToken.balanceOf(staker.address);

        expect(rewardAmount).to.be.eq(reward.div(REWARD_DURATION).mul(stakeEndTime.sub(stakeStartTime)).div(SPLIT));
    });

    it('Two stakers', async() => {
        const stake = expandTo18Decimals(2);
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);

        const { startTime, vestingEndTime, rewardEndTime } = await start(reward);
        await stakingReward.connect(staker).setVestingConfig(true);

        await mineBlock(provider, startTime.add(rewardEndTime.sub(startTime).div(2)).toNumber());

        //stake with second staker
        await stakingToken.transfer(secondStaker.address, stake);
        await stakingToken.connect(secondStaker).approve(stakingReward.address, stake);
        await stakingReward.connect(secondStaker).stake(stake);
        await stakingReward.connect(secondStaker).setVestingConfig(true);

        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());

        //unstake
        await stakingReward.connect(staker).exit();
        await stakingReward.connect(secondStaker).exit();

        const rewardAmount = await rewardToken.balanceOf(staker.address);
        const secondRewardAmount = await rewardToken.balanceOf(secondStaker.address);
        const totalReward = rewardAmount.add(secondRewardAmount);


        // ensure result are within 0.01%
        expect(reward.sub(totalReward).lte(reward.div(10000))).to.be.true;
        expect(totalReward.mul(3).div(4).sub(rewardAmount).lte(totalReward.mul(3).div(4).div(10000)));
        expect(totalReward.div(4).sub(secondRewardAmount).lte(totalReward.div(4).div(10000)));
    });

    it('Two stakers and one withdraw after half of time', async() => {
        const stake = expandTo18Decimals(4);
        
        await stakingToken.transfer(staker.address, stake);
        await stakingToken.connect(staker).approve(stakingReward.address, stake);
        await stakingReward.connect(staker).stake(stake);
        
        await stakingToken.transfer(secondStaker.address, stake);
        await stakingToken.connect(secondStaker).approve(stakingReward.address, stake);
        await stakingReward.connect(secondStaker).stake(stake);

        const { startTime, vestingEndTime, rewardEndTime } = await start(reward);

        await mineBlock(provider, startTime.add(rewardEndTime.sub(startTime).div(2)).toNumber());
        await stakingReward.connect(staker).withdraw(expandTo18Decimals(3));

        await mineBlock(provider, vestingEndTime.add(rewardEndTime).add(1).toNumber());
        await stakingReward.connect(staker).getReward();
        await stakingReward.connect(secondStaker).getReward();
        const stakerBalance = await rewardToken.balanceOf(staker.address);
        const secondStakerBalance = await rewardToken.balanceOf(secondStaker.address);

        const actualRewarded = reward.div(REWARD_DURATION).mul(REWARD_DURATION);
        const actualFirst = actualRewarded.div(4).add(actualRewarded.div(2).div(5));
        const actualSecond = actualRewarded.div(4).add(actualRewarded.div(2).mul(4).div(5));
        expect(stakerBalance.sub(actualFirst)).lte(stakerBalance.div(10000));
        expect(secondStakerBalance.sub(actualSecond)).lte(secondStakerBalance.div(10000));
    })
})
