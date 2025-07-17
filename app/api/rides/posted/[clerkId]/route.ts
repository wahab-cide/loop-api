import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { formatDisplayAddress } from '@/lib/utils';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    // Extract clerkId from the URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const clerkId = pathParts[pathParts.length - 1]; // Get the last part of the path
    
    if (!clerkId) {
      return Response.json(
        { success: false, error: 'ClerkId parameter is required' },
        { status: 400 }
      );
    }
    
    console.log('Fetching posted rides for driver with clerkId:', clerkId);

    // First, get the user's UUID from clerk_id
    const userResult = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (userResult.length === 0) {
      return Response.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = userResult[0].id;
    console.log('Found user ID:', userId);

    // Fetch user's posted rides with booking details
    const postedRides = await sql`
      SELECT 
        r.id as ride_id,
        r.origin_label,
        r.destination_label,
        r.origin_lat,
        r.origin_lng,
        r.destination_lat,
        r.destination_lng,
        r.departure_time,
        r.arrival_time,
        r.price,
        r.currency,
        r.seats_total,
        r.seats_available,
        r.status as ride_status,
        r.created_at as ride_created_at,
        r.updated_at as ride_updated_at,
        -- Count total paid/completed bookings
        COUNT(CASE WHEN b.status IN ('paid', 'completed') THEN b.id END) as total_bookings,
        -- Count seats booked (paid/completed only)
        COALESCE(SUM(CASE WHEN b.status IN ('paid', 'completed') THEN b.seats_booked ELSE 0 END), 0) as total_seats_booked,
        -- Calculate earnings (paid/completed only)
        COALESCE(SUM(CASE WHEN b.status IN ('paid', 'completed') THEN b.total_price ELSE 0 END), 0) as total_earnings,
        -- Count pending booking requests that need approval
        COUNT(CASE WHEN b.status = 'pending' AND b.approval_status = 'pending' THEN b.id END) as pending_requests
      FROM rides r
      LEFT JOIN bookings b ON r.id = b.ride_id
      WHERE r.driver_id = ${userId}
      GROUP BY r.id, r.origin_label, r.destination_label, r.origin_lat, r.origin_lng, 
               r.destination_lat, r.destination_lng, r.departure_time, r.arrival_time, 
               r.price, r.currency, r.seats_total, r.seats_available, r.status, 
               r.created_at, r.updated_at
      ORDER BY r.created_at DESC
    `;

    console.log(`Found ${postedRides.length} posted rides for driver`);

    // Transform the data for frontend consumption
    const transformedRides = postedRides.map(ride => ({
      rideId: ride.ride_id,
      from: formatDisplayAddress(ride.origin_label),
      to: formatDisplayAddress(ride.destination_label),
      departureTime: ride.departure_time,
      arrivalTime: ride.arrival_time,
      createdAt: ride.ride_created_at,
      updatedAt: ride.ride_updated_at,
      pricePerSeat: parseFloat(ride.price),
      currency: ride.currency,
      rideStatus: ride.ride_status, // open, full, completed, cancelled
      coordinates: {
        origin: {
          latitude: parseFloat(ride.origin_lat),
          longitude: parseFloat(ride.origin_lng)
        },
        destination: {
          latitude: parseFloat(ride.destination_lat),
          longitude: parseFloat(ride.destination_lng)
        }
      },
      capacity: {
        total: ride.seats_total,
        available: ride.seats_available,
        booked: parseInt(ride.total_seats_booked)
      },
      bookings: {
        count: parseInt(ride.total_bookings),
        totalEarnings: parseFloat(ride.total_earnings),
        pendingRequests: parseInt(ride.pending_requests)
      }
    }));

    return Response.json({
      success: true,
      rides: transformedRides,
      count: transformedRides.length
    });

  } catch (error) {
    console.error('Error fetching posted rides:', error);
    
    return Response.json(
      { 
        success: false,
        error: 'Failed to fetch posted rides',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}