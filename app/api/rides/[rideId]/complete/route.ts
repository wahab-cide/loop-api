import { getDatabase } from '@/lib/database';


export async function PUT(request: Request) {
  try {
    const sql = getDatabase();
    // Extract rideId from the URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const rideId = pathParts[pathParts.indexOf('rides') + 1]; // Get rideId from path
    
    const { driverId } = await request.json();
    
    console.log('RideId:', rideId, 'DriverId:', driverId);

    if (!rideId) {
      return Response.json({ error: 'Ride ID is required' }, { status: 400 });
    }

    if (!driverId) {
      return Response.json({ error: 'Driver ID is required' }, { status: 400 });
    }

    // Verify that the ride exists and belongs to this driver
    const [ride] = await sql`
      SELECT r.id, r.driver_id, r.status, u.clerk_id as driver_clerk_id
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.id = ${rideId}
    `;

    if (!ride) {
      return Response.json({ error: 'Ride not found' }, { status: 404 });
    }

    if (ride.driver_clerk_id !== driverId) {
      return Response.json({ error: 'Unauthorized. You can only complete your own rides.' }, { status: 403 });
    }

    if (ride.status === 'completed') {
      return Response.json({ error: 'Ride is already completed' }, { status: 400 });
    }

    if (ride.status === 'cancelled') {
      return Response.json({ error: 'Cannot complete a cancelled ride' }, { status: 400 });
    }

    // Update ride status to completed
    await sql`
      UPDATE rides 
      SET status = 'completed', updated_at = NOW()
      WHERE id = ${rideId}
    `;

    // Update all paid bookings for this ride to completed
    await sql`
      UPDATE bookings 
      SET status = 'completed', updated_at = NOW()
      WHERE ride_id = ${rideId} AND status = 'paid'
    `;

    console.log(`Ride ${rideId} completed successfully.`);

    // Send ride completion notifications
    try {
    const sql = getDatabase();
      const { NotificationService } = await import('@/lib/notificationService');
      await NotificationService.notifyRideCompletion(rideId);
    } catch (notifError) {
      console.error('Error sending ride completion notification:', notifError);
      // Don't fail the request if notification fails
    }

    // Get updated ride details with booking information
    const [updatedRide] = await sql`
      SELECT 
        r.id,
        r.status,
        r.origin_label as from_location,
        r.destination_label as to_location,
        r.departure_time,
        COUNT(b.id) as total_bookings,
        COUNT(CASE WHEN b.status = 'completed' THEN 1 END) as completed_bookings,
        COALESCE(SUM(CASE WHEN b.status = 'completed' THEN b.total_price ELSE 0 END), 0) as total_earnings
      FROM rides r
      LEFT JOIN bookings b ON r.id = b.ride_id
      WHERE r.id = ${rideId}
      GROUP BY r.id, r.status, r.origin_label, r.destination_label, r.departure_time
    `;

    return Response.json({
      success: true,
      message: 'Ride completed successfully',
      ride: {
        id: updatedRide.id,
        status: updatedRide.status,
        from: updatedRide.from_location,
        to: updatedRide.to_location,
        departureTime: updatedRide.departure_time,
        totalBookings: parseInt(updatedRide.total_bookings),
        completedBookings: parseInt(updatedRide.completed_bookings),
        totalEarnings: parseFloat(updatedRide.total_earnings)
      }
    });

  } catch (error) {
    console.error('Error completing ride:', error);
    return Response.json({ 
      error: 'Failed to complete ride',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}