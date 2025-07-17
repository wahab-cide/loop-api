import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { NotificationService } from '@/lib/notificationService';


interface CreateBookingRequest {
  clerkId: string;
  rideId: string;
  seatsRequested: number;
  paymentIntentId?: string; // Optional Stripe payment ID
  status?: 'pending' | 'paid'; // Allow explicit status
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const body: CreateBookingRequest = await request.json();
    const { clerkId, rideId, seatsRequested, paymentIntentId, status } = body;

    // Validate required fields
    if (!clerkId || !rideId || !seatsRequested) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (seatsRequested <= 0 || seatsRequested > 8) {
      return Response.json({ error: 'Invalid number of seats' }, { status: 400 });
    }

        // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const riderId = user.id;

    // Execute the booking creation without transaction for now (since Neon serverless has transaction limitations)
        // 1️⃣ Get ride information and validate
    const [ride] = await sql`
      SELECT 
        id,
        seats_total,
        seats_available,
        price,
        currency,
        status,
        driver_id
      FROM rides 
      WHERE id = ${rideId}
    `;

    if (!ride) {
      throw new Error('Ride not found');
    }

        // 2️⃣ Validate ride status first
    if (ride.status !== 'open' && ride.status !== 'full') {
      throw new Error(`Ride is ${ride.status} and cannot accept bookings`);
    }

    // 3️⃣ Use database function to validate booking request with real-time calculation
    const [validation] = await sql`
      SELECT * FROM validate_booking_request(${rideId}::UUID, ${seatsRequested})
    `;

    if (!validation.is_valid) {
      throw new Error(validation.error_message);
    }

    // Prevent driver from booking their own ride
    if (ride.driver_id === riderId) {
      throw new Error('Driver cannot book their own ride');
    }

    // Check if user already has a booking for this ride
    const [existingBooking] = await sql`
      SELECT id FROM bookings 
      WHERE ride_id = ${rideId} 
      AND rider_id = ${riderId} 
      AND status IN ('pending', 'paid')
    `;

    if (existingBooking) {
      throw new Error('You already have a booking for this ride');
    }

        // 3️⃣ Insert booking with payment status
    // Determine booking status
    let bookingStatus = 'pending';
    if (status) {
      bookingStatus = status;
    } else if (paymentIntentId) {
      bookingStatus = 'paid';
    }

    const [booking] = await sql`
      INSERT INTO bookings (
        ride_id, 
        rider_id, 
        seats_booked,
        price_per_seat, 
        currency, 
        status
      ) VALUES (
        ${rideId}, 
        ${riderId}, 
        ${seatsRequested},
        ${ride.price}, 
        ${ride.currency}, 
        ${bookingStatus}
      ) RETURNING id, total_price, created_at
    `;

        // 4️⃣ Sync ride availability - the database trigger will handle this automatically
    // But we'll also call it explicitly to ensure consistency
    await sql`SELECT sync_ride_seats_available(${rideId}::UUID)`;


    // 5️⃣ Store the payment intent if provided
    if (paymentIntentId) {
      // You could store this in a separate payments table if needed
    }

    const result = booking.id;

    const bookingId = result;

        // Send notification to driver about new booking request
    try {
      await NotificationService.notifyBookingRequest(bookingId);
    } catch (notificationError) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to send booking notification:', notificationError);
      }
      // Don't fail the booking creation if notification fails
    }

    // Return success response
    return Response.json({ 
      success: true, 
      bookingId,
      message: 'Booking created successfully'
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Booking creation error:', error);
    }
    
    // Return user-friendly error messages
    const errorMessage = error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Failed to create booking';
    
    return Response.json({ 
      success: false,
      error: errorMessage 
    }, { status: 400 });
  }
}

// GET endpoint for testing
export async function GET() {
  return Response.json({ 
    message: 'Booking creation API is working',
    timestamp: new Date().toISOString()
  });
}