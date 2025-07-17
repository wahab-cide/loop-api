import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { NotificationService } from '@/lib/notificationService';


export async function PUT(request: Request, { params }: { params?: { rideId?: string } }) {
  try {
    const sql = getDatabase();
    // Extract rideId from URL path as fallback
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const rideId = params?.rideId || pathParts[pathParts.length - 2]; // -2 because path ends with 'cancel'

    if (!rideId) {
      return Response.json({ error: 'Ride ID is required' }, { status: 400 });
    }

    console.log('Cancelling ride:', rideId);

    // Get ride details first
    const [ride] = await sql`
      SELECT 
        id,
        status,
        driver_id
      FROM rides
      WHERE id = ${rideId}
    `;

    if (!ride) {
      return Response.json({ 
        success: false, 
        error: 'Ride not found' 
      }, { status: 404 });
    }

    // Check if ride can be cancelled
    if (ride.status === 'cancelled') {
      return Response.json({ 
        success: false, 
        error: 'Ride is already cancelled' 
      }, { status: 400 });
    }

    if (ride.status === 'completed') {
      return Response.json({ 
        success: false, 
        error: 'Cannot cancel completed ride' 
      }, { status: 400 });
    }

    // Get all non-cancelled bookings for this ride
    const bookings = await sql`
      SELECT id, rider_id, status
      FROM bookings 
      WHERE ride_id = ${rideId} 
      AND status != 'cancelled'
    `;

    console.log(`Found ${bookings.length} bookings to cancel`);

    // Cancel the ride
    await sql`
      UPDATE rides 
      SET 
        status = 'cancelled',
        updated_at = NOW()
      WHERE id = ${rideId}
    `;

    // Cancel all non-cancelled bookings
    if (bookings.length > 0) {
      await sql`
        UPDATE bookings 
        SET 
          status = 'cancelled',
          updated_at = NOW()
        WHERE ride_id = ${rideId} 
        AND status != 'cancelled'
      `;
    }

    console.log('Ride and all bookings cancelled successfully:', rideId);

    // Send push notifications to all affected riders about ride cancellation
    try {
    const sql = getDatabase();
      await NotificationService.notifyRideCancellation(rideId, 'driver');
    } catch (notificationError) {
      console.error('Failed to send ride cancellation notifications:', notificationError);
      // Don't fail the cancellation if notification fails
    }

    // TODO: Process refunds for paid bookings

    return Response.json({ 
      success: true, 
      message: `Ride cancelled successfully. ${bookings.length} bookings were also cancelled and riders will be notified.` 
    });

  } catch (error) {
    console.error('Error cancelling ride:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to cancel ride' 
    }, { status: 500 });
  }
}