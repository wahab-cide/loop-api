import { getDatabase } from '@/lib/database';
import { clerkClient } from '@clerk/clerk-sdk-node';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { clerkId, userId } = await request.json();

    if (!clerkId && !userId) {
      return Response.json({ error: 'Either clerkId or userId is required' }, { status: 400 });
    }

    let user;
    
    // Get user info from database
    if (clerkId) {
      [user] = await sql`
        SELECT id, clerk_id, verification_status 
        FROM users 
        WHERE clerk_id = ${clerkId}
      `;
    } else {
      [user] = await sql`
        SELECT id, clerk_id, verification_status 
        FROM users 
        WHERE id = ${userId}
      `;
    }

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Get verification details from driver_verification table
    const [verification] = await sql`
      SELECT overall_status, verified_at, rejection_reason 
      FROM driver_verification 
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC 
      LIMIT 1
    `;

    let verificationStatus = user.verification_status || 'unverified';
    
    // If we have verification record, use the latest status
    if (verification) {
      switch (verification.overall_status) {
        case 'verified':
          verificationStatus = 'verified';
          break;
        case 'pending':
          verificationStatus = 'pending';
          break;
        case 'rejected':
          verificationStatus = 'rejected';
          break;
        default:
          verificationStatus = 'unverified';
      }
    }

    // Update Clerk metadata
    try {
    const sql = getDatabase();
      await clerkClient.users.updateUserMetadata(user.clerk_id, {
        publicMetadata: {
          verification_status: verificationStatus,
          verification_updated_at: new Date().toISOString(),
          ...(verification?.verified_at && { verified_at: verification.verified_at }),
          ...(verification?.rejection_reason && { rejection_reason: verification.rejection_reason })
        }
      });

      if (process.env.NODE_ENV === 'development') {
        console.log(`Synced verification status for user ${user.clerk_id}: ${verificationStatus}`);
      }
    } catch (clerkError) {
      console.error('Failed to update Clerk metadata:', clerkError);
      return Response.json({ 
        error: 'Failed to sync verification status to user profile',
        details: clerkError instanceof Error ? clerkError.message : 'Unknown Clerk error'
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      verification_status: verificationStatus,
      message: 'Verification status synced successfully'
    });

  } catch (error) {
    console.error('Sync verification error:', error);
    return Response.json({ 
      error: 'Failed to sync verification status',
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
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    // Get user and verification status from database
    const [result] = await sql`
      SELECT 
        u.id,
        u.verification_status,
        dv.overall_status,
        dv.identity_status,
        dv.document_status,
        dv.verified_at,
        dv.rejection_reason,
        dv.requires_resubmission,
        dv.created_at as verification_created_at
      FROM users u
      LEFT JOIN driver_verification dv ON u.id = dv.user_id
      WHERE u.clerk_id = ${clerkId}
      ORDER BY dv.created_at DESC
      LIMIT 1
    `;

    if (!result) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const status = result.overall_status || result.verification_status || 'unverified';

    return Response.json({
      success: true,
      verification_status: status,
      details: {
        identity_status: result.identity_status,
        document_status: result.document_status,
        overall_status: result.overall_status,
        verified_at: result.verified_at,
        rejection_reason: result.rejection_reason,
        requires_resubmission: result.requires_resubmission,
        verification_created_at: result.verification_created_at
      }
    });

  } catch (error) {
    console.error('Get verification status error:', error);
    return Response.json({ 
      error: 'Failed to get verification status',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}