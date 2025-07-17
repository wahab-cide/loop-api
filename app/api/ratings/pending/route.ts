import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const clerkId = url.searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ 
        success: false, 
        error: 'Clerk ID is required' 
      }, { status: 400 });
    }

    // Get user ID from clerk ID
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ 
        success: false, 
        error: 'User not found' 
      }, { status: 404 });
    }

    // Get completed bookings where user hasn't submitted ratings yet
    const pendingRatings = await sql`
      SELECT DISTINCT
        b.id as booking_id,
        b.ride_id,
        b.seats_booked,
        b.total_price,
        b.completed_at,
        
        -- Ride details
        r.origin_label as from_location,
        r.destination_label as to_location,
        r.departure_time,
        r.driver_id,
        
        -- Driver details (when user is rider)
        CASE 
          WHEN b.rider_id = ${user.id} THEN CONCAT(driver.first_name, ' ', COALESCE(driver.last_name, ''))
          ELSE null
        END as driver_name,
        CASE 
          WHEN b.rider_id = ${user.id} THEN driver.avatar_url
          ELSE null
        END as driver_avatar,
        CASE 
          WHEN b.rider_id = ${user.id} THEN driver.id
          ELSE null
        END as driver_user_id,
        
        -- Rider details (when user is driver)
        CASE 
          WHEN r.driver_id = ${user.id} THEN CONCAT(rider.first_name, ' ', COALESCE(rider.last_name, ''))
          ELSE null
        END as rider_name,
        CASE 
          WHEN r.driver_id = ${user.id} THEN rider.avatar_url
          ELSE null
        END as rider_avatar,
        CASE 
          WHEN r.driver_id = ${user.id} THEN rider.id
          ELSE null
        END as rider_user_id,
        
        -- User's role in this ride
        CASE 
          WHEN b.rider_id = ${user.id} THEN 'rider'
          WHEN r.driver_id = ${user.id} THEN 'driver'
          ELSE 'unknown'
        END as user_role,
        
        -- Missing rating types
        CASE 
          WHEN b.rider_id = ${user.id} AND NOT EXISTS (
            SELECT 1 FROM ride_ratings 
            WHERE booking_id = b.id 
            AND rater_id = ${user.id} 
            AND rating_type = 'driver_rating'
          ) THEN true
          ELSE false
        END as needs_driver_rating,
        
        CASE 
          WHEN r.driver_id = ${user.id} AND NOT EXISTS (
            SELECT 1 FROM ride_ratings 
            WHERE booking_id = b.id 
            AND rater_id = ${user.id} 
            AND rating_type = 'rider_rating'
          ) THEN true
          ELSE false
        END as needs_rider_rating

      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      LEFT JOIN users driver ON r.driver_id = driver.id
      LEFT JOIN users rider ON b.rider_id = rider.id
      
      WHERE b.status = 'completed'
      AND (b.rider_id = ${user.id} OR r.driver_id = ${user.id})
      AND b.completed_at IS NOT NULL
      AND b.completed_at >= NOW() - INTERVAL '30 days' -- Only last 30 days
      AND (
        -- User is rider and hasn't rated driver
        (b.rider_id = ${user.id} AND NOT EXISTS (
          SELECT 1 FROM ride_ratings 
          WHERE booking_id = b.id 
          AND rater_id = ${user.id} 
          AND rating_type = 'driver_rating'
        ))
        OR
        -- User is driver and hasn't rated rider
        (r.driver_id = ${user.id} AND NOT EXISTS (
          SELECT 1 FROM ride_ratings 
          WHERE booking_id = b.id 
          AND rater_id = ${user.id} 
          AND rating_type = 'rider_rating'
        ))
      )
      
      ORDER BY b.completed_at DESC
      LIMIT 20
    `;

    // Process the results to create clean rating prompts
    const ratingPrompts = pendingRatings.map(booking => {
      const baseInfo = {
        bookingId: booking.booking_id,
        rideId: booking.ride_id,
        fromLocation: booking.from_location,
        toLocation: booking.to_location,
        departureTime: booking.departure_time,
        completedAt: booking.completed_at,
        seatsBooked: booking.seats_booked,
        totalPrice: parseFloat(booking.total_price),
        userRole: booking.user_role
      };

      const ratings = [];

      // Add driver rating if needed
      if (booking.needs_driver_rating) {
        ratings.push({
          ...baseInfo,
          ratingType: 'driver_rating',
          ratedUserId: booking.driver_user_id,
          ratedUserName: booking.driver_name,
          ratedUserAvatar: booking.driver_avatar,
          ratingLabel: 'Rate Driver'
        });
      }

      // Add rider rating if needed
      if (booking.needs_rider_rating) {
        ratings.push({
          ...baseInfo,
          ratingType: 'rider_rating',
          ratedUserId: booking.rider_user_id,
          ratedUserName: booking.rider_name,
          ratedUserAvatar: booking.rider_avatar,
          ratingLabel: 'Rate Rider'
        });
      }

      return ratings;
    }).flat();

    return Response.json({
      success: true,
      data: {
        pendingRatings: ratingPrompts,
        count: ratingPrompts.length
      }
    });

  } catch (error) {
    console.error('Error fetching pending ratings:', error);
    return Response.json({
      success: false,
      error: 'Failed to fetch pending ratings',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}