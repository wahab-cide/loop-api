import 'dotenv/config';
import { getDatabase } from '@/lib/database';


export async function GET(request: Request, { params }: { params?: { rideId?: string } }) {
  try {
    const sql = getDatabase();
    // Extract rideId from URL path as fallback
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const rideId = params?.rideId || pathParts[pathParts.length - 2]; // -2 because path ends with 'details'

    if (!rideId) {
      return Response.json({ error: 'Ride ID is required' }, { status: 400 });
    }

    console.log('Fetching posted ride details for:', rideId);

    // Fetch ride details
    const [ride] = await sql`
      SELECT 
        r.id as ride_id,
        r.origin_label as from_location,
        r.destination_label as to_location,
        r.departure_time,
        r.arrival_time,
        r.seats_total,
        r.seats_available,
        r.price,
        r.currency,
        r.status as ride_status,
        r.created_at,
        r.updated_at,
        r.origin_lat,
        r.origin_lng,
        r.destination_lat,
        r.destination_lng
      FROM rides r
      WHERE r.id = ${rideId}
    `;

    if (!ride) {
      return Response.json({ 
        success: false, 
        error: 'Ride not found' 
      }, { status: 404 });
    }

    // Fetch all bookings for this ride
    const bookings = await sql`
      SELECT 
        b.id as booking_id,
        b.seats_booked,
        b.total_price,
        b.currency as booking_currency,
        b.status as booking_status,
        b.approval_status,
        b.created_at,
        
        -- Rider information
        u.id as rider_id,
        CONCAT(u.first_name, ' ', u.last_name) as rider_name,
        u.avatar_url as rider_avatar,
        u.phone as rider_phone,
        COALESCE(u.rating_rider, 5.00) as rider_rating
        
      FROM bookings b
      JOIN users u ON b.rider_id = u.id
      WHERE b.ride_id = ${rideId}
      ORDER BY b.created_at DESC
    `;

    // Calculate totals
    const totalBooked = bookings.reduce((sum: number, booking: any) => {
      return booking.booking_status !== 'cancelled' ? sum + booking.seats_booked : sum;
    }, 0);

    const totalEarnings = bookings.reduce((sum: number, booking: any) => {
      return booking.booking_status === 'paid' || booking.booking_status === 'completed' 
        ? sum + parseFloat(booking.total_price) 
        : sum;
    }, 0);

    // Format bookings
    const formattedBookings = bookings.map((booking: any) => ({
      bookingId: booking.booking_id,
      riderId: booking.rider_id,
      riderName: booking.rider_name,
      riderAvatar: booking.rider_avatar,
      riderPhone: booking.rider_phone,
      riderRating: parseFloat(booking.rider_rating) || 5.0,
      seatsRequested: booking.seats_booked,
      totalAmount: parseFloat(booking.total_price),
      currency: booking.booking_currency,
      status: booking.booking_status,
      approvalStatus: booking.approval_status,
      createdAt: booking.created_at
    }));

    // Format the response
    const formattedRide = {
      rideId: ride.ride_id,
      from: ride.from_location,
      to: ride.to_location,
      departureTime: ride.departure_time,
      arrivalTime: ride.arrival_time,
      createdAt: ride.created_at,
      updatedAt: ride.updated_at,
      pricePerSeat: parseFloat(ride.price),
      currency: ride.currency,
      rideStatus: ride.ride_status,
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
        booked: totalBooked
      },
      bookings: formattedBookings,
      totalEarnings: totalEarnings
    };

    return Response.json({ 
      success: true, 
      ride: formattedRide 
    });

  } catch (error) {
    console.error('Error fetching posted ride details:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch ride details' 
    }, { status: 500 });
  }
}