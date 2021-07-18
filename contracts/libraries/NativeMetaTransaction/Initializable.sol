pragma solidity=0.6.11;

contract Initializable {
    bool inited = false;

    modifier initializer() {
        require(!inited, "Already inited");
        _;
        inited = true;
    }
}