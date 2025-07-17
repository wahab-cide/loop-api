import { getDatabase } from '@/lib/database';


export async function PUT(request: Request) {
  try {
    const sql = getDatabase();
    const { clerkId, threadId } = await request.json();

    if (!clerkId || !threadId) {
      return Response.json({ error: 'ClerkId and threadId required' }, { status: 400 });
    }

    // Get user's database ID
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Get thread info to determine if user is rider or driver
    const [thread] = await sql`
      SELECT rider_id, driver_id FROM chat_threads 
      WHERE id = ${threadId}
      AND (rider_id = ${user.id} OR driver_id = ${user.id})
    `;

    if (!thread) {
      return Response.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Mark messages as read based on user role
    const isRider = thread.rider_id === user.id;
    
    if (isRider) {
      // Mark all messages in this thread as read by rider
      await sql`
        UPDATE chat_messages 
        SET read_by_rider = TRUE, updated_at = NOW()
        WHERE thread_id = ${threadId} AND read_by_rider = FALSE
      `;
    } else {
      // Mark all messages in this thread as read by driver
      await sql`
        UPDATE chat_messages 
        SET read_by_driver = TRUE, updated_at = NOW()
        WHERE thread_id = ${threadId} AND read_by_driver = FALSE
      `;
    }

    return Response.json({
      success: true,
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Error marking messages as read:', error);
    return Response.json({ error: 'Failed to mark messages as read' }, { status: 500 });
  }
}