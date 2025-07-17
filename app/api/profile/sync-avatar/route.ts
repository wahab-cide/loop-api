import { getDatabase } from '@/lib/database';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { clerkId, avatarUrl } = await request.json();

    if (!clerkId) {
      return Response.json({ error: 'Clerk ID is required' }, { status: 400 });
    }

    // Update the user's avatar_url in the database
    await sql`
      UPDATE users 
      SET avatar_url = ${avatarUrl}, updated_at = NOW()
      WHERE clerk_id = ${clerkId}
    `;

    return Response.json({
      success: true,
      message: 'Avatar URL synced successfully'
    });

  } catch (error) {
    console.error('Sync avatar error:', error);
    return Response.json({ 
      error: 'Failed to sync avatar URL',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}