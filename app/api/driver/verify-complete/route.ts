import { getDatabase } from '@/lib/database';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { clerkId, simulateSuccess } = await request.json();

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

    // Update verification status to completed for simulation
    if (simulateSuccess) {
      await sql`
        UPDATE driver_verification 
        SET 
          identity_status = 'verified',
          document_status = 'pending',
          overall_status = 'pending',
          verified_at = NOW(),
          updated_at = NOW()
        WHERE user_id = ${user.id}
      `;

      // Update user verification status to pending (since insurance is still needed)
      await sql`
        UPDATE users 
        SET verification_status = 'pending', updated_at = NOW()
        WHERE id = ${user.id}
      `;

      return Response.json({
        success: true,
        message: 'Identity verification completed successfully',
        status: 'identity_verified'
      });
    }

    return Response.json({ error: 'Invalid request' }, { status: 400 });

  } catch (error) {
    console.error('Verification completion error:', error);
    return Response.json({ 
      error: 'Failed to complete verification',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}