import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { NotificationService } from '@/lib/notificationService';


export async function PUT(request: Request, { params }: { params?: { bookingId?: string } }) {
  try {
    const sql = getDatabase();
    // Extract bookingId from URL path as fallback
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const bookingId = params?.bookingId || pathParts[pathParts.length - 2]; // -2 because path ends with 'approve'

    if (!bookingId) {
      return Response.json({ error: 'Booking ID is required' }, { status: 400 });
    }


    // Get booking details first
    const [booking] = await sql`
      SELECT 
        b.id,
        b.ride_id,
        b.rider_id,
        b.seats_booked,
        b.status,
        r.seats_available,
        r.seats_total,
        r.status as ride_status,
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

    // Check if booking can be approved
    if (booking.status !== 'pending') {
      return Response.json({ 
        success: false, 
        error: `Booking is already ${booking.status}` 
      }, { status: 400 });
    }

    // Use database function to validate booking approval (excludes current pending booking)
    const [validation] = await sql`
      SELECT * FROM validate_booking_approval(${bookingId}::UUID)
    `;

    if (!validation.is_valid) {
      return Response.json({ 
        success: false, 
        error: validation.error_message
      }, { status: 400 });
    }

    // Approve the booking - set approval status while keeping booking status as 'pending'
    await sql`
      UPDATE bookings 
      SET 
        approval_status = 'approved',
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = ${bookingId}
    `;

    // Sync ride seats availability using the database function
    await sql`SELECT sync_ride_seats_available(${booking.ride_id}::UUID)`;


    // Send push notification to rider about booking approval
    try {
    const sql = getDatabase();
      await NotificationService.notifyBookingConfirmation(bookingId);
    } catch (notificationError) {
      console.error('Failed to send booking approval notification:', notificationError);
      // Don't fail the approval if notification fails
    }

    // Schedule ride reminder for this booking
    try {
    const sql = getDatabase();
      await NotificationService.scheduleRideReminder(booking.ride_id);
    } catch (reminderError) {
      console.error('Failed to schedule ride reminder:', reminderError);
      // Don't fail the approval if reminder scheduling fails
    }

    return Response.json({ 
      success: true, 
      message: 'Booking approved successfully. Rider will be notified to complete payment.' 
    });

  } catch (error) {
    console.error('Error approving booking:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to approve booking' 
    }, { status: 500 });
  }
}