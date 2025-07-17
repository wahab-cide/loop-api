import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'health';

    switch (type) {
      case 'health':
        return Response.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          environment: {
            hasStripeSecret: !!process.env.STRIPE_SECRET_KEY,
            hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
            hasConnectWebhookSecret: !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
            hasDatabaseUrl: !!process.env.DATABASE_URL
          }
        });

      case 'verification-status':
        const clerkId = url.searchParams.get('clerkId');
        if (!clerkId) {
          return Response.json({ error: 'clerkId parameter required' }, { status: 400 });
        }

        const [user] = await sql`
          SELECT u.id, u.verification_status, dv.identity_status, dv.document_status, 
                 dv.overall_status, dv.stripe_verification_id, dv.rejection_reason
          FROM users u
          LEFT JOIN driver_verification dv ON u.id = dv.user_id
          WHERE u.clerk_id = ${clerkId}
        `;

        if (!user) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        return Response.json({
          user: {
            id: user.id,
            verification_status: user.verification_status,
            identity_status: user.identity_status,
            document_status: user.document_status,
            overall_status: user.overall_status,
            stripe_verification_id: user.stripe_verification_id,
            rejection_reason: user.rejection_reason
          }
        });

      case 'webhook-logs':
        const limit = parseInt(url.searchParams.get('limit') || '10');
        const eventType = url.searchParams.get('eventType');
        
        let whereClause = '';
        if (eventType) {
          whereClause = `WHERE type = '${eventType}'`;
        }

        const logs = await sql`
          SELECT id, user_id, type, title, body, delivery_status, 
                 delivery_error, ride_id, booking_id, sent_at, created_at
          FROM notification_log
          ${eventType ? sql`WHERE type = ${eventType}` : sql``}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

        return Response.json({ logs });

      default:
        return Response.json({ error: 'Invalid test type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Webhook test endpoint error:', error);
    return Response.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { action, ...params } = await request.json();

    switch (action) {
      case 'simulate-verification-created':
        const { userId, clerkId } = params;
        if (!userId || !clerkId) {
          return Response.json({ error: 'userId and clerkId required' }, { status: 400 });
        }

        // Simulate verification session created
        const fakeSessionId = `vs_test_${Date.now()}`;
        
        await sql`
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
            ${fakeSessionId},
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

        await sql`
          UPDATE users 
          SET verification_status = 'pending', updated_at = NOW()
          WHERE id = ${userId}
        `;

        return Response.json({
          success: true,
          message: 'Simulated verification session created',
          sessionId: fakeSessionId
        });

      case 'reset-verification':
        const { userId: resetUserId } = params;
        if (!resetUserId) {
          return Response.json({ error: 'userId required' }, { status: 400 });
        }

        await sql`
          DELETE FROM driver_verification WHERE user_id = ${resetUserId}
        `;

        await sql`
          UPDATE users 
          SET verification_status = 'unverified', updated_at = NOW()
          WHERE id = ${resetUserId}
        `;

        return Response.json({
          success: true,
          message: 'Verification status reset'
        });

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Webhook test action error:', error);
    return Response.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}