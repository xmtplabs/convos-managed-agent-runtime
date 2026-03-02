---
name: agentcard
description: |
  Prepaid virtual Visa cards for online payments.
  USE WHEN: User wants to pay for something online, create a virtual card, check card balance, list cards.
  REQUIRES: agent-cards CLI installed and authenticated (user runs `agent-cards signup` once).
metadata:
  {
    "openclaw": {
      "emoji": "💳",
      "homepage": "https://agentcard.sh",
      "requires": { "bins": ["agent-cards"] }
    }
  }
---

# AgentCard

Prepaid virtual Visa cards. Create a card, get the details (PAN, CVV, expiry), use it to pay for things online. Cards are single-use and close after the first transaction.

## Setup

The user must run these once (not you):

```
agent-cards signup
agent-cards setup-mcp
```

## Create a card

```bash
agent-cards cards create --amount <usd>
```

This opens a Stripe checkout page for the user to fund. After payment, card details are returned.

## List cards

```bash
agent-cards cards list
```

## Get card details

```bash
agent-cards cards details <card-id>
```

Returns the full PAN, CVV, expiry, and balance. Use these to fill payment forms.

## Check balance

```bash
agent-cards balance <card-id>
```

## MCP Tools

If the user ran `agent-cards setup-mcp`, these tools are available directly:

| Tool | Params | Description |
|------|--------|-------------|
| `create_card` | `amount_cents`, `sandbox?` | Creates a card. Returns Stripe checkout URL + session_id. |
| `get_funding_status` | `session_id` | Poll after checkout. Returns "pending" or card details when ready. |
| `list_cards` | — | All cards with ID, last four, expiry, balance, status. |
| `get_card_details` | `card_id` | Decrypted PAN, CVV, expiry, balance. |
| `check_balance` | `card_id` | Current balance in dollars. |
| `close_card` | `card_id` | Permanently closes a card. Irreversible. |

## Typical flow

1. Agent calls `create_card` with amount (e.g. 5000 for $50)
2. User completes the Stripe checkout
3. Agent polls `get_funding_status` until card is ready
4. Agent calls `get_card_details` to get PAN, CVV, expiry
5. Agent uses the browser to fill in payment details on the merchant site
6. Card closes automatically after the first transaction

## Rules

- Never log or expose full card numbers (PAN) in chat — only show last four digits
- Always confirm the amount with the user before creating a card
- Cards are single-use: one successful charge closes the card
- If a payment fails, the card remains open and can be retried
