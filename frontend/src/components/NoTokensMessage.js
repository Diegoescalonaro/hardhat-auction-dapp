import React from "react";

export function NoTokensMessage({ selectedAddress }) {
  return (
    <div className="alert alert-danger" role="alert">
      You don't have enough balance to bid in the auction.
      <br />
      To get some tokens, open a terminal in the root of the repository and run:
      <br />
      <br />
      <code>npx hardhat --network localhost faucet {selectedAddress}</code>
    </div>
  );
}
