import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const threadId = url.pathname.split('/').pop()?.replace('+api', '');
    const clerkId = url.searchParams.get('clerkId');

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

    // Get thread with user details
    const thread = await sql`
      SELECT 
        ct.*,
        r.origin_label,
        r.destination_label,
        r.departure_time,
        CONCAT(rider.first_name, ' ', rider.last_name) as rider_name,
        rider.avatar_url as rider_avatar,
        CONCAT(driver.first_name, ' ', driver.last_name) as driver_name,
        driver.avatar_url as driver_avatar
      FROM chat_threads ct
      JOIN rides r ON ct.ride_id = r.id
      JOIN users rider ON ct.rider_id = rider.id
      JOIN users driver ON ct.driver_id = driver.id
      WHERE ct.id = ${threadId}
      AND (ct.rider_id = ${user.id} OR ct.driver_id = ${user.id})
    `;

    if (thread.length === 0) {
      return Response.json({ error: 'Thread not found or unauthorized' }, { status: 404 });
    }

    return Response.json({
      success: true,
      thread: thread[0],
      currentUserId: user.id
    });

  } catch (error) {
    console.error('Error getting chat thread by ID:', error);
    return Response.json({ error: 'Failed to get chat thread' }, { status: 500 });
  }
}