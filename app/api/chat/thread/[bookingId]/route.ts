import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const bookingId = url.pathname.split('/').pop()?.replace('+api', '');
    const clerkId = url.searchParams.get('clerkId');

    if (!clerkId || !bookingId) {
      return Response.json({ error: 'ClerkId and bookingId required' }, { status: 400 });
    }

    // Get user's database ID
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if thread exists
    let thread = await sql`
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
      WHERE ct.booking_id = ${bookingId}
      AND (ct.rider_id = ${user.id} OR ct.driver_id = ${user.id})
    `;

    // If no thread exists, create one
    if (thread.length === 0) {
      // Get booking details
      const [booking] = await sql`
        SELECT 
          b.*,
          r.driver_id,
          r.origin_label,
          r.destination_label,
          r.departure_time
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        WHERE b.id = ${bookingId}
        AND (b.rider_id = ${user.id} OR r.driver_id = ${user.id})
      `;

      if (!booking) {
        return Response.json({ error: 'Booking not found or unauthorized' }, { status: 404 });
      }

      // Create thread
      const [newThread] = await sql`
        INSERT INTO chat_threads (
          booking_id,
          ride_id,
          rider_id,
          driver_id
        ) VALUES (
          ${bookingId},
          ${booking.ride_id},
          ${booking.rider_id},
          ${booking.driver_id}
        ) RETURNING *
      `;

      // Get thread with user details
      thread = await sql`
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
        WHERE ct.id = ${newThread.id}
      `;
    }

    return Response.json({
      success: true,
      thread: thread[0],
      currentUserId: user.id
    });

  } catch (error) {
    console.error('Error getting chat thread:', error);
    return Response.json({ error: 'Failed to get chat thread' }, { status: 500 });
  }
}