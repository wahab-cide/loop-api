import 'dotenv/config';
import { getDatabase } from '@/lib/database';


export async function PUT(request: Request, { params }: { params?: { bookingId?: string } }) {
  try {
    const sql = getDatabase();
    // Extract bookingId from URL path as fallback
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const bookingId = params?.bookingId || pathParts[pathParts.length - 2]; // -2 because path ends with 'reject'

    if (!bookingId) {
      return Response.json({ error: 'Booking ID is required' }, { status: 400 });
    }

    console.log('Rejecting booking:', bookingId);

    // Get booking details first
    const [booking] = await sql`
      SELECT 
        b.id,
        b.ride_id,
        b.rider_id,
        b.seats_booked,
        b.status,
        r.driver_id
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

    // Check if booking can be rejected
    if (booking.status === 'cancelled') {
      return Response.json({ 
        success: false, 
        error: 'Booking is already cancelled' 
      }, { status: 400 });
    }

    if (booking.status === 'completed') {
      return Response.json({ 
        success: false, 
        error: 'Cannot reject completed booking' 
      }, { status: 400 });
    }

    // Reject the booking by setting approval_status to rejected
    // Keep status as pending but mark as rejected by driver
    await sql`
      UPDATE bookings 
      SET 
        status = 'cancelled',
        approval_status = 'rejected',
        updated_at = NOW()
      WHERE id = ${bookingId}
    `;

    console.log('Booking rejected successfully:', bookingId);

    // Send push notification to rider about booking rejection
    try {
    const sql = getDatabase();
      const { NotificationService } = await import('@/lib/notificationService');
      await NotificationService.notifyBookingRejection(bookingId);
    } catch (notifError) {
      console.error('Error sending booking rejection notification:', notifError);
      // Don't fail the request if notification fails
    }

    // TODO: If there's a waitlist, notify the next person

    return Response.json({ 
      success: true, 
      message: 'Booking rejected successfully. Rider will be notified.' 
    });

  } catch (error) {
    console.error('Error rejecting booking:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to reject booking' 
    }, { status: 500 });
  }
}