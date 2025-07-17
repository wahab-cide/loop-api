import { Stripe } from 'stripe';

let stripe: Stripe | null = null;

export function getStripe() {
  if (!stripe) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripe = new Stripe(stripeSecretKey);
  }
  return stripe;
}