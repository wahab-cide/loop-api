import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const { searchParams } = new URL(request.url);
    const clerkId = searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user's internal ID
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      if (process.env.NODE_ENV === 'development') console.log('User not found in database for clerkId:', clerkId);
      return Response.json({ 
        success: true,
        unreadCount: 0 // Return 0 for missing users instead of error
      });
    }

    // Count unread messages for this user
    // A message is unread if:
    // - User is the rider and read_by_rider = false
    // - User is the driver and read_by_driver = false
    // - The sender is NOT the current user (don't count own messages as unread)
    const [unreadCount] = await sql`
      SELECT COUNT(*) as unread_count
      FROM chat_messages cm
      JOIN chat_threads ct ON cm.thread_id = ct.id
      WHERE cm.sender_id != ${user.id}
      AND (
        (ct.rider_id = ${user.id} AND cm.read_by_rider = FALSE)
        OR
        (ct.driver_id = ${user.id} AND cm.read_by_driver = FALSE)
      )
    `;

    return Response.json({
      success: true,
      unreadCount: parseInt(unreadCount.unread_count) || 0
    });

  } catch (error) {
    console.error('Error fetching unread count:', error);
    return Response.json({ 
      error: 'Failed to fetch unread count',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}