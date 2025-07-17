import 'dotenv/config';
import { Stripe } from "stripe";

// Get Stripe secret key from environment variables
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

export async function POST(request: Request) {
  try {
    const stripeSecretKey = getStripeSecretKey();
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-06-20',
      typescript: true,
      maxNetworkRetries: 1,
      timeout: 10000,
    });
        const body = await request.json();
    const { name, email, amount } = body;

        if (!name || !email || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
      });
    }

  let customer;
  const doesCustomerExist = await stripe.customers.list({
    email,
  });

  if (doesCustomerExist.data.length > 0) {
    customer = doesCustomerExist.data[0];
  } else {
    const newCustomer = await stripe.customers.create({
      name,
      email,
    });

    customer = newCustomer;
  }

  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customer.id },
    { apiVersion: "2024-06-20" },
  );

  const paymentIntent = await stripe.paymentIntents.create({
    amount: parseInt(amount) * 100,
    currency: "usd",
    customer: customer.id,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: "never",
    },
  });

        return new Response(
      JSON.stringify({
        paymentIntent: paymentIntent,
        ephemeralKey: ephemeralKey,
        customer: customer.id,
      }),
    );
  } catch (error) {
    console.error("CREATE ENDPOINT - Error:", error);
    
    let errorMessage = "Internal Server Error";
    let errorDetails = "";
    
    if (error instanceof Error) {
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      errorDetails = error.stack || "";
    }
    
    console.error("CREATE ENDPOINT - Detailed error:", {
      message: errorMessage,
      stack: errorDetails,
      type: typeof error,
      error: error
    });
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      details: errorDetails 
    }), {
      status: 500,
    });
  }
}