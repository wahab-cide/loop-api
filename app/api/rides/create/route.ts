// Ride creation API route for Expo Router
import { getDatabase } from '@/lib/database';
import { NotificationService } from '@/lib/notificationService';


interface CreateRideRequest {
  clerkId: string;
  originLabel: string;
  originLat: number;
  originLng: number;
  destinationLabel: string;
  destinationLat: number;
  destinationLng: number;
  departureTime: string; // ISO string
  arrivalTime?: string; // ISO string, optional
  seatsTotal: number;
  price: number;
  currency?: string;
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const body: CreateRideRequest = await request.json();
    const {
      clerkId,
      originLabel,
      originLat,
      originLng,
      destinationLabel,
      destinationLat,
      destinationLng,
      departureTime,
      arrivalTime,
      seatsTotal,
      price,
      currency = 'USD'
    } = body;

    // Validate required fields
    if (!clerkId || !originLabel || !destinationLabel || !departureTime || !seatsTotal || !price) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate coordinates
    if (Math.abs(originLat) > 90 || Math.abs(originLng) > 180 ||
        Math.abs(destinationLat) > 90 || Math.abs(destinationLng) > 180) {
      return Response.json({ error: 'Invalid coordinates' }, { status: 400 });
    }

    // Validate seats and price
    if (seatsTotal < 1 || seatsTotal > 8) {
      return Response.json({ error: 'Seats must be between 1 and 8' }, { status: 400 });
    }

    if (price <= 0) {
      return Response.json({ error: 'Price must be greater than 0' }, { status: 400 });
    }

    // Validate departure time is in the future
    const departureDate = new Date(departureTime);
    if (departureDate <= new Date()) {
      return Response.json({ error: 'Departure time must be in the future' }, { status: 400 });
    }

    // Validate arrival time if provided
    if (arrivalTime) {
      const arrivalDate = new Date(arrivalTime);
      if (arrivalDate <= departureDate) {
        return Response.json({ error: 'Arrival time must be after departure time' }, { status: 400 });
      }
    }

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id, is_driver 
      FROM users 
      WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.is_driver) {
      return Response.json({ error: 'User is not registered as a driver' }, { status: 403 });
    }

    // Create the ride
    const [newRide] = await sql`
      INSERT INTO rides (
        driver_id,
        origin_label,
        origin_lat,
        origin_lng,
        destination_label,
        destination_lat,
        destination_lng,
        departure_time,
        arrival_time,
        seats_total,
        seats_available,
        price,
        currency
      ) VALUES (
        ${user.id},
        ${originLabel},
        ${originLat},
        ${originLng},
        ${destinationLabel},
        ${destinationLat},
        ${destinationLng},
        ${departureTime},
        ${arrivalTime || null},
        ${seatsTotal},
        ${seatsTotal}, -- initially all seats are available
        ${price},
        ${currency}
      )
      RETURNING id, created_at
    `;

    // Send notifications to nearby users about the new ride
    try {
    const sql = getDatabase();
      await NotificationService.notifyRidePostedNearby(
        newRide.id, 
        originLat, 
        originLng, 
        destinationLat, 
        destinationLng
      );
    } catch (notificationError) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to send nearby ride notifications:', notificationError);
      }
      // Don't fail the ride creation if notification fails
    }

    return Response.json({ 
      success: true, 
      rideId: newRide.id,
      message: 'Ride created successfully' 
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Create ride error:', error);
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}