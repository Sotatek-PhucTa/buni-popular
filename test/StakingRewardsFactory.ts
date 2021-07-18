import chai, { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle';

import { stakingRewardsFactoryFixture } from './fixtures';
import { mineBlock, REWARD_DURATION, VESTING, SPLIT } from './util';

import StakingReward from '../build/contracts/StakingReward.json';

chai.use(solidity);

context("StakingRewardsFactory create factory", async() => {
    const provider = new MockProvider({
        ganacheOptions: {
            hardfork: 'istanbul',
            mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
            gasLimit: 9999999
        }
    });

    const [ wallet, wallet1 ] = provider.getWallets()
    const loadFixture = createFixtureLoader([wallet], provider);

    let rewardToken: Contract;
    let genesis: number;
    let rewardAmounts: BigNumber[];
    let stakingRewardsFactory: Contract;
    let stakingTokens: Contract[];

    beforeEach('load fixture', async() => {
        const fixture = await loadFixture(stakingRewardsFactoryFixture);
        rewardToken = fixture.rewardToken;
        genesis = fixture.genesis;
        rewardAmounts = fixture.rewardAmounts;
        stakingRewardsFactory = fixture.stakingRewardsFactory;
        stakingTokens = fixture.stakingTokens;
    });

    xcontext("#deploy", async() => {
        it('pushes the token into the list', async() => {
            await stakingRewardsFactory.deploy(stakingTokens[1].address, 100000, REWARD_DURATION, VESTING, SPLIT);
            expect(await stakingRewardsFactory.stakingTokens(0)).to.eq(stakingTokens[1].address);
        });
        it('fails if call twice for the same token', async() => {
            await stakingRewardsFactory.deploy(stakingTokens[1].address, 100000, REWARD_DURATION, VESTING, SPLIT);
            await expect(stakingRewardsFactory.deploy(stakingTokens[1].address, 100000, REWARD_DURATION, VESTING, SPLIT))
                .to.revertedWith('already deployed');
        });
        it('it only called by owner', async() => {
            await expect(stakingRewardsFactory.connect(wallet1).deploy(stakingTokens[1].address, 100000, REWARD_DURATION, VESTING, SPLIT))
            .to.be.revertedWith('Ownable: caller is not the owner');
        });
        it('store the address of stakingRewards and store correct parameters', async() => {
            await stakingRewardsFactory.deploy(stakingTokens[1].address, 10000, REWARD_DURATION, VESTING, SPLIT);
            const [stakingRewards, rewardAmount, rewardDuration, vestingPeriod, split] =
                await stakingRewardsFactory.stakingRewardInfosByStakingToken(stakingTokens[1].address);
            expect(rewardAmount).equals(10000);
            expect(rewardDuration).equals(REWARD_DURATION);
            expect(vestingPeriod).equals(VESTING);
            expect(split).equals(SPLIT);
            expect(await provider.getCode(stakingRewards)).to.not.eq('0x');
        });
        it('deploy stakingRewards has correct parameters', async() => {
            await stakingRewardsFactory.deploy(stakingTokens[1].address, 10000, REWARD_DURATION, VESTING, SPLIT);
            const [stakingRewardAddress] = await stakingRewardsFactory.stakingRewardInfosByStakingToken(
                stakingTokens[1].address
            );
            const stakingReward = new Contract(stakingRewardAddress, StakingReward.abi, provider);
            expect(await stakingReward.rewardDistributor()).to.eq(stakingRewardsFactory.address);
            expect(await stakingReward.stakingToken()).to.eq(stakingTokens[1].address);
            expect(await stakingReward.rewardToken()).to.eq(rewardToken.address);
        });
    });

    context("#notifyRewardAmounts", () => {
        let totalRewardAmount: BigNumber;

        beforeEach(() => {
            totalRewardAmount = rewardAmounts.reduce((accumulator, current) => accumulator.add(current), BigNumber.from(0));
        });

        it('called before any deploys', async() => {
            await expect(stakingRewardsFactory.notifyRewardAmounts())
            .to.be.revertedWith('called before any deploys');
        });

        context('after deploying all stakingRewards', async() => {
            let stakingRewards: Contract[];

            beforeEach(async() => {
                stakingRewards = [];
                for (let i = 0; i < stakingTokens.length; i++) {
                    await stakingRewardsFactory.deploy(stakingTokens[i].address, rewardAmounts[i], REWARD_DURATION, VESTING, SPLIT);
                    const [stakingReardAddress] = await stakingRewardsFactory.stakingRewardInfosByStakingToken(
                        stakingTokens[i].address
                    );
                    stakingRewards.push(new Contract(stakingReardAddress, StakingReward.abi, provider));
                }
            });

            it('no op if called twice', async() => {
                await rewardToken.transfer(stakingRewardsFactory.address, totalRewardAmount);
                await mineBlock(provider, genesis);
                await expect(stakingRewardsFactory.notifyRewardAmounts()).to.emit(rewardToken, 'Transfer');
                await expect(stakingRewardsFactory.notifyRewardAmounts()).to.not.emit(rewardToken, 'Transfer');
            });

            it('fails if called without sufficient balance', async() => {
                await mineBlock(provider, genesis);
                await expect(stakingRewardsFactory.notifyRewardAmounts())
                .to.be.revertedWith('BEP20: transfer amount exceeds balance');
            });

            it('calls notifyRewards on each contract', async() => {
                await rewardToken.transfer(stakingRewardsFactory.address, totalRewardAmount);
                await mineBlock(provider, genesis);
                await expect(stakingRewardsFactory.notifyRewardAmounts())
                .to.emit(stakingRewards[0], 'RewardAdded')
                .withArgs(rewardAmounts[0])
                .to.emit(stakingRewards[1], 'RewardAdded')
                .withArgs(rewardAmounts[1])
                .to.emit(stakingRewards[2], 'RewardAdded')
                .withArgs(rewardAmounts[2])
                .to.emit(stakingRewards[3], 'RewardAdded')
                .withArgs(rewardAmounts[3])
            });

            it('transfers the reward token to the individual contracts', async() => {
                await rewardToken.transfer(stakingRewardsFactory.address, totalRewardAmount);
                await mineBlock(provider, genesis);
                await stakingRewardsFactory.notifyRewardAmounts();
                for (let i = 0; i < rewardAmounts.length; i++)
                    expect(await rewardToken.balanceOf(stakingRewards[i].address)).to.eq(rewardAmounts[i]);
            });

            it('set rewardAmounts to 0', async() => {
                await rewardToken.transfer(stakingRewardsFactory.address, totalRewardAmount);
                await mineBlock(provider, genesis);

                for (let i = 0; i < stakingTokens.length; i++) {
                    const [, amount] = await stakingRewardsFactory.stakingRewardInfosByStakingToken(stakingTokens[i].address);
                    expect(amount).to.eq(rewardAmounts[i]);
                }

                await stakingRewardsFactory.notifyRewardAmounts();
                for (let i = 0; i < stakingTokens.length; i++) {
                    const [, amount] = await stakingRewardsFactory.stakingRewardInfosByStakingToken(stakingTokens[i].address);
                    expect(amount).to.eq(0);
                }
            });

            it('succeeds when has sufficient balance and genesis time', async() => {
                await rewardToken.transfer(stakingRewardsFactory.address, totalRewardAmount);
                await mineBlock(provider, genesis);
                await stakingRewardsFactory.notifyRewardAmounts();
            })
        })
    })
})

