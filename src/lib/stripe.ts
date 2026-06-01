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

// Hosted Checkout (setup mode) to capture a card once. No publishable key needed.
export async function createSetupCheckout(customerId: string, returnUrl: string) {
  return stripe.checkout.sessions.create({
    mode: 'setup',
    currency: 'usd',
    customer: customerId,
    payment_method_types: ['card'],
    success_url: `${returnUrl}?card=added`,
    cancel_url: returnUrl,
  })
}

// After a setup checkout completes, make that card the default + auto-charge the sub.
export async function setDefaultPaymentMethodFromSetup(
  customerId: string,
  setupIntentId: string
) {
  const si = await stripe.setupIntents.retrieve(setupIntentId)
  const pm = si.payment_method
  if (!pm || typeof pm !== 'string') return
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

// Report a call's minutes to the meter for a customer.
export async function reportUsage(args: {
  stripeCustomerId: string
  minutes: number
}) {
  return stripe.billing.meterEvents.create({
    event_name: METER_EVENT,
    payload: {
      stripe_customer_id: args.stripeCustomerId,
      value: String(args.minutes),
    },
  })
}
