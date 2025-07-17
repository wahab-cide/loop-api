import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { formatDisplayAddress } from '@/lib/utils';


export async function GET(request: Request) {
  // Extract clerkId from the URL path
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const clerkId = pathParts[pathParts.length - 1]; // Get the last part of the path
  
  try {
    const sql = getDatabase();
    
    if (!clerkId) {
      return Response.json(
        { success: false, error: 'ClerkId parameter is required' },
        { status: 400 }
      );
    }
    
    console.log('Fetching rides for user with clerkId:', clerkId);

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

    // Optimized query using LEFT JOIN to eliminate EXISTS and correlated subqueries
    const userRides = await sql`
      SELECT 
        b.id as booking_id,
        b.seats_booked,
        b.status as booking_status,
        b.approval_status,
        b.price_per_seat,
        b.total_price,
        b.currency,
        b.created_at as booking_date,
        b.updated_at as booking_updated,
        b.completed_at as booking_completed_at,
        b.rating_submitted,
        r.id as ride_id,
        r.origin_label,
        r.destination_label,
        r.origin_lat,
        r.origin_lng,
        r.destination_lat,
        r.destination_lng,
        r.departure_time,
        r.arrival_time,
        r.price as ride_price,
        r.status as ride_status,
        r.seats_total,
        r.seats_available,
        r.created_at as ride_created_at,
        r.completed_at as ride_completed_at,
        r.auto_completed,
        u.id as driver_id,
        u.clerk_id as driver_clerk_id,
        CONCAT(u.first_name, ' ', u.last_name) as driver_name,
        u.avatar_url as driver_avatar,
        u.phone as driver_phone,
        COALESCE(u.rating_driver, 5.00) as rating_driver,
        u.vehicle_make,
        u.vehicle_model,
        u.vehicle_year,
        u.vehicle_color,
        u.vehicle_plate,
        
        -- Check if user has rated the driver for this booking (using LEFT JOIN)
        CASE 
          WHEN rr.id IS NOT NULL THEN true 
          ELSE false 
        END as has_rated_driver,
        
        -- Get the rating if it exists (using LEFT JOIN)
        rr.rating as user_driver_rating
        
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      JOIN users u ON r.driver_id = u.id
      LEFT JOIN ride_ratings rr ON (
        rr.booking_id = b.id 
        AND rr.rater_id = ${userId} 
        AND rr.rating_type = 'driver_rating'
      )
      WHERE b.rider_id = ${userId}
      ORDER BY b.created_at DESC
    `;

    console.log(`Found ${userRides.length} rides for user`);

    // Transform the data for frontend consumption
    const transformedRides = userRides.map(ride => ({
      bookingId: ride.booking_id,
      rideId: ride.ride_id,
      from: formatDisplayAddress(ride.origin_label),
      to: formatDisplayAddress(ride.destination_label),
      departureTime: ride.departure_time,
      arrivalTime: ride.arrival_time,
      bookingDate: ride.booking_date,
      lastUpdated: ride.booking_updated,
      completedAt: ride.booking_completed_at,
      seatsBooked: ride.seats_booked,
      pricePerSeat: parseFloat(ride.price_per_seat),
      totalPaid: parseFloat(ride.total_price),
      currency: ride.currency,
      bookingStatus: ride.booking_status, // pending, paid, completed, cancelled, expired
      approvalStatus: ride.approval_status, // pending, approved, rejected
      rideStatus: ride.ride_status, // open, full, completed, cancelled, expired
      rideCompletedAt: ride.ride_completed_at,
      autoCompleted: ride.auto_completed,
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
      driver: {
        id: ride.driver_id,
        clerkId: ride.driver_clerk_id,
        name: ride.driver_name,
        avatar: ride.driver_avatar,
        phone: ride.driver_phone,
        rating: parseFloat(ride.rating_driver) || 5.0
      },
      vehicle: ride.vehicle_make ? {
        make: ride.vehicle_make,
        model: ride.vehicle_model,
        year: ride.vehicle_year,
        color: ride.vehicle_color,
        plate: ride.vehicle_plate,
        displayName: `${ride.vehicle_year} ${ride.vehicle_make} ${ride.vehicle_model}`
      } : null,
      capacity: {
        total: ride.seats_total,
        available: ride.seats_available
      },
      rating: {
        hasRatedDriver: ride.has_rated_driver,
        userDriverRating: ride.user_driver_rating ? parseInt(ride.user_driver_rating) : null,
        ratingSubmitted: ride.rating_submitted,
        canRate: ride.booking_status === 'completed' && !ride.has_rated_driver
      }
    }));

    return Response.json({
      success: true,
      rides: transformedRides,
      count: transformedRides.length
    });

  } catch (error) {
    console.error('Error fetching user rides:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      clerkId: clerkId
    });
    
    return Response.json(
      { 
        success: false,
        error: 'Failed to fetch rides',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}