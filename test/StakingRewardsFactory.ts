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

    context("#deploy", async() => {
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
    })
})

