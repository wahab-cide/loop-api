import { getDatabase } from '@/lib/database';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
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

    // Check if verification exists
    const [verification] = await sql`
      SELECT id, identity_status, document_status, insurance_doc_url
      FROM driver_verification
      WHERE user_id = ${user.id}
    `;

    if (!verification) {
      return Response.json({ error: 'No verification record found' }, { status: 404 });
    }

    // Check if identity is verified and insurance is uploaded
    if (verification.identity_status !== 'verified') {
      return Response.json({ error: 'Identity verification not completed' }, { status: 400 });
    }

    if (!verification.insurance_doc_url) {
      return Response.json({ error: 'Insurance document not uploaded' }, { status: 400 });
    }

    // Complete the verification process
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

    // Update user verification status to verified
    await sql`
      UPDATE users 
      SET verification_status = 'verified', updated_at = NOW()
      WHERE id = ${user.id}
    `;

    return Response.json({
      success: true,
      message: 'Driver verification completed successfully',
      status: 'verified'
    });

  } catch (error) {
    console.error('Final verification error:', error);
    return Response.json({ 
      error: 'Failed to complete final verification',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}