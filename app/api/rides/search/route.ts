import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { formatDisplayAddress } from '@/lib/utils';


interface SearchRidesRequest {
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  userLat: number;
  userLng: number;
  radiusKm?: number; // Search radius in kilometers
}

export async function GET() {
  return Response.json({ 
    message: 'Ride search API working',
    endpoint: '/(api)/rides/search',
    methods: ['GET', 'POST']
  });
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const body: SearchRidesRequest = await request.json();
    
    const {
      destinationAddress,
      destinationLat,
      destinationLng,
      userLat,
      userLng,
      radiusKm = 10 // Default 10km radius
    } = body;

    // Validate required fields
    if (!destinationAddress || !destinationLat || !destinationLng || !userLat || !userLng) {
      return Response.json({ error: 'Missing required location data' }, { status: 400 });
    }

    // Search for rides using Haversine formula for distance calculation
    // This finds rides where:
    // 1. The destination is similar (within 5km of requested destination)
    // 2. The origin is within the specified radius of the user's location
    // 3. The ride is still open and in the future
    const rides = await sql`
      SELECT 
        r.id,
        r.driver_id,
        r.origin_label,
        r.origin_lat,
        r.origin_lng,
        r.destination_label,
        r.destination_lat,
        r.destination_lng,
        r.departure_time,
        r.arrival_time,
        r.seats_available,
        r.seats_total,
        r.price,
        r.currency,
        r.status,
        CONCAT(u.first_name, ' ', u.last_name) as name,
        u.avatar_url,
        u.vehicle_make,
        u.vehicle_model,
        u.vehicle_year,
        u.vehicle_color,
        u.vehicle_plate,
        u.rating_driver,
        -- Calculate distance from user's location to ride origin
        (
          6371 * acos(
            cos(radians(${userLat})) * 
            cos(radians(r.origin_lat)) * 
            cos(radians(r.origin_lng) - radians(${userLng})) + 
            sin(radians(${userLat})) * 
            sin(radians(r.origin_lat))
          )
        ) AS distance_from_user,
        -- Calculate distance from requested destination to ride destination
        (
          6371 * acos(
            cos(radians(${destinationLat})) * 
            cos(radians(r.destination_lat)) * 
            cos(radians(r.destination_lng) - radians(${destinationLng})) + 
            sin(radians(${destinationLat})) * 
            sin(radians(r.destination_lat))
          )
        ) AS destination_distance
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE 
        r.status = 'open'
        AND r.seats_available > 0
        AND r.departure_time > NOW()
        AND u.is_driver = TRUE
        -- Destination must be within 5km of requested destination
        AND (
          6371 * acos(
            cos(radians(${destinationLat})) * 
            cos(radians(r.destination_lat)) * 
            cos(radians(r.destination_lng) - radians(${destinationLng})) + 
            sin(radians(${destinationLat})) * 
            sin(radians(r.destination_lat))
          )
        ) <= 5
        -- Origin must be within specified radius of user's location
        AND (
          6371 * acos(
            cos(radians(${userLat})) * 
            cos(radians(r.origin_lat)) * 
            cos(radians(r.origin_lng) - radians(${userLng})) + 
            sin(radians(${userLat})) * 
            sin(radians(r.origin_lat))
          )
        ) <= ${radiusKm}
      ORDER BY distance_from_user ASC, r.departure_time ASC
      LIMIT 20
    `;

        // Transform the data to match frontend expectations
    const transformedRides = rides.map((ride: any) => ({
      id: ride.id,
      driver_id: ride.driver_id,
      origin: {
        label: formatDisplayAddress(ride.origin_label),
        latitude: Number(ride.origin_lat),
        longitude: Number(ride.origin_lng),
      },
      destination: {
        label: formatDisplayAddress(ride.destination_label),
        latitude: Number(ride.destination_lat),
        longitude: Number(ride.destination_lng),
      },
      departure_time: ride.departure_time,
      arrival_time: ride.arrival_time,
      seats_available: ride.seats_available,
      seats_total: ride.seats_total,
      price: Number(ride.price),
      currency: ride.currency,
      status: ride.status,
      driver: {
        name: ride.name,
        avatar_url: ride.avatar_url,
        rating: Number(ride.rating_driver) || 5.0,
        vehicle: {
          make: ride.vehicle_make,
          model: ride.vehicle_model,
          year: ride.vehicle_year,
          color: ride.vehicle_color,
          plate: ride.vehicle_plate,
        },
      },
      distance_from_user: Number(ride.distance_from_user),
      destination_distance: Number(ride.destination_distance),
    }));

        return Response.json({ 
      success: true, 
      rides: transformedRides,
      total: rides.length 
    });

  } catch (error) {
    console.error('Search rides error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}