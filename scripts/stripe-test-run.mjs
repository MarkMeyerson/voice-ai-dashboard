// One-off exercise of the chat-plan Stripe flow in TEST mode. Never touches the
// database. Reads STRIPE_SECRET_KEY from .env.stripe-test.local (gitignored
// by the .env* rule) and refuses anything that is not an sk_test_ key.
//
//   node scripts/stripe-test-run.mjs
//
// Creates: meter (if missing), customer, $250 monthly price, tiered usage
// price (first 2,000 at $0, then $0.05), a setup Checkout session (prints the
// URL so you can see ACH listed first), then attaches a test card and starts
// the subscription exactly as the webhook would, and finally reports 2,150
// messages to the meter so the upcoming invoice shows 150 x $0.05 overage.
import fs from 'node:fs'
import path from 'node:path'

// Env file: first argument, or STRIPE_TEST_ENV_FILE, or ./.env.stripe-test.local
const envFile = path.resolve(process.argv[2] || process.env.STRIPE_TEST_ENV_FILE || '.env.stripe-test.local')
if (!fs.existsSync(envFile)) {
  console.error(`Missing ${envFile}. Put STRIPE_SECRET_KEY=sk_test_... in it.`)
  process.exit(1)
}
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=')
  if (i > 0 && !line.trim().startsWith('#')) {
    // Tolerate "Stripe secret key = sk_test_..." style lines too.
    const k = line.slice(0, i).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    process.env[k === 'STRIPE_SECRET_KEY' || v.startsWith('sk_') ? 'STRIPE_SECRET_KEY' : k] = v
  }
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not a test key.')
  process.exit(1)
}

const {
  stripe,
  ensureChatMeter,
  createChatPlanPrices,
  createCustomer,
  createSetupCheckout,
  createSubscriptionWithPaymentMethod,
  reportChatUsage,
  getDefaultPaymentMethodAny,
} = await import('../src/lib/stripe.ts')

const stamp = new Date().toISOString().slice(0, 16)
console.log('1. meter:', await ensureChatMeter())

const customer = await createCustomer({
  name: `WFWC test ${stamp}`,
  email: 'wfwc-test@example.com',
  slug: 'wfwc-test',
})
console.log('2. customer:', customer.id)

const prices = await createChatPlanPrices({
  clientName: 'WFWC test',
  monthlyCents: 25000,
  includedMessages: 2000,
  overagePerMessageCents: 5,
})
console.log('3. prices:', prices)

const session = await createSetupCheckout(customer.id, 'http://localhost:3000/wfwc')
console.log('4. setup checkout (open to see ACH first):', session.url)
console.log('   payment_method_types:', session.payment_method_types)

// Simulate the client finishing checkout with a test card.
const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id })
await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } })
const sub = await createSubscriptionWithPaymentMethod({
  customerId: customer.id,
  priceIds: [prices.monthlyPriceId, prices.usagePriceId].filter(Boolean),
  paymentMethodId: pm.id,
})
console.log('5. subscription:', sub.id, sub.status, 'period ends', new Date(sub.items.data[0].current_period_end * 1000).toISOString().slice(0, 10))
console.log('   on file:', await getDefaultPaymentMethodAny(customer.id))

const ev = await reportChatUsage({ stripeCustomerId: customer.id, messages: 2150 })
console.log('6. meter event:', ev.identifier, 'value', ev.payload.value)

// Meter events aggregate asynchronously; give Stripe a moment then preview.
await new Promise((r) => setTimeout(r, 8000))
const preview = await stripe.invoices.createPreview({ customer: customer.id, subscription: sub.id })
for (const line of preview.lines.data) {
  console.log('   line:', (line.amount / 100).toFixed(2), line.description)
}
console.log('7. upcoming total:', (preview.total / 100).toFixed(2), '(expect 250.00 + 7.50 overage once the meter settles)')
console.log('\nCleanup: delete the test customer in the Stripe test dashboard when done, or leave it.')
