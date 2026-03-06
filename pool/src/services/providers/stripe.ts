import Stripe from "stripe";
import { config } from "../../config";

/** Minimum credit top-up amount in cents ($1). */
export const MIN_TOPUP_CENTS = 100;

function getClient(): Stripe {
  if (!config.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(config.stripeSecretKey);
}

/** Create a Stripe customer with instance metadata. */
export async function createCustomer(
  instanceId: string,
  meta: { agentName: string; instanceUrl: string; railwayProjectId: string },
): Promise<string> {
  const stripe = getClient();
  const customer = await stripe.customers.create({
    name: `convos-agent-${instanceId}`,
    metadata: {
      instanceId,
      agentName: meta.agentName,
      poolEnvironment: config.poolEnvironment,
      instanceUrl: meta.instanceUrl,
      servicesUrl: meta.instanceUrl ? `${meta.instanceUrl}/web-tools/services` : "",
      railwayUrl: meta.railwayProjectId ? `https://railway.com/project/${meta.railwayProjectId}` : "",
    },
  });
  console.log(`[stripe] Created customer ${customer.id} for instance ${instanceId}`);
  return customer.id;
}

/** Create a PaymentIntent for a given customer/amount. Returns clientSecret + id. */
export async function createPaymentIntent(
  customerId: string,
  amountCents: number,
  instanceId: string,
  purpose: "credits" | "card" = "credits",
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const stripe = getClient();
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: customerId,
    metadata: { instanceId, amountCents: String(amountCents), purpose },
  });
  console.log(`[stripe] Created PaymentIntent ${pi.id} for $${(amountCents / 100).toFixed(2)} (instance=${instanceId}, purpose=${purpose})`);
  return { clientSecret: pi.client_secret!, paymentIntentId: pi.id };
}

/** Retrieve the Stripe customer balance (integer in cents; negative = credit owed TO customer). */
export async function getCustomerBalance(customerId: string): Promise<number> {
  const stripe = getClient();
  const customer = await stripe.customers.retrieve(customerId);
  if ((customer as any).deleted) return 0;
  return (customer as Stripe.Customer).balance;
}

/** Verify and construct a Stripe webhook event from raw body + signature header. */
export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const stripe = getClient();
  if (!config.stripeWebhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
}
