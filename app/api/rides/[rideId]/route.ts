import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { formatDisplayAddress } from '@/lib/utils';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    // Extract rideId from the URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const rideId = pathParts[pathParts.length - 1]; // Get the last part of the path
    
    if (!rideId) {
      return Response.json(
        { success: false, error: 'RideId parameter is required' },
        { status: 400 }
      );
    }
    
    console.log('Fetching ride details for rideId:', rideId);

    // Fetch ride details with driver and vehicle information
    const rideDetails = await sql`
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
        u.rating_driver
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.id = ${rideId}
    `;

    console.log('Database query completed');

    if (rideDetails.length === 0) {
      return Response.json(
        { success: false, error: 'Ride not found' },
        { status: 404 }
      );
    }

    const ride = rideDetails[0];

    // Transform the data to match frontend expectations
    const transformedRide = {
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
      distance_from_user: 0, // Not calculated for individual ride fetch
      destination_distance: 0,
    };

    console.log('Transformed ride data successfully');

    return Response.json({ 
      success: true, 
      ride: transformedRide
    });

  } catch (error) {
    console.error('Error fetching ride details:', error);
    return Response.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
      }, 
      { status: 500 }
    );
  }
}