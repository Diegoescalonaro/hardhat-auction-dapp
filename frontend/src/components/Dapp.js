import React from "react";
import "./Dapp.css";

// We'll use ethers to interact with the Ethereum network and our contract
import { ethers } from "ethers";

// We import the contract's artifacts and address here, as we are going to be
// using them with ethers
import AuctionArtifact from "../contracts/Auction.json";
import contractAddress from "../contracts/contract-address.json";

// All the logic of this dapp is contained in the Dapp component.
// These other components are just presentational ones: they don't have any
// logic. They just render HTML.
import { NoWalletDetected } from "./NoWalletDetected";
import { ConnectWallet } from "./ConnectWallet";
import { Loading } from "./Loading";
import { TransactionErrorMessage } from "./TransactionErrorMessage";
import { WaitingForTransactionMessage } from "./WaitingForTransactionMessage";
import { NoTokensMessage } from "./NoTokensMessage";

// This is the default id used by the Hardhat Network
const HARDHAT_NETWORK_ID = "31337";

// This is an error code that indicates that the user canceled a transaction
const ERROR_CODE_TX_REJECTED_BY_USER = 4001;

// This component is in charge of doing these things:
//   1. It connects to the user's wallet
//   2. Initializes ethers and the Token contract
//   3. Polls the user balance to keep it updated.
//   4. Transfers tokens by sending transactions
//   5. Renders the whole application
//
// Note that (3) and (4) are specific of this sample application, but they show
// you how to keep your Dapp and contract's state in sync,  and how to send a
// transaction.
export class Dapp extends React.Component {
  constructor(props) {
    super(props);

    // We store multiple things in Dapp's state.
    // You don't need to follow this pattern, but it's an useful example.
    this.initialState = {
      // The user's address and balance
      selectedAddress: undefined,
      balance: undefined,
      // The ID about transactions being sent, and any possible error with them
      txBeingSent: undefined,
      transactionError: undefined,
      networkError: undefined,
      // Auction information
      auctionInfo: undefined,
      description: undefined,
      highestPrice: undefined,
      highestBidder: undefined,
      basePrice: undefined,
      originalOwner: undefined,
      newOwner: undefined,
      isActive: undefined,
    };

    this.state = this.initialState;
  }

  async _connectWallet() {
    // This method is run when the user clicks the Connect. It connects the
    // dapp to the user's wallet, and initializes it.

    // To connect to the user's wallet, we have to run this method.
    // It returns a promise that will resolve to the user's address.
    const [selectedAddress] = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    // Once we have the address, we can initialize the application.

    // First we check the network
    await this._checkNetwork();
    await this._initialize(selectedAddress);

    // We reinitialize it whenever the user changes their account.
    window.ethereum.on("accountsChanged", ([newAddress]) => {
      this._stopPollingData();
      // `accountsChanged` event can be triggered with an undefined newAddress.
      // This happens when the user removes the Dapp from the "Connected
      // list of sites allowed access to your addresses" (Metamask > Settings > Connections)
      // To avoid errors, we reset the dapp state
      if (newAddress === undefined) {
        return this._resetState();
      }
      this._initialize(newAddress);
    });
  }

  async _initialize(userAddress) {
    // This method initializes the dapp

    // We first store the user's address in the component's state
    this.setState({
      selectedAddress: userAddress,
    });

    // Then, we initialize ethers, fetch the auction's data, and start polling
    // for the user's balance.
    await this._initializeEthers();
    await this._getAuctionData();
    await this._updateBalance();
    await this._startPollingData();
  }

  async _initializeEthers() {
    // We first initialize ethers by creating a provider using window.ethereum
    this._provider = new ethers.providers.Web3Provider(window.ethereum);

    // Then, we initialize the contract using that provider and the auction's
    // artifact. You can do this same thing with your contracts.
    this._auction = new ethers.Contract(
      contractAddress.Auction,
      AuctionArtifact.abi,
      this._provider.getSigner(0)
    );
  }

  // The next two methods are needed to start and stop polling data. While
  // the data being polled here is specific to this example, you can use this
  // pattern to read any data from your contracts.

  // Note that if you don't need it to update in near real time, you probably
  // don't need to poll it. If that's the case, you can just fetch it when you
  // initialize the app, as we do with the token data.
  _startPollingData() {
    this._pollDataInterval = setInterval(() => {
      this._getAuctionData();
      this._updateBalance();
    }, 4000); // polling every 4 seconds

    // We run it once immediately so we don't have to wait for it
    this._getAuctionData();
  }

  _stopPollingData() {
    clearInterval(this._pollDataInterval);
    this._pollDataInterval = undefined;
  }

  componentWillUnmount() {
    // We poll the user's balance, so we have to stop doing that when Dapp
    // gets unmounted
    this._stopPollingData();
  }

  // ------------- GET AUCTION DATA -------------
  // The next method just read from the contract
  // and store the results in the component state.
  async _getAuctionData() {
    console.log("Fetching and updating auction data...");
    const auctionInfo = await this._auction.getAuctionInfo();
    const description = auctionInfo?.[0];
    const createdAt = auctionInfo?.[1].toString();
    const duration = auctionInfo?.[2].toString();
    const highestPrice = (await this._auction.getHighestPrice()).toString();
    const highestBidder = await this._auction.getHighestBidder();
    const basePrice = (await this._auction.getBasePrice()).toString();
    const originalOwner = await this._auction.originalOwner();
    const newOwner = await this._auction.newOwner();
    const isActive = await this._auction.isActive();
    this.setState({
      auctionInfo,
      description,
      highestPrice,
      highestBidder,
      basePrice,
      originalOwner,
      newOwner,
      createdAt,
      duration,
      isActive,
    });
  }

  // ------------- GET ACCOUNT BALANCE -------------
  // The next method just read the balance from the network
  // and store the results in the component state.
  async _updateBalance() {
    console.log("Fetching and updating account balance...");
    const balance = await this._provider.getBalance(this.state.selectedAddress);
    const wei = balance.toString();
    const ether = ethers.utils.formatEther(wei);
    this.setState({ balance: ether });
  }

  // ------------- BID -------------
  // This method sends an ethereum transaction to bid in the auction.
  // While this action is specific to this application,
  // it illustrates how to send a transaction.
  async _bid(amount) {
    // Sending a transaction is a complex operation:
    //   - The user can reject it
    //   - It can fail before reaching the ethereum network (i.e. if the user
    //     doesn't have ETH for paying for the tx's gas)
    //   - It has to be mined, so it isn't immediately confirmed.
    //     Note that some testing networks, like Hardhat Network, do mine
    //     transactions immediately, but your dapp should be prepared for
    //     other networks.
    //   - It can fail once mined.
    //
    // This method handles all of those things, so keep reading to learn how to
    // do it.

    try {
      // If a transaction fails, we save that error in the component's state.
      // We only save one such error, so before sending a second transaction, we
      // clear it.
      this._dismissTransactionError();

      // We send the transaction, and save its hash in the Dapp's state. This
      // way we can indicate that we are waiting for it to be mined.
      const tx = await this._auction.bid({
        value: ethers.utils.parseEther(amount),
      });
      this.setState({ txBeingSent: tx.hash });

      // We use .wait() to wait for the transaction to be mined. This method
      // returns the transaction's receipt.
      const receipt = await tx.wait();

      // The receipt, contains a status flag, which is 0 to indicate an error.
      if (receipt.status === 0) {
        // We can't know the exact error that made the transaction fail when it
        // was mined, so we throw this generic one.
        throw new Error("Transaction failed");
      }

      // If we got here, the transaction was successful, so you may want to
      // update your state. Here, we update the auction's information.
      await this._getAuctionData();
    } catch (error) {
      // We check the error code to see if this error was produced because the
      // user rejected a tx. If that's the case, we do nothing.
      if (error.code === ERROR_CODE_TX_REJECTED_BY_USER) {
        return;
      }

      // Other errors are logged and stored in the Dapp's state. This is used to
      // show them to the user, and for debugging.
      console.error(error);
      this.setState({ transactionError: error });
    } finally {
      // If we leave the try/catch, we aren't sending a tx anymore, so we clear
      // this part of the state.
      this.setState({ txBeingSent: undefined });
    }
  }

  // ------------- STOP AUCTION -------------
  // This method sends an ethereum transaction to stop the auction,
  // and fetch the auction data to store the results in the component state.
  async _stopAuction() {
    try {
      // If a transaction fails, we save that error in the component's state.
      // We only save one such error, so before sending a second transaction, we
      // clear it.
      this._dismissTransactionError();

      // We send the transaction, and save its hash in the Dapp's state. This
      // way we can indicate that we are waiting for it to be mined.
      const tx = await this._auction.stopAuction();
      this.setState({ txBeingSent: tx.hash });

      // We use .wait() to wait for the transaction to be mined. This method
      // returns the transaction's receipt.
      const receipt = await tx.wait();

      // The receipt, contains a status flag, which is 0 to indicate an error.
      if (receipt.status === 0) {
        // We can't know the exact error that made the transaction fail when it
        // was mined, so we throw this generic one.
        throw new Error("Transaction failed");
      }

      // If we got here, the transaction was successful, so you may want to
      // update your state. Here, we update the user's balance.
      await this._getAuctionData();
    } catch (error) {
      // We check the error code to see if this error was produced because the
      // user rejected a tx. If that's the case, we do nothing.
      if (error.code === ERROR_CODE_TX_REJECTED_BY_USER) {
        return;
      }

      // Other errors are logged and stored in the Dapp's state. This is used to
      // show them to the user, and for debugging.
      console.error(error);
      // console.error(error.error?.data?.data?.message);
      // console.log(this._auction.interface.parseError(error.error?.data?.data));
      this.setState({ transactionError: error });
    } finally {
      // If we leave the try/catch, we aren't sending a tx anymore, so we clear
      // this part of the state.
      this.setState({ txBeingSent: undefined });
    }
  }

  // This method just clears part of the state.
  _dismissTransactionError() {
    this.setState({ transactionError: undefined });
  }

  // This method just clears part of the state.
  _dismissNetworkError() {
    this.setState({ networkError: undefined });
  }

  // This is an utility method that turns an RPC error into a human readable
  // message.
  _getRpcErrorMessage(error) {
    if (error.data) {
      return error.data.message;
    }

    return error.message;
  }

  // This method resets the state
  _resetState() {
    this.setState(this.initialState);
  }

  async _switchChain() {
    const chainIdHex = `0x${HARDHAT_NETWORK_ID.toString(16)}`;
    console.log(chainIdHex);
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: "Hardhat testnet",
          rpcUrls: ["http://127.0.0.1:8545"],
        },
      ],
    });
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    await this._initialize(this.state.selectedAddress);
  }

  // This method checks if the selected network is Localhost:8545
  async _checkNetwork() {
    if (window.ethereum.networkVersion !== HARDHAT_NETWORK_ID) {
      this._switchChain();
    }
    this.setState({ networkId: window.ethereum.networkVersion });
  }

  render() {
    // Ethereum wallets inject the window.ethereum object. If it hasn't been
    // injected, we instruct the user to install a wallet.
    if (window.ethereum === undefined) {
      return <NoWalletDetected />;
    }

    // The next thing we need to do, is to ask the user to connect their wallet.
    // When the wallet gets connected, we are going to save the users's address
    // in the component's state. So, if it hasn't been saved yet, we have
    // to show the ConnectWallet component.
    //
    // Note that we pass it a callback that is going to be called when the user
    // clicks a button. This callback just calls the _connectWallet method.
    if (!this.state.selectedAddress) {
      return (
        <ConnectWallet
          connectWallet={() => this._connectWallet()}
          networkError={this.state.networkError}
          dismiss={() => this._dismissNetworkError()}
        />
      );
    }

    // If the user's balance hasn't loaded yet, we show a loading component.
    if (!this.state.auctionInfo) {
      return <Loading />;
    }

    // If everything is loaded, we render the application.
    return (
      <div className="container p-4">
        <h1 className="App-title">Welcome to the auction </h1>

        {/* ---------- Context Information: Account & Network ---------- */}
        <div className="Context-information">
          <p> Contract address: {contractAddress.Auction ?? ""}</p>
          <p> Your address: {this.state.selectedAddress ?? ""}</p>
          <p>Your balance: {this.state.balance ?? 0} Ether</p>
          {/*
              If the user has no balance, we don't show the Transfer form
            */}
          {this.state.balance === "0.0" && (
            <NoTokensMessage selectedAddress={this.state.selectedAddress} />
          )}
        </div>

        {/* -------------------- Auction information -------------------- */}
        <h2 className="App-subtitle" id="inline">
          Auction information
        </h2>
        <button
          className="btn btn-info"
          type="button"
          onClick={() => this._getAuctionData()}
        >
          GET AUCTION INFO
        </button>

        {this.state.auctionInfo && (
          <div className="Auction-information">
            <div className="Auction-information-img">
              {/* Auction Image */}
              <img
                width="80%"
                src="https://bafybeifzm6xqduwgl6lwjyabj2v5qwduwqgotr6hjj5cu632ldtu6zbw4a.ipfs.nftstorage.link/"
              />
              <br />

              {/* Basic Information */}
            </div>
            <div className="Auction-information-text">
              <p>
                <b className="Auction-info-title">Description </b>
                {this.state.description}
              </p>
              <p>
                <b className="Auction-info-title">Created at </b>
                {`${new Date(this.state.createdAt * 1000).toUTCString()} `}
              </p>
              <p>
                <b className="Auction-info-title">Duration </b>
                {`${this.state.duration} seconds `}
                {`(${this.state.duration / 60} minutes)`}
              </p>

              {/* More information */}
              <p>
                <b className="Auction-info-title">Base price </b>
                {ethers.utils.formatEther(this.state.basePrice)} Ether
              </p>
              <p>
                <b className="Auction-info-title">Highest Bidder </b>
                {this.state.highestBidder}
              </p>
              <p>
                <b className="Auction-info-title">Highest Price </b>
                {ethers.utils.formatEther(this.state.highestPrice)} Ether
              </p>
              <p>
                <b className="Auction-info-title">Original Owner </b>
                {this.state.originalOwner}
              </p>
              <p>
                <b className="Auction-info-title">New Owner </b>
                {this.state.newOwner}
              </p>
              <p>
                <b className="Auction-info-title">Status </b>
                <a
                  style={{
                    color: this.state.isActive ? "green" : "red",
                    fontWeight: "600",
                  }}
                >
                  {`${
                    this.state.isActive
                      ? "STILL ACTIVE!! ✅ 🤩"
                      : "NOT ACTIVE ❌ 😭"
                  }`}
                </a>
              </p>
            </div>
          </div>
        )}

        {/* -------------------- Auction actions -------------------- */}
        <h2 className="App-subtitle">Auction actions</h2>
        <div className="Auction-actions">
          {/* Input & Button to bid */}
          <input
            placeholder="Insert value in Ether"
            onChange={(e) => this.setState({ value: e.target.value })}
            type="number"
            style={{ padding: "5px 10px 5px 10px", width: "300px" }}
          ></input>
          <button
            className="btn btn-success"
            type="button"
            style={{ margin: "5px" }}
            onClick={() => this._bid(this.state.value)}
          >
            BID
          </button>

          {/* Button to stop auction */}
          <button
            className="btn btn-danger"
            type="button"
            style={{ margin: "5px" }}
            onClick={() => this._stopAuction()}
          >
            STOP AUCTION
          </button>

          {/* Helper to convert wei to ether */}
          {this.state.value && (
            <p>You're gonna bid: {this.state.value ?? 0} Ether</p>
          )}
        </div>

        <div className="row">
          <div className="col-12">
            {/* 
              Sending a transaction isn't an immediate action. You have to wait
              for it to be mined.
              If we are waiting for one, we show a message here.
            */}
            {this.state.txBeingSent && (
              <WaitingForTransactionMessage txHash={this.state.txBeingSent} />
            )}

            {/* 
              Sending a transaction can fail in multiple ways. 
              If that happened, we show a message here.
            */}
            {this.state.transactionError && (
              <TransactionErrorMessage
                message={this._getRpcErrorMessage(this.state.transactionError)}
                dismiss={() => this._dismissTransactionError()}
              />
            )}
          </div>
        </div>

        <br />
        <br />
      </div>
    );
  }
}
