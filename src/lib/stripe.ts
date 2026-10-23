import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const METER_EVENT = process.env.STRIPE_METER_EVENT || 'voicedesk_call_minutes'

// Create a Stripe customer for a client pod.
export async function createCustomer(args: {
  name: string
  email: string
  slug: string
}) {
  return stripe.customers.create({
    name: args.name,
    email: args.email,
    metadata: { slug: args.slug },
  })
}

// Metered price at the client's per-minute rate (cents per minute, charged on usage).
export async function createMeteredPrice(args: {
  clientName: string
  ratePerMinuteCents: number
}) {
  return stripe.prices.create({
    currency: 'usd',
    unit_amount: args.ratePerMinuteCents,
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      meter: process.env.STRIPE_METER_ID!,
    },
    product_data: { name: `${args.clientName} — call minutes` },
  })
}

// Flat monthly retainer price.
export async function createMonthlyPrice(args: {
  clientName: string
  monthlyCents: number
}) {
  return stripe.prices.create({
    currency: 'usd',
    unit_amount: args.monthlyCents,
    recurring: { interval: 'month' },
    product_data: { name: `${args.clientName} — monthly retainer` },
  })
}

export async function createSubscription(args: {
  customerId: string
  priceIds: string[]
}) {
  return stripe.subscriptions.create({
    customer: args.customerId,
    items: args.priceIds.map((price) => ({ price })),
    // Test mode: don't block on a payment method; usage accrues to the invoice.
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
  })
}

// Card on file for a customer (their default payment method), if any.
export async function getDefaultPaymentMethod(customerId: string) {
  const cust = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  })
  if (cust.deleted) return null
  const pm = cust.invoice_settings?.default_payment_method
  if (pm && typeof pm !== 'string' && pm.card) {
    return { brand: pm.card.brand, last4: pm.card.last4 }
  }
  return null
}

// Hosted Checkout (setup mode) to capture a payment method once. No publishable
// key needed. Bank account (ACH debit) is listed first to steer clients there:
// 0.8% capped at $5 versus 2.9% + 30c for cards. Instant verification through
// Financial Connections, micro-deposits as the fallback. ACH must be enabled in
// Stripe → Settings → Payment methods or Checkout silently shows cards only.
export async function createSetupCheckout(customerId: string, returnUrl: string) {
  return stripe.checkout.sessions.create({
    mode: 'setup',
    currency: 'usd',
    customer: customerId,
    payment_method_types: ['us_bank_account', 'card'],
    payment_method_options: {
      us_bank_account: {
        financial_connections: { permissions: ['payment_method'] },
        verification_method: 'automatic',
      },
    },
    success_url: `${returnUrl}?card=added`,
    cancel_url: returnUrl,
  })
}

// After a setup checkout completes, make that payment method the default and
// auto-charge any existing subscription. Returns the payment method id so the
// caller can start a subscription that was deferred until now.
export async function setDefaultPaymentMethodFromSetup(
  customerId: string,
  setupIntentId: string
): Promise<string | null> {
  const si = await stripe.setupIntents.retrieve(setupIntentId)
  const pm = si.payment_method
  if (!pm || typeof pm !== 'string') return null
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm },
  })
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 1,
  })
  if (subs.data[0]) {
    await stripe.subscriptions.update(subs.data[0].id, {
      default_payment_method: pm,
      collection_method: 'charge_automatically',
    })
  }
  return pm
}

// Payment method on file, any type (card or bank account).
export async function getDefaultPaymentMethodAny(customerId: string) {
  const cust = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  })
  if (cust.deleted) return null
  const pm = cust.invoice_settings?.default_payment_method
  if (!pm || typeof pm === 'string') return null
  if (pm.card) return { kind: 'card' as const, brand: pm.card.brand, last4: pm.card.last4 }
  if (pm.us_bank_account) {
    return {
      kind: 'bank' as const,
      brand: pm.us_bank_account.bank_name ?? 'Bank account',
      last4: pm.us_bank_account.last4 ?? '',
    }
  }
  return null
}

// Find (or create) the chat-message meter in the current Stripe mode, so the
// same code works with a test key and the live key without an env var.
export async function ensureChatMeter(): Promise<string> {
  const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 })
  const found = meters.data.find((m) => m.event_name === CHAT_METER_EVENT)
  if (found) return found.id
  const created = await stripe.billing.meters.create({
    display_name: 'VoiceDesk chat messages',
    event_name: CHAT_METER_EVENT,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  })
  return created.id
}

// Chat plan: flat monthly retainer + tiered metered messages (the first
// `includedMessages` each period at $0, then `overagePerMessageCents` each).
// Stripe resets the meter every billing period, so the allowance lives here.
export async function createChatPlanPrices(args: {
  clientName: string
  monthlyCents: number
  includedMessages: number
  overagePerMessageCents: number
}) {
  const meter = await ensureChatMeter()
  const monthly =
    args.monthlyCents > 0
      ? await stripe.prices.create({
          currency: 'usd',
          unit_amount: args.monthlyCents,
          recurring: { interval: 'month' },
          product_data: { name: `${args.clientName} — monthly plan` },
        })
      : null

  const recurring = { interval: 'month' as const, usage_type: 'metered' as const, meter }
  const usage =
    args.includedMessages > 0
      ? await stripe.prices.create({
          currency: 'usd',
          billing_scheme: 'tiered',
          tiers_mode: 'graduated',
          tiers: [
            { up_to: args.includedMessages, unit_amount: 0 },
            { up_to: 'inf', unit_amount: args.overagePerMessageCents },
          ],
          recurring,
          product_data: {
            name: `${args.clientName} — messages (first ${args.includedMessages.toLocaleString()} included)`,
          },
        })
      : await stripe.prices.create({
          currency: 'usd',
          unit_amount: args.overagePerMessageCents,
          recurring,
          product_data: { name: `${args.clientName} — messages` },
        })

  return { monthlyPriceId: monthly?.id ?? null, usagePriceId: usage.id }
}

// Start a subscription now, charging the given payment method automatically.
// Used when billing was deferred until the client added a payment method:
// the billing anchor is the moment this runs.
export async function createSubscriptionWithPaymentMethod(args: {
  customerId: string
  priceIds: string[]
  paymentMethodId: string
}) {
  return stripe.subscriptions.create({
    customer: args.customerId,
    items: args.priceIds.map((price) => ({ price })),
    default_payment_method: args.paymentMethodId,
    collection_method: 'charge_automatically',
    payment_settings: { save_default_payment_method: 'on_subscription' },
  })
}

// Pull a client's billing snapshot from Stripe: subscription status + invoices.
export async function getClientBilling(customerId: string) {
  const [subs, invoices] = await Promise.all([
    stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 }),
    stripe.invoices.list({ customer: customerId, limit: 12 }),
  ])
  return {
    subStatus: subs.data[0]?.status ?? 'none',
    invoices: invoices.data.map((i) => ({
      id: i.id ?? '',
      number: i.number ?? null,
      total: i.total,
      status: i.status ?? 'draft', // draft|open|paid|void|uncollectible
      created: i.created,
      url: i.hosted_invoice_url ?? null,
    })),
  }
}

// Report a call's minutes to the meter for a customer. `identifier` makes the
// event idempotent on Stripe's side (duplicates within 24h are ignored).
export async function reportUsage(args: {
  stripeCustomerId: string
  minutes: number
  identifier?: string
}) {
  return stripe.billing.meterEvents.create({
    event_name: METER_EVENT,
    identifier: args.identifier,
    payload: {
      stripe_customer_id: args.stripeCustomerId,
      value: String(args.minutes),
    },
  })
}

// Chat billing: one unit per metered message, on its own meter (found or
// created by ensureChatMeter in whichever Stripe mode the key is in).
const CHAT_METER_EVENT =
  process.env.STRIPE_CHAT_METER_EVENT || 'voicedesk_chat_messages'

export async function reportChatUsage(args: {
  stripeCustomerId: string
  messages: number
  identifier?: string
}) {
  return stripe.billing.meterEvents.create({
    event_name: CHAT_METER_EVENT,
    identifier: args.identifier,
    payload: {
      stripe_customer_id: args.stripeCustomerId,
      value: String(args.messages),
    },
  })
}
