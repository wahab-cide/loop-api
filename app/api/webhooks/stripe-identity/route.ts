import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    // Enhanced logging for debugging
    console.log('Webhook request received:', {
      bodyLength: body.length,
      hasSignature: !!signature,
      timestamp: new Date().toISOString()
    });

    if (!signature) {
      console.error('No Stripe signature header found');
      return Response.json({ error: 'No signature provided' }, { status: 400 });
    }

    // Validate body size (Stripe recommends max 2MB)
    if (body.length > 2 * 1024 * 1024) {
      console.error('Request body too large:', body.length);
      return Response.json({ error: 'Request body too large' }, { status: 413 });
    }

    let event: Stripe.Event;

    try {
    const sql = getDatabase();
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', {
        error: err.message,
        type: err.type,
        raw: err.raw,
        header: err.header,
        payload: err.payload ? err.payload.substring(0, 200) + '...' : 'no payload',
        bodyLength: body.length,
        signatureHeader: signature?.substring(0, 50) + '...',
        webhookSecretLength: webhookSecret.length
      });
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle the event
    console.log(`Processing event: ${event.type} (ID: ${event.id})`);
    
    switch (event.type) {
      case 'identity.verification_session.created':
        await handleVerificationCreated(event.data.object as Stripe.Identity.VerificationSession);
        break;
      case 'identity.verification_session.verified':
        await handleVerificationVerified(event.data.object as Stripe.Identity.VerificationSession);
        break;
      case 'identity.verification_session.requires_input':
        await handleVerificationRequiresInput(event.data.object as Stripe.Identity.VerificationSession);
        break;
      case 'identity.verification_session.processing':
        await handleVerificationProcessing(event.data.object as Stripe.Identity.VerificationSession);
        break;
      case 'identity.verification_session.canceled':
        await handleVerificationCanceled(event.data.object as Stripe.Identity.VerificationSession);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

async function handleVerificationCreated(session: Stripe.Identity.VerificationSession) {
  try {
    const sql = getDatabase();
    const userId = session.metadata?.user_id;
    const clerkId = session.metadata?.clerk_id;
    
    if (!userId) {
      console.error('No user_id in verification session metadata');
      return;
    }

    // Update verification status in database to indicate session was created
    await sql`
      UPDATE driver_verification 
      SET 
        identity_status = 'verifying',
        document_status = 'pending',
        overall_status = 'pending',
        stripe_verification_id = ${session.id},
        updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    // If no record exists yet, create one
    const result = await sql`
      INSERT INTO driver_verification (
        user_id,
        stripe_verification_id,
        identity_status,
        document_status,
        overall_status,
        created_at,
        updated_at
      ) VALUES (
        ${userId},
        ${session.id},
        'verifying',
        'pending', 
        'pending',
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        stripe_verification_id = EXCLUDED.stripe_verification_id,
        identity_status = EXCLUDED.identity_status,
        document_status = EXCLUDED.document_status,
        overall_status = EXCLUDED.overall_status,
        updated_at = NOW()
    `;

    // Update user verification status
    await sql`
      UPDATE users 
      SET verification_status = 'pending', updated_at = NOW()
      WHERE id = ${userId}
    `;

    console.log(`Driver verification session created for user ${userId}: ${session.id}`);
  } catch (error) {
    console.error('Error handling verification created:', error);
  }
}

async function handleVerificationVerified(session: Stripe.Identity.VerificationSession) {
  try {
    const sql = getDatabase();
    const userId = session.metadata?.user_id;
    const clerkId = session.metadata?.clerk_id;
    
    if (!userId) {
      console.error('No user_id in verification session metadata');
      return;
    }

    // Update verification status in database
    await sql`
      UPDATE driver_verification 
      SET 
        identity_status = 'verified',
        document_status = 'approved',
        overall_status = 'verified',
        verified_at = NOW(),
        updated_at = NOW()
      WHERE stripe_verification_id = ${session.id}
    `;

    // Update user verification status
    await sql`
      UPDATE users 
      SET verification_status = 'verified', updated_at = NOW()
      WHERE id = ${userId}
    `;

    // Sync verification status to Clerk metadata
    if (clerkId) {
      try {
    const sql = getDatabase();
        await fetch(`${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/driver/sync-verification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clerkId }),
        });
        console.log(`Synced verification status to Clerk for user ${clerkId}`);
      } catch (syncError) {
        console.error('Failed to sync verification status to Clerk:', syncError);
      }
    }

    console.log(`Driver verification completed for user ${userId}`);
  } catch (error) {
    console.error('Error handling verification verified:', error);
  }
}

async function handleVerificationRequiresInput(session: Stripe.Identity.VerificationSession) {
  try {
    const sql = getDatabase();
    const userId = session.metadata?.user_id;
    const clerkId = session.metadata?.clerk_id;
    
    if (!userId) {
      console.error('No user_id in verification session metadata');
      return;
    }

    const lastError = session.last_error;
    const rejectionReason = lastError ? `Error code: ${lastError.code}` : 'Additional input required';

    // Update verification status in database
    await sql`
      UPDATE driver_verification 
      SET 
        identity_status = 'failed',
        document_status = 'rejected',
        overall_status = 'rejected',
        rejection_reason = ${rejectionReason},
        requires_resubmission = true,
        updated_at = NOW()
      WHERE stripe_verification_id = ${session.id}
    `;

    // Update user verification status
    await sql`
      UPDATE users 
      SET verification_status = 'rejected', updated_at = NOW()
      WHERE id = ${userId}
    `;

    // Sync verification status to Clerk metadata
    if (clerkId) {
      try {
    const sql = getDatabase();
        await fetch(`${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/driver/sync-verification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clerkId }),
        });
        console.log(`Synced verification status to Clerk for user ${clerkId}`);
      } catch (syncError) {
        console.error('Failed to sync verification status to Clerk:', syncError);
      }
    }

    console.log(`Driver verification requires input for user ${userId}: ${rejectionReason}`);
  } catch (error) {
    console.error('Error handling verification requires input:', error);
  }
}

async function handleVerificationProcessing(session: Stripe.Identity.VerificationSession) {
  try {
    const sql = getDatabase();
    const userId = session.metadata?.user_id;
    const clerkId = session.metadata?.clerk_id;
    
    if (!userId) {
      console.error('No user_id in verification session metadata');
      return;
    }

    // Update verification status in database
    await sql`
      UPDATE driver_verification 
      SET 
        identity_status = 'processing',
        document_status = 'processing',
        overall_status = 'pending',
        updated_at = NOW()
      WHERE stripe_verification_id = ${session.id}
    `;

    // Sync verification status to Clerk metadata
    if (clerkId) {
      try {
    const sql = getDatabase();
        await fetch(`${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/driver/sync-verification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clerkId }),
        });
        console.log(`Synced verification status to Clerk for user ${clerkId}`);
      } catch (syncError) {
        console.error('Failed to sync verification status to Clerk:', syncError);
      }
    }

    console.log(`Driver verification processing for user ${userId}`);
  } catch (error) {
    console.error('Error handling verification processing:', error);
  }
}

async function handleVerificationCanceled(session: Stripe.Identity.VerificationSession) {
  try {
    const sql = getDatabase();
    const userId = session.metadata?.user_id;
    const clerkId = session.metadata?.clerk_id;
    
    if (!userId) {
      console.error('No user_id in verification session metadata');
      return;
    }

    // Update verification status in database
    await sql`
      UPDATE driver_verification 
      SET 
        identity_status = 'canceled',
        document_status = 'canceled',
        overall_status = 'rejected',
        rejection_reason = 'Verification canceled by user',
        updated_at = NOW()
      WHERE stripe_verification_id = ${session.id}
    `;

    // Update user verification status
    await sql`
      UPDATE users 
      SET verification_status = 'unverified', updated_at = NOW()
      WHERE id = ${userId}
    `;

    // Sync verification status to Clerk metadata
    if (clerkId) {
      try {
    const sql = getDatabase();
        await fetch(`${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/driver/sync-verification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clerkId }),
        });
        console.log(`Synced verification status to Clerk for user ${clerkId}`);
      } catch (syncError) {
        console.error('Failed to sync verification status to Clerk:', syncError);
      }
    }

    console.log(`Driver verification canceled for user ${userId}`);
  } catch (error) {
    console.error('Error handling verification canceled:', error);
  }
}