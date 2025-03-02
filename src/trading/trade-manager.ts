import { TokenTrader } from "./tokenTrader";

export class TradeManager {
  private activeTraders: Map<string, TokenTrader> = new Map();
  private rpcUrl: string;
  private walletPublicKey: string;

  constructor(rpcUrl: string, walletPublicKey: string) {
    this.rpcUrl = rpcUrl;
    this.walletPublicKey = walletPublicKey;
  }

  addToken(poolId: string, baseToken: string, quoteToken: string) {
    if (this.activeTraders.has(poolId)) {
      console.log(`⚠️ Already tracking ${baseToken}`);
      return;
    }

    const trader = new TokenTrader(poolId, baseToken, quoteToken, this.rpcUrl, this.walletPublicKey);
    this.activeTraders.set(poolId, trader);
    trader.startTrading();
  }
}
