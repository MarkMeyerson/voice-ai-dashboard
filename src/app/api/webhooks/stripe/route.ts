import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import {
  stripe,
  setDefaultPaymentMethodFromSetup,
  createSubscriptionWithPaymentMethod,
} from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

// Mirrors Stripe invoice state back into our `invoices` table.
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const sig = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig!, secret!)
  } catch {
    return new NextResponse('invalid signature', { status: 400 })
  }

  // Client finished adding a card via hosted Checkout (setup mode):
  // make it their default and flip the subscription to auto-charge.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (
      session.mode === 'setup' &&
      session.setup_intent &&
      typeof session.customer === 'string'
    ) {
      const setupIntentId =
        typeof session.setup_intent === 'string'
          ? session.setup_intent
          : session.setup_intent.id
      try {
        const pm = await setDefaultPaymentMethodFromSetup(session.customer, setupIntentId)

        // Deferred billing: a pod attached to Stripe without a subscription
        // starts one now, so the plan begins the day the client pays.
        if (pm) {
          const supabase = createAdminClient()
          const { data: client } = await supabase
            .from('clients')
            .select('id, channel, stripe_subscription_id, stripe_monthly_price_id, stripe_usage_price_id, billing_starts_at')
            .eq('stripe_customer_id', session.customer)
            .maybeSingle()
          const priceIds = [client?.stripe_monthly_price_id, client?.stripe_usage_price_id].filter(
            (p): p is string => Boolean(p)
          )
          if (client && !client.stripe_subscription_id && priceIds.length > 0) {
            // Chat plans bill by calendar month so the included-message
            // allowance in Stripe lines up with the dashboard's usage card.
            const sub = await createSubscriptionWithPaymentMethod({
              customerId: session.customer,
              priceIds,
              paymentMethodId: pm,
              anchorToFirstOfMonth: client.channel === 'chat',
            })
            await supabase
              .from('clients')
              .update({
                stripe_subscription_id: sub.id,
                billing_starts_at: client.billing_starts_at ?? new Date().toISOString(),
              })
              .eq('id', client.id)
          }
        }
      } catch (e) {
        console.error('[stripe webhook] setup completion failed', e)
      }
    }
  }

  if (event.type.startsWith('invoice.')) {
    const inv = event.data.object as Stripe.Invoice
    const supabase = createAdminClient()
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('stripe_customer_id', inv.customer as string)
      .maybeSingle()

    if (client && inv.id) {
      const day = (ts: number | null | undefined) =>
        ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null
      const status =
        inv.status === 'paid' ? 'paid' : inv.status === 'void' ? 'void' : 'open'
      const row = {
        client_id: client.id,
        stripe_invoice_id: inv.id,
        total_cents: inv.amount_due,
        status,
        period_start: day(inv.period_start),
        period_end: day(inv.period_end),
      }
      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('stripe_invoice_id', inv.id)
        .maybeSingle()
      if (existing) {
        await supabase.from('invoices').update(row).eq('id', existing.id)
      } else {
        await supabase.from('invoices').insert(row)
      }
    }
  }

  return NextResponse.json({ received: true })
}
