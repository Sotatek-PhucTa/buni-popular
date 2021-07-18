pragma solidity=0.6.11;
pragma experimental ABIEncoderV2;

import "@pancakeswap/pancake-swap-lib/contracts/math/SafeMath.sol";
import "@pancakeswap/pancake-swap-lib/contracts/token/BEP20/SafeBEP20.sol";

import "./interfaces/IUniswapV2ERC20.sol";

// Inheritance
import "@pancakeswap/pancake-swap-lib/contracts/utils/ReentrancyGuard.sol";
import './interfaces/IStakingReward.sol';
import './RewardsDistributionRecipient.sol';
import "./libraries/NativeMetaTransaction/NativeMetaTransaction.sol";

contract StakingReward is IStakingReward, RewardsDistributionRecipient, ReentrancyGuard, NativeMetaTransaction {
    using SafeMath for uint256;
    using SafeBEP20 for IBEP20;

    /*======================STATE VARIABLES======================*/
    struct UserVestingInfo {
        bool hasOptForVesting;
        bool hasSetConfig;
    }

    IBEP20 public immutable rewardToken;
    IBEP20 public immutable stakingToken;
    uint256 public immutable rewardDuration;
    uint256 public immutable vestingPeriod;
    uint256 public immutable split;
    uint256 public immutable splitWindow;
    uint256 public lastUpdatedTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalBurnableToken;
    uint256 public periodFinish;
    uint256 public rewardRate;

    mapping(address => uint256) public userRewardPaid;
    mapping(address => UserVestingInfo) public vestingInfoByUser;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public totalEarnedRewards;
    mapping(address => uint256) public hasClaimed;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /*===================EVENTS=========================*/
    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    /*======================MODIFIERS=====================*/
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdatedTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /*==============CONSTRUCTOR=========================*/
    constructor(
        address _rewardDistributor,
        address _rewardToken,
        address _stakingToken,
        uint256 _rewardDuration,
        uint256 _vestingPeriod,
        uint256 _split
    ) public {
        require(_rewardToken != address(0), "Zero reward token");
        require(_rewardDistributor != address(0), "Zero distributor"); 
        require(_stakingToken != address(0), "Zero staking token");
        rewardToken = IBEP20(_rewardToken);
        stakingToken = IBEP20(_stakingToken);
        rewardDistributor = _rewardDistributor;
        rewardDuration = _rewardDuration;
        vestingPeriod = _vestingPeriod;
        split = _split;
        splitWindow = _vestingPeriod.div(_split - 1);
        _initializeEIP712("PopularV1");
    }

    /*=======================VIEWS=========================*/
    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view override returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view override returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored.add(
                lastTimeRewardApplicable().sub(lastUpdatedTime).mul(rewardRate).mul(1e18).div(_totalSupply)
            );
    }

    function earned(address account) public view override returns (uint256) {
        return
            _balances[account].mul(rewardPerToken().sub(userRewardPaid[account])).div(1e18).add(
                rewards[account]
            );
    }

    function getRewardForDuration() external view override returns (uint256) {
        return rewardRate.mul(rewardDuration);
    }

    function getUserVestingInfo(address account) external view returns (UserVestingInfo memory) {
        return vestingInfoByUser[account];
    }

    /*=============================MUTATIVE FUNCTIONS===============================*/
    
    function stakeWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external nonReentrant updateReward(_msgSender()) 
    {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply.add(amount);
        _balances[_msgSender()] = _balances[_msgSender()].add(amount);
        
        IUniswapV2ERC20(address(stakingToken)).permit(_msgSender(), address(this), amount, deadline, v, r, s);

        stakingToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit Staked(_msgSender(), amount);
    }

    function stake(uint256 amount) external override nonReentrant updateReward(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply.add(amount);
        _balances[_msgSender()] = _balances[_msgSender()].add(amount);
        stakingToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit Staked(_msgSender(), amount);
    }

    function withdraw(uint256 amount) public override nonReentrant updateReward(_msgSender()) {
        require(amount > 0, 'Cannot withdraw 0');
        _totalSupply = _totalSupply.sub(amount);
        _balances[_msgSender()] = _balances[_msgSender()].sub(amount);
        stakingToken.safeTransfer(_msgSender(), amount);
        emit Withdrawn(_msgSender(), amount);
    }

    function setVestingConfig(bool _setConfig) external {
        require(block.timestamp <= periodFinish, 'Cannot update vesting schedule now');
        UserVestingInfo storage info = vestingInfoByUser[_msgSender()];
        info.hasSetConfig = true;
        require(hasClaimed[_msgSender()] == 0, 'Cannot change config after claimed');
        info.hasOptForVesting = _setConfig;
    }

    function getReward()  public override nonReentrant updateReward(_msgSender()) {
        require(block.timestamp >= periodFinish, "Cannot claim token now");
        UserVestingInfo storage info = vestingInfoByUser[_msgSender()];
        if (!info.hasSetConfig) {
            info.hasOptForVesting = true;
            info.hasSetConfig = true;
        }

        uint256 reward;
        if (!info.hasOptForVesting) {
            reward = rewards[_msgSender()].div(2);
            totalBurnableToken = totalBurnableToken.add(rewards[_msgSender()].sub(reward));
            rewardToken.safeTransfer(_msgSender(), reward);
            rewards[_msgSender()] = 0;
            hasClaimed[_msgSender()] = split;
            emit RewardPaid(_msgSender(), reward);
        } else {
            uint256 claimedSplits = hasClaimed[_msgSender()];
            uint256 currentDate = block.timestamp;
            uint256 currentSplits = currentDate.sub(periodFinish).div(splitWindow).add(1);
            if (currentSplits > split)
                currentSplits = split;

            if (totalEarnedRewards[_msgSender()] == 0) 
                totalEarnedRewards[_msgSender()] = rewards[_msgSender()];
            
            uint256 totalEarned = totalEarnedRewards[_msgSender()];

            reward = totalEarned.mul(currentSplits.sub(claimedSplits)).div(split);
            
            if (currentSplits > claimedSplits)
                hasClaimed[_msgSender()] = currentSplits;
            if (reward > 0) {
                rewards[_msgSender()] = rewards[_msgSender()].sub(reward);
                rewardToken.safeTransfer(_msgSender(), reward);
                emit RewardPaid(_msgSender(), reward);
            } 
        }
    }

    function exit() external override {
        withdraw(_balances[_msgSender()]);
        if (block.timestamp >= periodFinish) 
            getReward();
    }

    /*==============================RESTRICTED FUNCTIONS==========================*/
    function notifyRewardAmount(uint256 reward) external override onlyRewardDistributor updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward.div(rewardDuration);
        } else {
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = reward.add(leftover).div(rewardDuration);
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = rewardToken.balanceOf(address(this));
        require(rewardRate <= balance.div(rewardDuration), 'Provided reward too high');

        lastUpdatedTime = block.timestamp;
        periodFinish = block.timestamp.add(rewardDuration);
        emit RewardAdded(reward);
    }

    function rescueBurnableFunds(address receiver) external onlyRewardDistributor {
        rewardToken.transfer(receiver, totalBurnableToken);
    }

    function rescueFunds(address tokenAddress, address receiver) external onlyRewardDistributor {
        require(tokenAddress != address(stakingToken), 'StakingRewards: rescue of staking token not allowed');
        IBEP20(tokenAddress).transfer(receiver, IBEP20(tokenAddress).balanceOf(address(this)));
    }
}
