import chai, { expect } from 'chai';
import { Contract, BigNumber } from 'ethers';
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle';

import { mineBlock, REWARD_DURATION, VESTING, SPLIT } from './util';


chai.use(solidity);

it("Some stuff", async() => {
    expect(1 + 1).equals(2);
})
