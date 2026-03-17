import Stripe from "stripe";
import { config } from "../../config";

let _stripe: Stripe | null = null;

/** Get the shared Stripe client. Returns null if STRIPE_SECRET_KEY is not set. */
export function getClient(): Stripe | null {
  if (!config.stripeSecretKey) return null;
  if (!_stripe) {
    _stripe = new Stripe(config.stripeSecretKey, { apiVersion: "2025-02-24.acacia" });
  }
  return _stripe;
}

/** Create a Stripe customer tied to a pool instance. */
export async function createCustomer(opts: {
  instanceId: string;
  agentName?: string;
  instanceUrl?: string;
}): Promise<Stripe.Customer> {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured");

  return stripe.customers.create({
    name: opts.agentName || opts.instanceId,
    metadata: {
      instanceId: opts.instanceId,
      agentName: opts.agentName ?? "",
      instanceUrl: opts.instanceUrl ?? "",
    },
  });
}

/** Retrieve a customer's balance (in cents). */
export async function getCustomerBalance(customerId: string): Promise<number> {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured");

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) throw new Error("Customer has been deleted");
  return customer.balance;
}

/**
 * Ensure a Stripe customer exists for this instance.
 * Idempotent: checks instance_services first, creates only if missing.
 * Returns the Stripe customer ID, or null if Stripe is not configured.
 */
export async function ensureCustomer(opts: {
  instanceId: string;
  agentName?: string;
  instanceUrl?: string;
}): Promise<string | null> {
  if (!getClient()) return null;

  // Lazy imports to avoid circular deps
  const { db: drizzle } = await import("../../db/connection");
  const { instanceServices } = await import("../../db/schema");
  const { eq, and } = await import("drizzle-orm");

  // Check if already provisioned
  const existing = await drizzle.select({ resourceId: instanceServices.resourceId })
    .from(instanceServices)
    .where(and(
      eq(instanceServices.instanceId, opts.instanceId),
      eq(instanceServices.toolId, "stripe"),
    ));
  if (existing[0]) return existing[0].resourceId;

  // Create customer
  const customer = await createCustomer(opts);

  // Store in instance_services
  await drizzle.insert(instanceServices).values({
    instanceId: opts.instanceId,
    toolId: "stripe",
    resourceId: customer.id,
    envKey: "stripe",
    envValue: customer.id,
  });

  console.log(`[stripe] Created customer ${customer.id} for instance ${opts.instanceId}`);
  return customer.id;
}

/** Verify and construct a Stripe webhook event from raw body + signature. */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
): Stripe.Event {
  const stripe = getClient();
  if (!stripe) throw new Error("Stripe is not configured");
  if (!config.stripeWebhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
}
