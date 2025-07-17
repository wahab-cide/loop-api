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
    const { payment_method_id, payment_intent_id, customer_id } = body;

        if (!payment_method_id || !payment_intent_id || !customer_id) {
      if (process.env.NODE_ENV === 'development') {
        console.log('PAY ENDPOINT - Missing required fields');
      }
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400 },
      );
    }

        const paymentMethod = await stripe.paymentMethods.attach(
      payment_method_id,
      { customer: customer_id },
    );
            const result = await stripe.paymentIntents.confirm(payment_intent_id, {
      payment_method: paymentMethod.id,
    });
        return new Response(
      JSON.stringify({
        success: true,
        message: "Payment successful",
        result: result,
      }),
    );
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error("Error paying:", error);
    }
    
    // Provide more detailed error information
    let errorMessage = "Internal Server Error";
    let errorDetails = "";
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || "";
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.error("Detailed error:", {
        message: errorMessage,
        stack: errorDetails,
        type: typeof error,
        error: error
      });
    }
    
    return new Response(JSON.stringify({ 
      error: errorMessage,
      details: errorDetails 
    }), {
      status: 500,
    });
  }
}