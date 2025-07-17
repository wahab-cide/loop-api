import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const clerkId = url.searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'ClerkId required' }, { status: 400 });
    }

    // Get user's database ID
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Optimized query using CTEs and window functions to eliminate correlated subqueries
    const threads = await sql`
      WITH thread_messages AS (
        SELECT 
          cm.thread_id,
          cm.content,
          cm.created_at,
          cm.sender_id,
          cm.read_by_rider,
          cm.read_by_driver,
          -- Get the latest message per thread
          ROW_NUMBER() OVER (PARTITION BY cm.thread_id ORDER BY cm.created_at DESC) as rn
        FROM chat_messages cm
        WHERE cm.content IS NOT NULL AND cm.content != ''
      ),
      thread_unread_counts AS (
        SELECT 
          cm.thread_id,
          COUNT(*)::int as unread_count
        FROM chat_messages cm
        JOIN chat_threads ct ON cm.thread_id = ct.id
        WHERE 
          cm.sender_id != ${user.id}
          AND (
            (${user.id} = ct.rider_id AND cm.read_by_rider = FALSE) OR
            (${user.id} = ct.driver_id AND cm.read_by_driver = FALSE)
          )
        GROUP BY cm.thread_id
      )
      SELECT 
        ct.*,
        r.origin_label,
        r.destination_label,
        r.departure_time,
        CONCAT(rider.first_name, ' ', rider.last_name) as rider_name,
        rider.first_name as rider_first_name,
        rider.last_name as rider_last_name,
        rider.avatar_url as rider_avatar,
        CONCAT(driver.first_name, ' ', driver.last_name) as driver_name,
        driver.first_name as driver_first_name,
        driver.last_name as driver_last_name,
        driver.avatar_url as driver_avatar,
        tm.content as last_message,
        COALESCE(tuc.unread_count, 0) as unread_count
      FROM chat_threads ct
      JOIN rides r ON ct.ride_id = r.id
      JOIN users rider ON ct.rider_id = rider.id
      JOIN users driver ON ct.driver_id = driver.id
      LEFT JOIN thread_messages tm ON ct.id = tm.thread_id AND tm.rn = 1
      LEFT JOIN thread_unread_counts tuc ON ct.id = tuc.thread_id
      WHERE ct.rider_id = ${user.id} OR ct.driver_id = ${user.id}
      ORDER BY ct.last_message_at DESC NULLS LAST, ct.created_at DESC
    `;

    return Response.json({
      success: true,
      threads: threads,
      currentUserId: user.id
    });

  } catch (error) {
    console.error('Error getting chat threads:', error);
    return Response.json({ error: 'Failed to get chat threads' }, { status: 500 });
  }
}