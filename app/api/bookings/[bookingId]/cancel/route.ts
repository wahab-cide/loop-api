import 'dotenv/config';
import { getDatabase } from '@/lib/database';


export async function PUT(request: Request, { params }: { params?: { bookingId?: string } }) {
  try {
    const sql = getDatabase();
    // Extract bookingId from URL path as fallback
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const bookingId = params?.bookingId || pathParts[pathParts.length - 2]; // -2 because path ends with 'cancel'

    if (!bookingId) {
      return Response.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    console.log('Cancelling booking:', bookingId);

    // Get booking details first
    const [booking] = await sql`
      SELECT 
        b.id,
        b.ride_id,
        b.seats_booked,
        b.status,
        r.seats_available,
        r.seats_total,
        r.status as ride_status
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      WHERE b.id = ${bookingId}
    `;

    if (!booking) {
      return Response.json({ 
        success: false, 
        error: 'Booking not found' 
      }, { status: 404 });
    }

    // Check if booking can be cancelled
    if (booking.status === 'cancelled') {
      return Response.json({ 
        success: false, 
        error: 'Booking is already cancelled' 
      }, { status: 400 });
    }

    if (booking.status === 'completed') {
      return Response.json({ 
        success: false, 
        error: 'Cannot cancel completed booking' 
      }, { status: 400 });
    }

    // Cancel the booking
    await sql`
      UPDATE bookings 
      SET 
        status = 'cancelled',
        updated_at = NOW()
      WHERE id = ${bookingId}
    `;

    // If the booking was paid/pending, restore the seats to the ride
    if (booking.status === 'paid' || booking.status === 'pending') {
      // Calculate new available seats, ensuring we don't exceed total seats
      const calculatedSeats = booking.seats_available + booking.seats_booked;
      const newSeatsAvailable = Math.min(calculatedSeats, booking.seats_total);
      const newRideStatus = booking.ride_status === 'full' && newSeatsAvailable > 0 ? 'open' : booking.ride_status;

      await sql`
        UPDATE rides 
        SET 
          seats_available = ${newSeatsAvailable},
          status = ${newRideStatus},
          updated_at = NOW()
        WHERE id = ${booking.ride_id}
      `;

      console.log('Restored seats to ride:', {
        rideId: booking.ride_id,
        seatsRestored: booking.seats_booked,
        previousAvailable: booking.seats_available,
        calculatedSeats,
        newSeatsAvailable,
        seatsTotal: booking.seats_total,
        newRideStatus
      });
    }

    console.log('Booking cancelled successfully:', bookingId);

    // Send notification to driver about booking cancellation
    try {
    const sql = getDatabase();
      const { NotificationService } = await import('@/lib/notificationService');
      await NotificationService.notifyBookingCancellation(bookingId);
    } catch (notifError) {
      console.error('Error sending booking cancellation notification:', notifError);
      // Don't fail the request if notification fails
    }

    return Response.json({ 
      success: true, 
      message: 'Booking cancelled successfully' 
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to cancel booking' 
    }, { status: 500 });
  }
}