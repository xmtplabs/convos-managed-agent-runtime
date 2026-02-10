---
name: bankr
description: AI-powered crypto trading agent via natural language. Use when the user wants to trade crypto (buy/sell/swap tokens), check portfolio balances, view token prices, transfer crypto, manage NFTs, use leverage, bet on Polymarket, deploy tokens, set up automated trading strategies, submit raw transactions, execute calldata, or send transaction JSON. Supports Base, Ethereum, Polygon, Solana, and Unichain. Comprehensive capabilities include trading, portfolio management, market research, NFT operations, prediction markets, leverage trading, DeFi operations, automation, and arbitrary transaction submission.
metadata:
  {
    "clawdbot": {
      "emoji": "📺",
      "homepage": "https://bankr.bot",
      "requires": { "bins": ["curl", "jq"] },
    },
  }
---

# Bankr

Execute crypto trading and DeFi operations using natural language through Bankr's AI agent API.

## Agent behavior

- The Bankr wallet **private key is already stored** in config (or env). Never ask the user to paste it or to share private keys.
- If the user asks for "your bankr address", "check your address", "my address", or similar: **call `bankr_deposit_address`** and report the result. They mean the Concierge/Bankr wallet—do not say you have no wallet.
- You may derive and share **only the public deposit address** from existing config so the user can fund the wallet. Use the `bankr_deposit_address` tool to get it, then tell the user "Your deposit address is 0x…".
- If the user says they "added", "set", or "configured" `BANKR_WALLET_PRIVATE_KEY` (or similar), treat that as setup confirmation: say that Bankr is configured and offer to share their deposit address via `bankr_deposit_address`. Do not refuse or say you cannot accept keys—the key is in config, not in the chat.
- For balance checks, trades, portfolio, prices, and any other Bankr request: use the `bankr_query` tool with the user's request as the `prompt` (e.g. "What is my ETH balance on Base?").
- When the user says they **just sent** funds (USDC, ETH, etc.) and asks to **check**, **confirm**, or **see if it arrived**: use `bankr_query` with a balance/portfolio prompt (e.g. "What is my USDC balance?" or "What are my token balances?") and report the result. Do not say you cannot check—Bankr returns the wallet balances.

### Deposit address

When the user asks for **their** wallet address, **your** Bankr address, "check your bankr address", "my address", where to send funds, or whether they have a wallet: **always call `bankr_deposit_address`**. The user means the Bankr wallet that Concierge uses (stored in config). Do not answer that you have no wallet—use the tool and report the address or the error. If the tool returns an address, share that 0x address. If it returns an error (e.g. Bankr not configured), explain briefly and suggest setting `BANKR_API_KEY` and running skill-setup.

### Check after user sends funds

If the user says they just sent funds and asks "can you check" or "did it arrive", call `bankr_query` with e.g. "What are my token balances?" or "What is my USDC balance?" and tell them what the tool returned. Do not say you cannot check—Bankr returns the wallet balances.

## Quick Start

### First-Time Setup

On first run (when `BANKR_API_KEY` is set and skill-setup runs), a wallet private key is generated and stored in config; fund that wallet's address to send from it.

There are two ways to get started:

#### Option A: User provides an existing API key

If the user already has a Bankr API key, they can provide it directly:

```bash
mkdir -p ~/.clawdbot/skills/bankr
cat > ~/.clawdbot/skills/bankr/config.json << 'EOF'
{
  "apiKey": "bk_YOUR_KEY_HERE",
  "apiUrl": "https://api.bankr.bot"
}
EOF
```

API keys can be created and managed at [bankr.bot/api](https://bankr.bot/api). The key must have **Agent API** access enabled.

#### Option B: Create a new account (guided by Clawd)

Clawd can walk the user through the full signup flow:

1. **Sign up / Sign in** — User provides their email address. Bankr sends a one-time passcode (OTP) to that email. Creating a new account automatically provisions **EVM wallets** (Base, Ethereum, Polygon, Unichain) and a **Solana wallet** — no manual wallet setup needed.
2. **Enter OTP** — User checks their email and provides the OTP code.
3. **Generate API key** — Once authenticated, navigate to [bankr.bot/api](https://bankr.bot/api) to create an API key with **Agent API** access enabled.
4. **Configure** — Save the key (starts with `bk_`) to config:

```bash
mkdir -p ~/.clawdbot/skills/bankr
cat > ~/.clawdbot/skills/bankr/config.json << 'EOF'
{
  "apiKey": "bk_YOUR_KEY_HERE",
  "apiUrl": "https://api.bankr.bot"
}
EOF
```

#### Verify Setup

Use the `bankr_query` tool with prompt "What is my balance?" (or ask the user to try a balance/portfolio request in chat).

## Core Usage

### Simple Query

Use the `bankr_query` tool with the user's request as the prompt:

- Balance: `bankr_query` with prompt "What is my ETH balance?" or "What is my ETH balance on Base?"
- Prices: `bankr_query` with prompt "What's the price of Bitcoin?"
- Portfolio: `bankr_query` with prompt "Show my portfolio"

The tool submits the prompt to Bankr, polls until done, and returns the result.

### Manual Job Control

For advanced use or long-running operations:

```bash
# Submit and get job ID
JOB_ID=$(scripts/bankr-submit.sh "Buy $100 of ETH" | jq -r '.jobId')

# Poll for status
scripts/bankr-status.sh "$JOB_ID"

# Cancel if needed
scripts/bankr-cancel.sh "$JOB_ID"
```

## Capabilities Overview

### Trading Operations

- **Token Swaps**: Buy/sell/swap tokens across chains
- **Cross-Chain**: Bridge tokens between chains
- **Limit Orders**: Execute at target prices
- **Stop Loss**: Automatic sell protection
- **DCA**: Dollar-cost averaging strategies
- **TWAP**: Time-weighted average pricing

### Portfolio Management

- Check balances across all chains
- View USD valuations
- Track holdings by token or chain
- Real-time price updates
- Multi-chain aggregation

### Market Research

- Token prices and market data
- Technical analysis (RSI, MACD, etc.)
- Social sentiment analysis
- Price charts
- Trending tokens
- Token comparisons

### Transfers

- Send to addresses, ENS, or social handles
- Multi-chain support
- Flexible amount formats
- Social handle resolution (Twitter, Farcaster, Telegram)

### NFT Operations

- Browse and search collections
- View floor prices and listings
- Purchase NFTs via OpenSea
- View your NFT portfolio
- Transfer NFTs
- Mint from supported platforms

### Polymarket Betting

- Search prediction markets
- Check odds
- Place bets on outcomes
- View positions
- Redeem winnings

### Leverage Trading

- Long/short positions (up to 50x crypto, 100x forex/commodities)
- Crypto, forex, and commodities
- Stop loss and take profit
- Position management via Avantis on Base

### Token Deployment

- **EVM (Base)**: Deploy ERC20 tokens via Clanker with customizable metadata and social links
- **Solana**: Launch SPL tokens via Raydium LaunchLab with bonding curve and auto-migration to CPMM
- Creator fee claiming on both chains
- Fee Key NFTs for Solana (50% LP trading fees post-migration)
- Optional fee recipient designation with 99.9%/0.1% split (Solana)
- Both creator AND fee recipient can claim bonding curve fees (gas sponsored)
- Optional vesting parameters (Solana)
- Rate limits: 1/day standard, 10/day Bankr Club (gas sponsored within limits)

### Automation

- Limit orders
- Stop loss orders
- DCA (dollar-cost averaging)
- TWAP (time-weighted average price)
- Scheduled commands

### Arbitrary Transactions

- Submit raw EVM transactions with explicit calldata
- Custom contract calls to any address
- Execute pre-built calldata from other tools
- Value transfers with data

## Supported Chains

| Chain | Native Token | Best For | Gas Cost |
| -------- | ------------ | ----------------------------- | -------- |
| Base | ETH | Memecoins, general trading | Very Low |
| Polygon | MATIC | Gaming, NFTs, frequent trades | Very Low |
| Ethereum | ETH | Blue chips, high liquidity | High |
| Solana | SOL | High-speed trading | Minimal |
| Unichain | ETH | Newer L2 option | Very Low |

## Common Patterns

### Check Before Trading

```bash
# Check balance
scripts/bankr.sh "What is my ETH balance on Base?"

# Check price
scripts/bankr.sh "What's the current price of PEPE?"

# Then trade
scripts/bankr.sh "Buy $20 of PEPE on Base"
```

### Portfolio Review

```bash
# Full portfolio
scripts/bankr.sh "Show my complete portfolio"

# Chain-specific
scripts/bankr.sh "What tokens do I have on Base?"

# Token-specific
scripts/bankr.sh "Show my ETH across all chains"
```

### Set Up Automation

```bash
# DCA strategy
scripts/bankr.sh "DCA $100 into ETH every week"

# Stop loss protection
scripts/bankr.sh "Set stop loss for my ETH at $2,500"

# Limit order
scripts/bankr.sh "Buy ETH if price drops to $3,000"
```

### Market Research

```bash
# Price and analysis
scripts/bankr.sh "Do technical analysis on ETH"

# Trending tokens
scripts/bankr.sh "What tokens are trending on Base?"

# Compare tokens
scripts/bankr.sh "Compare ETH vs SOL"
```

## API Workflow

Bankr uses an asynchronous job-based API:

1. **Submit** - Send prompt, get job ID
2. **Poll** - Check status every 2 seconds
3. **Complete** - Process results when done

### Synchronous Endpoints

For direct signing and transaction submission, Bankr also provides synchronous endpoints:

- **POST /agent/sign** - Sign messages, typed data, or transactions without broadcasting
- **POST /agent/submit** - Submit raw transactions directly to the blockchain

These endpoints return immediately (no polling required) and are ideal for:
- Authentication flows (sign messages)
- Gasless approvals (sign EIP-712 permits)
- Pre-built transactions (submit raw calldata)

## Error Handling

Common issues and fixes:

- **Authentication errors** → Check API key setup
- **Insufficient balance** → Add funds or reduce amount
- **Token not found** → Verify symbol and chain
- **Transaction reverted** → Check parameters and balances
- **Rate limiting** → Wait and retry

## Best Practices

### Security

1. Never share your API key
2. Start with small test amounts
3. Verify addresses before large transfers
4. Use stop losses for leverage trading
5. Double-check transaction details

### Trading

1. Check balance before trades
2. Specify chain for lesser-known tokens
3. Consider gas costs (use Base/Polygon for small amounts)
4. Start small, scale up after testing
5. Use limit orders for better prices

## Prompt Examples by Category

### Trading

- "Buy $50 of ETH on Base"
- "Swap 0.1 ETH for USDC"
- "Sell 50% of my PEPE"
- "Bridge 100 USDC from Polygon to Base"

### Portfolio

- "Show my portfolio"
- "What's my ETH balance?"
- "Total portfolio value"
- "Holdings on Base"

### Market Research

- "What's the price of Bitcoin?"
- "Analyze ETH price"
- "Trending tokens on Base"
- "Compare UNI vs SUSHI"

### Transfers

- "Send 0.1 ETH to vitalik.eth"
- "Transfer $20 USDC to @friend"
- "Send 50 USDC to 0x123..."

### NFTs

- "Show Bored Ape floor price"
- "Buy cheapest Pudgy Penguin"
- "Show my NFTs"

### Polymarket

- "What are the odds Trump wins?"
- "Bet $10 on Yes for [market]"
- "Show my Polymarket positions"

### Leverage

- "Open 5x long on ETH with $100"
- "Short BTC 10x with stop loss at $45k"
- "Show my Avantis positions"

### Automation

- "DCA $100 into ETH weekly"
- "Set limit order to buy ETH at $3,000"
- "Stop loss for all holdings at -20%"

### Token Deployment

**Solana (LaunchLab):**

- "Launch a token called MOON on Solana"
- "Launch a token called FROG and give fees to @0xDeployer"
- "Deploy SpaceRocket with symbol ROCK"
- "How much fees can I claim for MOON?"
- "Claim my fees for MOON"
- "Show my Fee Key NFTs"

**EVM (Clanker):**

- "Deploy a token called BankrFan with symbol BFAN on Base"
- "Claim fees for my token MTK"

### Arbitrary Transactions

- "Submit this transaction: {to: 0x..., data: 0x..., value: 0, chainId: 8453}"
- "Execute this calldata on Base: {...}"
- "Send raw transaction with this JSON: {...}"

## Resources

- **Agent API Reference**: https://www.notion.so/Agent-API-2e18e0f9661f80cb83ccfc046f8872e3
- **API Key Management**: https://bankr.bot/api
- **Terminal**: https://bankr.bot/terminal
- **Twitter**: @bankr_bot

---

**💡 Pro Tip**: The most common issue is not specifying the chain for tokens. When in doubt, always include "on Base" or "on Ethereum" in your prompt.

**⚠️ Security**: Keep your API key private. Never commit config.json to version control. Only trade amounts you can afford to lose.

**🚀 Quick Win**: Start by checking your portfolio to see what's possible, then try a small $5-10 trade on Base to get familiar with the flow.
