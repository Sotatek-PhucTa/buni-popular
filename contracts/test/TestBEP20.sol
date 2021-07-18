pragma solidity=0.6.11;

import "@pancakeswap/pancake-swap-lib/contracts/token/BEP20/BEP20.sol";

contract TestBEP20 is BEP20 {
	constructor(uint256 amount) public BEP20('Test BEP20', 'TEST') {
		_mint(msg.sender, amount);
	}
}