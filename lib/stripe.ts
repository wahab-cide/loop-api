import { Stripe } from 'stripe';

let stripe: Stripe | null = null;

// Get Stripe secret key from environment variables with validation
const getStripeSecretKey = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  
  if (!key.startsWith('sk_')) {
    throw new Error('Invalid STRIPE_SECRET_KEY format - must start with sk_');
  }
  
  // Clean the key to remove any potential invisible characters
  return key.trim().replace(/\s+/g, '');
};

export function getStripe() {
  if (!stripe) {
    const stripeSecretKey = getStripeSecretKey();
    
    // Initialize Stripe with explicit configuration for better reliability
    stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-06-20',
      typescript: true,
      maxNetworkRetries: 3,
      timeout: 15000, // Increased timeout for Identity API calls
    });
  }
  return stripe;
}