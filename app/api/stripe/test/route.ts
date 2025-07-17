import { NextRequest, NextResponse } from 'next/server';
import { Stripe } from 'stripe';

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

export async function GET(request: NextRequest) {
  try {
    // Test basic Stripe connectivity
    const stripeSecretKey = getStripeSecretKey();
    
    // Initialize Stripe with explicit configuration
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2024-06-20',
      typescript: true,
      maxNetworkRetries: 1,
      timeout: 10000,
    });
    
    // Try to make a simple API call to test connectivity
    const customer = await stripe.customers.create({
      email: 'test@example.com',
      name: 'Test Customer'
    });
    
    // Clean up - delete the test customer
    await stripe.customers.del(customer.id);
    
    return NextResponse.json({
      success: true,
      message: 'Stripe connection successful',
      keyPrefix: stripeSecretKey.substring(0, 7) + '...',
      testCustomerId: customer.id,
      keyLength: stripeSecretKey.length,
      keyHasSpaces: stripeSecretKey !== stripeSecretKey.trim()
    });
    
  } catch (error) {
    console.error('Stripe test error:', error);
    
    let errorMessage = 'Unknown error';
    let errorDetails = '';
    let errorType = '';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || '';
      errorType = error.constructor.name;
    }
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
      details: errorDetails,
      errorType: errorType,
      keyLength: process.env.STRIPE_SECRET_KEY?.length || 0,
      keyPrefix: process.env.STRIPE_SECRET_KEY?.substring(0, 7) + '...' || 'undefined'
    }, { status: 500 });
  }
}