import { getDatabase } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    // Get all rides with their actual booking status
    const ridesWithBookings = await sql`
      SELECT 
        r.id as ride_id,
        r.seats_total,
        r.seats_available as current_available,
        r.status as current_status,
        r.origin_label,
        r.destination_label,
        COALESCE(SUM(CASE WHEN b.status IN ('paid', 'completed') THEN b.seats_booked ELSE 0 END), 0) as confirmed_seats_booked,
        COUNT(b.id) FILTER (WHERE b.status IN ('paid', 'completed')) as confirmed_bookings
      FROM rides r
      LEFT JOIN bookings b ON r.id = b.ride_id
      WHERE r.status NOT IN ('cancelled', 'completed', 'expired')
      GROUP BY r.id, r.seats_total, r.seats_available, r.status, r.origin_label, r.destination_label
      ORDER BY r.created_at DESC
    ` as any[];

    const updates = [];
    let fixedCount = 0;

    for (const ride of ridesWithBookings) {
      const actualAvailable = ride.seats_total - ride.confirmed_seats_booked;
      const correctStatus = actualAvailable === 0 ? 'full' : 'open';
      
      // Check if ride needs fixing
      const needsUpdate = ride.current_available !== actualAvailable || 
                         ride.current_status !== correctStatus;

      if (needsUpdate) {
        // Update the ride
        await sql`
          UPDATE rides
          SET 
            seats_available = ${actualAvailable},
            status = ${correctStatus},
            updated_at = NOW()
          WHERE id = ${ride.ride_id}
        `;

        updates.push({
          ride_id: ride.ride_id,
          route: `${ride.origin_label} → ${ride.destination_label}`,
          seats_total: ride.seats_total,
          confirmed_bookings: ride.confirmed_bookings,
          confirmed_seats_booked: ride.confirmed_seats_booked,
          before: {
            available: ride.current_available,
            status: ride.current_status
          },
          after: {
            available: actualAvailable,
            status: correctStatus
          },
          was_incorrect: true
        });

        fixedCount++;
        console.log(`✅ Fixed ride ${ride.ride_id}: ${ride.current_available}→${actualAvailable} seats, ${ride.current_status}→${correctStatus}`);
      } else {
        // Ride is already correct
        updates.push({
          ride_id: ride.ride_id,
          route: `${ride.origin_label} → ${ride.destination_label}`,
          seats_total: ride.seats_total,
          confirmed_bookings: ride.confirmed_bookings,
          confirmed_seats_booked: ride.confirmed_seats_booked,
          current: {
            available: ride.current_available,
            status: ride.current_status
          },
          was_incorrect: false
        });
      }
    }

    return Response.json({
      success: true,
      message: `Processed ${ridesWithBookings.length} rides, fixed ${fixedCount} incorrect statuses`,
      total_rides_checked: ridesWithBookings.length,
      rides_fixed: fixedCount,
      rides_already_correct: ridesWithBookings.length - fixedCount,
      details: updates
    });

  } catch (error) {
    console.error('Fix ride status error:', error);
    return Response.json({ 
      error: 'Failed to fix ride statuses',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}