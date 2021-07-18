pragma solidity=0.6.11;

import "@pancakeswap/pancake-swap-lib/contracts/token/BEP20/IBEP20.sol";
import "@pancakeswap/pancake-swap-lib/contracts/access/Ownable.sol";

import "./StakingReward.sol";


contract StakingRewardsFactory is Ownable {

    /*===========================STATE VARIABLES======================*/
    struct StakingRewardsInfo {
        address stakingRewards;
        uint256 rewardAmount;
        uint256 rewardDuration;
        uint256 vestingPeriod;
        uint256 split;
    }
    address public immutable rewardToken;
    uint256 public immutable stakingRewardGenesis;

    address[] public stakingTokens;

    mapping(address => StakingRewardsInfo) public stakingRewardInfosByStakingToken;

    /*===========================CONSTRUCTORS===========================*/
    constructor(address _rewardToken, uint256 _stakingRewardGenesis) public {
        require(_stakingRewardGenesis >= block.timestamp, "genesis too soon");
        require(_rewardToken != address(0), "Zero rewardToken");
        
        rewardToken = _rewardToken;
        stakingRewardGenesis = _stakingRewardGenesis;
    }

    function deploy(
        address stakingToken,
        uint256 rewardAmount,
        uint256 rewardDuration,
        uint256 vestingPeriod,
        uint256 split
    ) public onlyOwner {
        require(stakingToken != address(0), "Zero stakingToken");
        StakingRewardsInfo storage info = stakingRewardInfosByStakingToken[stakingToken];
        require(info.stakingRewards == address(0), "already deployed"); 

        info.stakingRewards = address(
            new StakingReward(
                address(this),
                rewardToken,
                stakingToken,
                rewardDuration,
                vestingPeriod,
                split 
            )
        );
        info.rewardAmount = rewardAmount;
        info.rewardDuration = rewardDuration;
        info.vestingPeriod = vestingPeriod;
        info.split = split;
        stakingTokens.push(stakingToken);
    }

    function notifyRewardAmounts() public {
        require(stakingTokens.length > 0, 'called before any deploys');
        for (uint256 i = 0; i < stakingTokens.length; i++) {
            notifyRewardAmount(stakingTokens[i]);
        }
    }

    function notifyRewardAmount(address stakingToken) public {
        require(block.timestamp >= stakingRewardGenesis, 'not ready');

        StakingRewardsInfo storage info = stakingRewardInfosByStakingToken[stakingToken];
        require(info.stakingRewards != address(0), 'not deployed');

        if (info.rewardAmount > 0) {
            uint256 rewardAmount = info.rewardAmount;
            info.rewardAmount = 0;

            require(
                IBEP20(rewardToken).transfer(info.stakingRewards, rewardAmount),
                'transfer failed'
            );
            StakingReward(info.stakingRewards).notifyRewardAmount(rewardAmount);
        }
    }

    function rescueFunds(address stakingToken, address tokenAddress) public onlyOwner {
        StakingRewardsInfo storage info = stakingRewardInfosByStakingToken[stakingToken];
        require(info.stakingRewards != address(0), 'not deployed');
        StakingReward(info.stakingRewards).rescueFunds(tokenAddress, msg.sender);
    }

    function rescueBurnableFunds(address stakingToken) public onlyOwner {
        StakingRewardsInfo storage info = stakingRewardInfosByStakingToken[stakingToken];
        require(info.stakingRewards != address(0), 'not deployed');
        StakingReward(info.stakingRewards).rescueBurnableFunds(msg.sender);
    }

    // Rescue leftover funds from factory
    function rescueFactoryFunds(address tokenAddress) public onlyOwner {
        IBEP20 token = IBEP20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, 'No balance for given token address');
        token.transfer(msg.sender, balance);
    }
}