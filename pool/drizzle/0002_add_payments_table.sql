CREATE TABLE IF NOT EXISTS "payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "instance_id" text NOT NULL,
  "stripe_customer_id" text NOT NULL,
  "stripe_payment_intent_id" text NOT NULL UNIQUE,
  "amount_cents" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
