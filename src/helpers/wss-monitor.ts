import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';
import { PrismaClient } from '@prisma/client';

// Constants
const HEALTH_CHECK_INTERVAL = 60000; // Check health every minute
const RESPONSE_TIME_THRESHOLD = 5000; // Flag responses taking longer than 5 seconds
const LOG_INTERVAL = 10000; // Log stats every 10 seconds

// Monitoring stats
interface MonitoringStats {
  startTime: number;
  totalEvents: number;
  pumpTokenEvents: number;
  nonPumpTokenEvents: number;
  missedEvents: number; // Estimated missed events
  lastEventTime: number | null;
  slowResponses: number;
  responseTimes: number[]; // Store last 100 response times
  disconnections: number;
  lastReconnectTime: number | null;
}

export class WssMonitor {
  private connection: Connection;
  private monitoringStats: MonitoringStats;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private logStatsInterval: NodeJS.Timeout | null = null;
  private rayFee: PublicKey;
  private prisma: PrismaClient;
  
  constructor(connection: Connection, rayFee: PublicKey, prisma: PrismaClient) {
    this.connection = connection;
    this.rayFee = rayFee;
    this.prisma = prisma;
    
    this.monitoringStats = {
      startTime: Date.now(),
      totalEvents: 0,
      pumpTokenEvents: 0,
      nonPumpTokenEvents: 0,
      missedEvents: 0,
      lastEventTime: null,
      slowResponses: 0,
      responseTimes: [],
      disconnections: 0,
      lastReconnectTime: null
    };
  }

  public start(): void {
    console.log(chalk.blue('🔍 Starting WSS Connection Monitoring...'));
    
    // Start health check interval
    this.healthCheckInterval = setInterval(() => this.checkConnectionHealth(), HEALTH_CHECK_INTERVAL);
    
    // Start stats logging interval
    this.logStatsInterval = setInterval(() => this.logStats(), LOG_INTERVAL);
  }

  public stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.logStatsInterval) {
      clearInterval(this.logStatsInterval);
      this.logStatsInterval = null;
    }
    
    console.log(chalk.blue('🛑 Stopped WSS Connection Monitoring'));
    this.logStats(true); // Log final stats
  }

  public trackEvent(isPumpToken: boolean, responseTime: number): void {
    const now = Date.now();
    
    this.monitoringStats.totalEvents++;
    if (isPumpToken) {
      this.monitoringStats.pumpTokenEvents++;
    } else {
      this.monitoringStats.nonPumpTokenEvents++;
    }
    
    // Track response time
    this.monitoringStats.responseTimes.push(responseTime);
    if (this.monitoringStats.responseTimes.length > 100) {
      this.monitoringStats.responseTimes.shift(); // Keep only last 100
    }
    
    // Check if response is slow
    if (responseTime > RESPONSE_TIME_THRESHOLD) {
      this.monitoringStats.slowResponses++;
      console.log(chalk.yellow(`⚠️ Slow response detected: ${responseTime}ms for ${isPumpToken ? 'Pump.fun' : 'non-Pump.fun'} token`));
    }
    
    // Estimate missed events based on gaps
    if (this.monitoringStats.lastEventTime) {
      const timeSinceLastEvent = now - this.monitoringStats.lastEventTime;
      // If gap is unusually large (> 2 minutes), might indicate missed events
      if (timeSinceLastEvent > 120000) {
        const estimatedMissed = Math.floor(timeSinceLastEvent / 60000); // Rough estimate
        this.monitoringStats.missedEvents += estimatedMissed;
        console.log(chalk.yellow(`⚠️ Possible missed events detected. ${timeSinceLastEvent}ms gap between events.`));
      }
    }
    
    this.monitoringStats.lastEventTime = now;
  }

  public recordDisconnection(): void {
    this.monitoringStats.disconnections++;
    this.monitoringStats.lastReconnectTime = Date.now();
    console.log(chalk.red('🔌 WSS disconnection detected'));
  }

  private async checkConnectionHealth(): Promise<void> {
    try {
      // Check if we can still make RPCs to the node
      const startTime = Date.now();
      const blockHeight = await this.connection.getBlockHeight();
      const responseTime = Date.now() - startTime;
      
      console.log(chalk.blue(`🔍 Health check: Current block height ${blockHeight}, response time: ${responseTime}ms`));
      
      // Check for active subscriptions
      const subscriptions = await this.connection.getSignaturesForAddress(this.rayFee, { limit: 1 });
      const tokenCount = await this.prisma.token.count({
        where: { tokenStatus: { in: ['ACTIVE', 'BUY_CANDIDATE', 'WAITING_FOR_POOL', 'POOL_FOUND', 'BOUGHT'] } },
      });
      
      console.log(chalk.blue(`📊 Current monitoring status: ${tokenCount} tokens being monitored`));
      
      // If response time is too high, we might have connection issues
      if (responseTime > 10000) {
        console.log(chalk.yellow('⚠️ Slow connection response time detected during health check'));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Health check failed: ${error}`));
      this.recordDisconnection();
    }
  }

  private logStats(isFinal: boolean = false): void {
    const now = Date.now();
    const runTime = (now - this.monitoringStats.startTime) / 1000 / 60; // In minutes
    const avgEventsPerMinute = this.monitoringStats.totalEvents / runTime;
    
    // Calculate average response time
    const avgResponseTime = this.monitoringStats.responseTimes.length > 0 
      ? this.monitoringStats.responseTimes.reduce((a, b) => a + b, 0) / this.monitoringStats.responseTimes.length 
      : 0;
    
    console.log(chalk.cyan('📊 WSS Monitoring Statistics:'));
    console.log(chalk.cyan(`⏱️  Running for: ${runTime.toFixed(2)} minutes`));
    console.log(chalk.cyan(`📝 Total events: ${this.monitoringStats.totalEvents} (${avgEventsPerMinute.toFixed(2)}/minute)`));
    console.log(chalk.cyan(`🎯 Pump.fun tokens: ${this.monitoringStats.pumpTokenEvents}`));
    console.log(chalk.cyan(`⏭️  Non-Pump.fun tokens: ${this.monitoringStats.nonPumpTokenEvents}`));
    console.log(chalk.cyan(`⚡ Average response time: ${avgResponseTime.toFixed(2)}ms`));
    console.log(chalk.cyan(`🐢 Slow responses: ${this.monitoringStats.slowResponses}`));
    console.log(chalk.cyan(`🔌 Disconnections: ${this.monitoringStats.disconnections}`));
    
    if (this.monitoringStats.missedEvents > 0) {
      console.log(chalk.yellow(`⚠️ Estimated missed events: ${this.monitoringStats.missedEvents}`));
    }
    
    if (isFinal) {
      console.log(chalk.green('🏁 Final WSS monitoring statistics recorded'));
    }
  }
}

// Example implementation to be integrated into your existing code:
/*
// Initialize the monitor
const wssMonitor = new WssMonitor(newTokenConnection, rayFee, prisma);
wssMonitor.start();

// In your onLogs callback:
const startProcessingTime = Date.now();
// ... your existing processing code ...
const processingTime = Date.now() - startProcessingTime;
wssMonitor.trackEvent(baseAddress.endsWith('pump'), processingTime);

// If you detect a disconnection or need to reconnect:
wssMonitor.recordDisconnection();

// When shutting down:
wssMonitor.stop();
*/