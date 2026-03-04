import Stripe from "stripe";
import { config } from "../../config";

/** Valid credit package amounts in cents. */
export const CREDIT_PACKAGES_CENTS = [500, 1000, 2000] as const;

function getClient(): Stripe {
  if (!config.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(config.stripeSecretKey);
}

/** Create a Stripe customer with instanceId in metadata. */
export async function createCustomer(instanceId: string, name: string): Promise<string> {
  const stripe = getClient();
  const customer = await stripe.customers.create({
    name,
    metadata: { instanceId },
  });
  console.log(`[stripe] Created customer ${customer.id} for instance ${instanceId}`);
  return customer.id;
}

/** Create a PaymentIntent for a given customer/amount. Returns clientSecret + id. */
export async function createPaymentIntent(
  customerId: string,
  amountCents: number,
  instanceId: string,
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const stripe = getClient();
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: customerId,
    metadata: { instanceId, amountCents: String(amountCents) },
  });
  console.log(`[stripe] Created PaymentIntent ${pi.id} for $${(amountCents / 100).toFixed(2)} (instance=${instanceId})`);
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
