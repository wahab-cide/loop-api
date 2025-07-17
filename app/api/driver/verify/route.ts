import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { clerkId } = await request.json();

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Check if user exists and is a driver
    const [user] = await sql`
      SELECT id, name, email, is_driver, verification_status 
      FROM users 
      WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.is_driver) {
      return Response.json({ error: 'User must be a driver to verify' }, { status: 400 });
    }

    // Check if user already has a pending verification
    const [existingVerification] = await sql`
      SELECT id, stripe_verification_id, overall_status
      FROM driver_verification
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (existingVerification && existingVerification.overall_status === 'pending') {
      // Try to retrieve the existing Stripe session
      try {
    const sql = getDatabase();
        const existingSession = await stripe.identity.verificationSessions.retrieve(
          existingVerification.stripe_verification_id
        );
        
        if (existingSession.status === 'verified') {
          // Update our database to reflect the completion
          await sql`
            UPDATE driver_verification 
            SET 
              identity_status = 'verified',
              document_status = 'approved',
              overall_status = 'verified',
              verified_at = NOW(),
              updated_at = NOW()
            WHERE user_id = ${user.id}
          `;
          
          await sql`
            UPDATE users 
            SET verification_status = 'verified', updated_at = NOW()
            WHERE id = ${user.id}
          `;
          
          return Response.json({
            success: true,
            message: 'Verification already completed',
            status: 'verified'
          });
        } else if (existingSession.status === 'requires_input') {
          // Session needs input, allow restart
          // Continue with creating new session below
        } else {
          // Session is still in progress, return existing session
          return Response.json({
            success: true,
            verification_session: {
              id: existingSession.id,
              client_secret: existingSession.client_secret,
              url: existingSession.url,
            },
            message: 'Continuing existing verification'
          });
        }
      } catch (stripeError) {
        console.error('Error retrieving Stripe session:', stripeError);
        // If we can't retrieve the session, allow creating a new one
      }
    }

    // Create Stripe Identity verification session
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: {
        user_id: user.id,
        clerk_id: clerkId,
      },
      options: {
        document: {
          allowed_types: ['driving_license', 'passport', 'id_card'],
          require_id_number: true,
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
    });

    // Store verification session in database
    await sql`
      INSERT INTO driver_verification (
        user_id, 
        stripe_verification_id,
        identity_status,
        document_status,
        overall_status
      ) VALUES (
        ${user.id},
        ${verificationSession.id},
        'pending',
        'pending', 
        'pending'
      )
      ON CONFLICT (user_id) DO UPDATE SET
        stripe_verification_id = ${verificationSession.id},
        identity_status = 'pending',
        document_status = 'pending',
        overall_status = 'pending',
        updated_at = NOW()
    `;

    // Update user verification status
    await sql`
      UPDATE users 
      SET verification_status = 'pending', updated_at = NOW()
      WHERE id = ${user.id}
    `;

    return Response.json({
      success: true,
      verification_session: {
        id: verificationSession.id,
        client_secret: verificationSession.client_secret,
        url: verificationSession.url,
      },
    });

  } catch (error) {
    console.error('Verification initialization error:', error);
    return Response.json({ 
      error: 'Failed to initialize verification',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const { searchParams } = new URL(request.url);
    const clerkId = searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user verification status
    const [user] = await sql`
      SELECT u.id, u.verification_status, dv.stripe_verification_id, 
             dv.identity_status, dv.document_status, dv.overall_status,
             dv.verified_at, dv.rejection_reason, dv.requires_resubmission
      FROM users u
      LEFT JOIN driver_verification dv ON u.id = dv.user_id
      WHERE u.clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    return Response.json({
      success: true,
      verification_status: user.verification_status,
      details: {
        identity_status: user.identity_status,
        document_status: user.document_status,
        overall_status: user.overall_status,
        verified_at: user.verified_at,
        rejection_reason: user.rejection_reason,
        requires_resubmission: user.requires_resubmission,
      }
    });

  } catch (error) {
    console.error('Verification status check error:', error);
    return Response.json({ 
      error: 'Failed to check verification status',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}