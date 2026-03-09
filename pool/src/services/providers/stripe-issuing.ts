import Stripe from "stripe";
import { config } from "../../config";

const CARDHOLDER_NAME = "Convos Agent";
const BILLING_ADDRESS: Stripe.Issuing.CardholderCreateParams.Billing["address"] = {
  line1: "1131 4th Avenue South",
  city: "Nashville",
  state: "TN",
  postal_code: "37210",
  country: "US",
};

/** Default all-time spending limit in cents. */
export const DEFAULT_SPENDING_LIMIT_CENTS = 5000; // $50

/** Blocked merchant category codes (gambling, adult, crypto ATMs, etc.) */
const BLOCKED_CATEGORIES: Stripe.Issuing.CardholderCreateParams.SpendingControls.SpendingLimit.Category[] = [
  "automated_cash_disburse",
  "betting_casino_gambling",
  "digital_goods_games",
  "wires_money_orders",
];

function getClient(): Stripe {
  if (!config.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(config.stripeSecretKey);
}

export interface IssueCardMeta {
  agentName: string;
  instanceUrl: string;
  railwayProjectId: string;
}

/** Create a cardholder + virtual card with a spending limit. Returns card ID and cardholder ID. */
export async function issueCard(
  instanceId: string,
  spendingLimitCents: number = DEFAULT_SPENDING_LIMIT_CENTS,
  meta?: IssueCardMeta,
): Promise<{ cardId: string; cardholderId: string; last4: string; expMonth: number; expYear: number; brand: string }> {
  const stripe = getClient();

  const cardholderMeta: Record<string, string> = {
    instanceId,
    poolEnvironment: config.poolEnvironment,
  };
  const cardMeta: Record<string, string> = { ...cardholderMeta };
  if (meta?.agentName) {
    cardholderMeta.agentName = meta.agentName;
    cardMeta.agentName = meta.agentName;
  }
  if (meta?.instanceUrl) {
    cardMeta.instanceUrl = meta.instanceUrl;
    cardMeta.servicesUrl = `${meta.instanceUrl}/web-tools/services`;
  }
  if (meta?.railwayProjectId) {
    cardMeta.railwayUrl = `https://railway.com/project/${meta.railwayProjectId}`;
  }

  // Create cardholder with required individual fields for activation
  const cardholder = await stripe.issuing.cardholders.create({
    name: `ca-${instanceId}`.slice(0, 24),
    type: "individual",
    individual: {
      first_name: "Convos",
      last_name: "Agent",
      card_issuing: {
        user_terms_acceptance: {
          date: Math.floor(Date.now() / 1000),
          ip: "127.0.0.1",
        },
      },
    },
    billing: { address: BILLING_ADDRESS },
    spending_controls: {
      spending_limits: [
        {
          amount: spendingLimitCents,
          interval: "all_time",
          categories: BLOCKED_CATEGORIES,
        },
      ],
    },
    metadata: cardholderMeta,
  });

  console.log(`[stripe-issuing] Created cardholder ${cardholder.id} for instance ${instanceId}`);

  // Create virtual card
  const card = await stripe.issuing.cards.create({
    cardholder: cardholder.id,
    currency: "usd",
    type: "virtual",
    spending_controls: {
      spending_limits: [
        {
          amount: spendingLimitCents,
          interval: "all_time",
        },
      ],
    },
    status: "active",
    metadata: cardMeta,
  });

  console.log(`[stripe-issuing] Created card ${card.id} (****${card.last4}) for instance ${instanceId}, limit=$${(spendingLimitCents / 100).toFixed(2)}`);

  return {
    cardId: card.id,
    cardholderId: cardholder.id,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    brand: card.brand,
  };
}

/** Retrieve sensitive card details (number, CVC). Requires Stripe Issuing. */
export async function getCardDetails(cardId: string): Promise<{
  number: string;
  cvc: string;
  expMonth: number;
  expYear: number;
}> {
  const stripe = getClient();
  // Expand the full card number + CVC (requires issuing read permission)
  const card = await stripe.issuing.cards.retrieve(cardId, {
    expand: ["number", "cvc"],
  });
  return {
    number: (card as any).number,
    cvc: (card as any).cvc,
    expMonth: card.exp_month,
    expYear: card.exp_year,
  };
}

/** Update the spending limit on a card. */
export async function updateSpendingLimit(cardId: string, newLimitCents: number): Promise<void> {
  const stripe = getClient();
  await stripe.issuing.cards.update(cardId, {
    spending_controls: {
      spending_limits: [
        {
          amount: newLimitCents,
          interval: "all_time",
        },
      ],
    },
  });
  console.log(`[stripe-issuing] Updated card ${cardId} spending limit to $${(newLimitCents / 100).toFixed(2)}`);
}

/** Cancel (permanently deactivate) a card. */
export async function cancelCard(cardId: string): Promise<boolean> {
  const stripe = getClient();
  try {
    await stripe.issuing.cards.update(cardId, { status: "canceled" });
    console.log(`[stripe-issuing] Canceled card ${cardId}`);
    return true;
  } catch (err: any) {
    console.warn(`[stripe-issuing] Failed to cancel card ${cardId}: ${err.message}`);
    return false;
  }
}

/** Get current spending on a card (authorizations total). */
export async function getCardSpending(cardholderId: string): Promise<{ totalSpentCents: number }> {
  const stripe = getClient();
  const auths = await stripe.issuing.authorizations.list({
    cardholder: cardholderId,
    status: "closed",
    limit: 100,
  });
  const totalSpentCents = auths.data.reduce((sum, a) => sum + a.amount, 0);
  return { totalSpentCents };
}
