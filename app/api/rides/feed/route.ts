// app/(api)/rides/feed+api.ts
import { getDatabase } from '@/lib/database';
import { formatDisplayAddress } from '@/lib/utils';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const latitude = parseFloat(url.searchParams.get('latitude') || '0');
    const longitude = parseFloat(url.searchParams.get('longitude') || '0');
    const radius = parseFloat(url.searchParams.get('radius') || '15'); // Default 15km radius for nearby rides
    const clerkId = url.searchParams.get('clerkId');

    if (process.env.NODE_ENV === 'development') console.log('Fetching rides feed:', { latitude, longitude, radius, clerkId });

    if (!latitude || !longitude) {
      return Response.json(
        { success: false, error: 'Latitude and longitude are required' },
        { status: 400 }
      );
    }

    if (!clerkId) {
      return Response.json(
        { success: false, error: 'User clerkId is required' },
        { status: 400 }
      );
    }

    // Get user's UUID to exclude their own rides
    const userResult = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    const userId = userResult.length > 0 ? userResult[0].id : null;

    // Optimized query using CTEs to eliminate duplicate calculations
    // Step 1: Pre-filter rides with bounding box for better performance
    // Step 2: Calculate distance and seat availability once per ride
    const nearbyRides = await sql`
      WITH ride_calculations AS (
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
          r.status,
          r.created_at,
          r.driver_id,
          -- Calculate distance using Haversine formula (once)
          (
            6371 * acos(
              cos(radians(${latitude})) * 
              cos(radians(r.origin_lat)) * 
              cos(radians(r.origin_lng) - radians(${longitude})) + 
              sin(radians(${latitude})) * 
              sin(radians(r.origin_lat))
            )
          ) as distance_km,
          -- Calculate real-time seat availability (once)
          calculate_actual_seats_available(r.id) as actual_seats_available
        FROM rides r
        WHERE 
          r.status IN ('open', 'full')
          AND r.departure_time > NOW()
          ${userId ? sql`AND r.driver_id != ${userId}` : sql``}
          -- Pre-filter with bounding box (much faster than Haversine)
          AND r.origin_lat BETWEEN ${latitude - (radius / 111.0)} AND ${latitude + (radius / 111.0)}
          AND r.origin_lng BETWEEN ${longitude - (radius / (111.0 * Math.cos(latitude * Math.PI / 180)))} AND ${longitude + (radius / (111.0 * Math.cos(latitude * Math.PI / 180)))}
      )
      SELECT 
        rc.*,
        -- Driver details
        u.clerk_id as driver_clerk_id,
        CONCAT(u.first_name, ' ', u.last_name) as driver_name,
        u.first_name as driver_first_name,
        u.last_name as driver_last_name,
        u.avatar_url as driver_avatar,
        u.phone as driver_phone,
        u.rating_driver,
        -- Vehicle details
        u.vehicle_make,
        u.vehicle_model,
        u.vehicle_year,
        u.vehicle_color,
        u.vehicle_plate
      FROM ride_calculations rc
      JOIN users u ON rc.driver_id = u.id
      WHERE 
        -- Apply precise distance filter after pre-filtering
        rc.distance_km <= ${radius}
        -- Only show rides with actual availability
        AND rc.actual_seats_available > 0
      ORDER BY rc.distance_km ASC, rc.departure_time ASC
      LIMIT 25
    `;

        // Transform the data
    const transformedRides = nearbyRides.map(ride => ({
      id: ride.ride_id,
      origin_address: formatDisplayAddress(ride.origin_label),
      destination_address: formatDisplayAddress(ride.destination_label),
      origin_latitude: parseFloat(ride.origin_lat),
      origin_longitude: parseFloat(ride.origin_lng),
      destination_latitude: parseFloat(ride.destination_lat),
      destination_longitude: parseFloat(ride.destination_lng),
      departure_time: ride.departure_time,
      arrival_time: ride.arrival_time,
      fare_price: parseFloat(ride.price),
      currency: ride.currency,
      seats_total: ride.seats_total,
      seats_available: ride.actual_seats_available,
      status: ride.status,
      created_at: ride.created_at,
      distance_km: parseFloat(ride.distance_km),
      driver: {
        id: ride.driver_id,
        clerk_id: ride.driver_clerk_id,
        name: ride.driver_name,
        first_name: ride.driver_first_name,
        last_name: ride.driver_last_name,
        profile_image_url: ride.driver_avatar,
        phone: ride.driver_phone,
        rating: parseFloat(ride.rating_driver) || 5.0
      },
      car: ride.vehicle_make ? {
        make: ride.vehicle_make,
        model: ride.vehicle_model,
        year: ride.vehicle_year,
        color: ride.vehicle_color,
        plate: ride.vehicle_plate,
        seats: ride.seats_total
      } : null
    }));

    return Response.json({
      success: true,
      rides: transformedRides,
      count: transformedRides.length,
      userLocation: { latitude, longitude },
      radius
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.error('Error fetching rides feed:', error);
    
    return Response.json(
      { 
        success: false,
        error: 'Failed to fetch rides feed',
        details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
      },
      { status: 500 }
    );
  }
}