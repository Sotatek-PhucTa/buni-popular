pragma solidity=0.8.4;

contract Initializable {
    bool inited = false;

    modifier initializer() {
        require(!inited, "Already inited");
        _;
        inited = true;
    }
}