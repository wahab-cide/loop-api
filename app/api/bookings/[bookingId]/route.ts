import 'dotenv/config';
import { getDatabase } from '@/lib/database';


export async function GET(request: Request, { params }: { params?: { bookingId?: string } }) {
  // Extract bookingId from URL path as fallback (move outside try block)
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const bookingId = params?.bookingId || pathParts[pathParts.length - 1];

  try {
    const sql = getDatabase();

    if (!bookingId) {
      return Response.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    console.log('Fetching booking details for:', bookingId);

    // Fetch booking details with ride and driver information
    const [booking] = await sql`
      SELECT 
        b.id as booking_id,
        b.ride_id,
        b.seats_booked,
        b.price_per_seat,
        b.total_price,
        b.currency,
        b.status as booking_status,
        b.approval_status,
        b.created_at as booking_date,
        b.updated_at as last_updated,
        
        -- Ride information
        r.origin_label as from_location,
        r.destination_label as to_location,
        r.departure_time,
        r.arrival_time,
        r.seats_total,
        r.seats_available,
        r.status as ride_status,
        r.origin_lat,
        r.origin_lng,
        r.destination_lat,
        r.destination_lng,
        
        -- Driver information
        u.id as driver_id,
        u.clerk_id as driver_clerk_id,
        CONCAT(u.first_name, ' ', u.last_name) as driver_name,
        u.avatar_url as driver_avatar,
        u.phone as driver_phone,
        COALESCE(u.rating_driver, 5.00) as driver_rating,
        u.vehicle_make,
        u.vehicle_model,
        u.vehicle_year,
        u.vehicle_color,
        u.vehicle_plate
        
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      JOIN users u ON r.driver_id = u.id
      WHERE b.id = ${bookingId}
    `;

    if (!booking) {
      return Response.json({ 
        success: false, 
        error: 'Booking not found' 
      }, { status: 404 });
    }

    // Format the response
    const formattedBooking = {
      bookingId: booking.booking_id,
      rideId: booking.ride_id,
      from: booking.from_location,
      to: booking.to_location,
      departureTime: booking.departure_time,
      arrivalTime: booking.arrival_time,
      bookingDate: booking.booking_date,
      lastUpdated: booking.last_updated,
      seatsBooked: booking.seats_booked,
      pricePerSeat: parseFloat(booking.price_per_seat),
      totalPaid: parseFloat(booking.total_price),
      currency: booking.currency,
      bookingStatus: booking.booking_status,
      approvalStatus: booking.approval_status,
      rideStatus: booking.ride_status,
      coordinates: {
        origin: { 
          latitude: parseFloat(booking.origin_lat), 
          longitude: parseFloat(booking.origin_lng) 
        },
        destination: { 
          latitude: parseFloat(booking.destination_lat), 
          longitude: parseFloat(booking.destination_lng) 
        }
      },
      driver: {
        id: booking.driver_id,
        clerkId: booking.driver_clerk_id,
        name: booking.driver_name,
        avatar: booking.driver_avatar,
        phone: booking.driver_phone,
        rating: parseFloat(booking.driver_rating) || 5.0
      },
      vehicle: booking.vehicle_make ? {
        make: booking.vehicle_make,
        model: booking.vehicle_model,
        year: booking.vehicle_year,
        color: booking.vehicle_color,
        plate: booking.vehicle_plate,
        displayName: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`
      } : null,
      capacity: {
        total: booking.seats_total,
        available: booking.seats_available
      }
    };

    return Response.json({ 
      success: true, 
      booking: formattedBooking 
    });

  } catch (error) {
    console.error('Error fetching booking details:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      bookingId: bookingId
    });
    
    return Response.json({ 
      success: false, 
      error: `Failed to fetch booking details: ${error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'}`,
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : undefined
    }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params?: { bookingId?: string } }) {
  try {
    const sql = getDatabase();
    // Extract bookingId from URL path as fallback
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const bookingId = params?.bookingId || pathParts[pathParts.length - 1];

    if (!bookingId) {
      return Response.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { paymentIntentId, status } = body;

    console.log('Updating booking for payment:', { bookingId, paymentIntentId, status });

    // Get existing booking to verify it exists and is in correct state
    const [existingBooking] = await sql`
      SELECT 
        id, 
        status as current_status, 
        approval_status,
        ride_id,
        rider_id
      FROM bookings 
      WHERE id = ${bookingId}
    `;

    if (!existingBooking) {
      return Response.json({ 
        success: false, 
        error: 'Booking not found' 
      }, { status: 404 });
    }

    // Verify booking is approved and can be paid
    if (existingBooking.approval_status !== 'approved') {
      return Response.json({ 
        success: false, 
        error: 'Booking must be approved by driver before payment' 
      }, { status: 400 });
    }

    if (existingBooking.current_status !== 'pending') {
      return Response.json({ 
        success: false, 
        error: `Booking is already ${existingBooking.current_status}` 
      }, { status: 400 });
    }

    // Update booking status to paid
    await sql`
      UPDATE bookings 
      SET 
        status = 'paid',
        payment_intent_id = ${paymentIntentId || null},
        updated_at = NOW()
      WHERE id = ${bookingId}
    `;

    console.log('Booking payment completed successfully:', bookingId);

    // Send payment confirmation notifications
    try {
    const sql = getDatabase();
      const { NotificationService } = await import('@/lib/notificationService');
      await NotificationService.notifyPaymentConfirmation(bookingId);
    } catch (notifError) {
      console.error('Error sending payment confirmation notification:', notifError);
      // Don't fail the request if notification fails
    }

    return Response.json({ 
      success: true, 
      message: 'Booking payment completed successfully',
      bookingId: bookingId
    });

  } catch (error) {
    console.error('Error updating booking payment:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to complete booking payment' 
    }, { status: 500 });
  }
}