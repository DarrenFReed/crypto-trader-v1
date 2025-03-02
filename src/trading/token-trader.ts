import { PriceMonitor } from "./priceMonitor";
import { TradeExecutor } from "./tradeExecutor";

export class TokenTrader {
  private tradeActive: boolean = false;
  private priceMonitor: PriceMonitor;
  private tradeExecutor: TradeExecutor;

  constructor(
    private poolId: string,
    private baseToken: string,
    private quoteToken: string,
    rpcUrl: string,
    walletPublicKey: string
  ) {
    this.priceMonitor = new PriceMonitor(baseToken, () => this.getTokenPrice(), (reason) => this.exitTrade(reason));
    this.tradeExecutor = new TradeExecutor(rpcUrl, walletPublicKey);
  }

  async startTrading() {
    console.log(`🚀 Monitoring ${this.baseToken} for trade opportunities.`);
  }

  async enterTrade() {
    if (this.tradeActive) return;

    this.tradeActive = true;
    const priceAtEntry = await this.getTokenPrice();
    console.log(`✅ Entered trade for ${this.baseToken} at price: ${priceAtEntry}`);

    // Execute buy order using Jito
    await this.tradeExecutor.executeBuy(this.poolId, this.baseToken, 1); // Buy 1 unit

    // Start price monitoring in separate module
    this.priceMonitor.start(priceAtEntry);
  }

  async exitTrade(reason: "PROFIT" | "STOP_LOSS") {
    console.log(`📤 Exiting trade for ${this.baseToken}, Reason: ${reason}`);

    // Execute sell order using Jito
    await this.tradeExecutor.executeSell(this.poolId, this.baseToken, 1); // Sell 1 unit

    this.tradeActive = false;
  }

  async getTokenPrice(): Promise<number> {
    return Math.random() * 10; // Placeholder for price fetching logic
  }
}
