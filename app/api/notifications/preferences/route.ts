import 'dotenv/config';
import { getDatabase } from '@/lib/database';


interface NotificationPreferences {
  ridesNearMe?: boolean;
  bookingRequests?: boolean;
  bookingConfirmations?: boolean;
  rideReminders?: boolean;
  rideCancellations?: boolean;
  seatAvailability?: boolean;
  chatMessages?: boolean;
  paymentIssues?: boolean;
  nearbyRadiusKm?: number;
  preferredLocations?: any[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const clerkId = url.searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const userId = user.id;

    // Get user's notification preferences using user_id
    const [preferences] = await sql`
      SELECT 
        rides_near_me,
        booking_requests,
        booking_confirmations,
        ride_reminders,
        ride_cancellations,
        seat_availability,
        chat_messages,
        payment_issues,
        nearby_radius_km,
        preferred_locations,
        quiet_hours_start,
        quiet_hours_end,
        timezone
      FROM notification_preferences
      WHERE user_id = ${userId}
    `;

    if (!preferences) {
      // Create default preferences if they don't exist
      try {
    const sql = getDatabase();
        await sql`
          INSERT INTO notification_preferences (user_id)
          VALUES (${userId})
        `;
        
        if (process.env.NODE_ENV === 'development') {
          console.log("Created default notification preferences for user:", clerkId);
        }
      } catch (insertError) {
        console.error("Error creating default preferences:", insertError);
      }

      // Return default preferences
      return Response.json({
        success: true,
        preferences: {
          ridesNearMe: true,
          bookingRequests: true,
          bookingConfirmations: true,
          rideReminders: true,
          rideCancellations: true,
          seatAvailability: true,
          chatMessages: true,
          paymentIssues: true,
          nearbyRadiusKm: 50,
          preferredLocations: [],
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: 'UTC'
        }
      });
    }

    // Format response
    const formattedPreferences = {
      ridesNearMe: preferences.rides_near_me,
      bookingRequests: preferences.booking_requests,
      bookingConfirmations: preferences.booking_confirmations,
      rideReminders: preferences.ride_reminders,
      rideCancellations: preferences.ride_cancellations,
      seatAvailability: preferences.seat_availability,
      chatMessages: preferences.chat_messages,
      paymentIssues: preferences.payment_issues,
      nearbyRadiusKm: preferences.nearby_radius_km,
      preferredLocations: preferences.preferred_locations || [],
      quietHoursStart: preferences.quiet_hours_start,
      quietHoursEnd: preferences.quiet_hours_end,
      timezone: preferences.timezone
    };

    return Response.json({
      success: true,
      preferences: formattedPreferences
    });

  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    return Response.json({
      success: false,
      error: 'Failed to fetch notification preferences'
    }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const sql = getDatabase();
    const body: { clerkId: string; preferences: NotificationPreferences } = await request.json();
    const { clerkId, preferences } = body;

    if (!clerkId) {
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const userId = user.id;

    // Update notification preferences using user_id
    await sql`
      INSERT INTO notification_preferences (
        user_id,
        rides_near_me,
        booking_requests,
        booking_confirmations,
        ride_reminders,
        ride_cancellations,
        seat_availability,
        chat_messages,
        payment_issues,
        nearby_radius_km,
        preferred_locations,
        quiet_hours_start,
        quiet_hours_end,
        timezone
      ) VALUES (
        ${userId},
        ${preferences.ridesNearMe ?? true},
        ${preferences.bookingRequests ?? true},
        ${preferences.bookingConfirmations ?? true},
        ${preferences.rideReminders ?? true},
        ${preferences.rideCancellations ?? true},
        ${preferences.seatAvailability ?? true},
        ${preferences.chatMessages ?? true},
        ${preferences.paymentIssues ?? true},
        ${preferences.nearbyRadiusKm ?? 50},
        ${JSON.stringify(preferences.preferredLocations || [])},
        ${preferences.quietHoursStart || null},
        ${preferences.quietHoursEnd || null},
        ${preferences.timezone || 'UTC'}
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        rides_near_me = EXCLUDED.rides_near_me,
        booking_requests = EXCLUDED.booking_requests,
        booking_confirmations = EXCLUDED.booking_confirmations,
        ride_reminders = EXCLUDED.ride_reminders,
        ride_cancellations = EXCLUDED.ride_cancellations,
        seat_availability = EXCLUDED.seat_availability,
        chat_messages = EXCLUDED.chat_messages,
        payment_issues = EXCLUDED.payment_issues,
        nearby_radius_km = EXCLUDED.nearby_radius_km,
        preferred_locations = EXCLUDED.preferred_locations,
        quiet_hours_start = EXCLUDED.quiet_hours_start,
        quiet_hours_end = EXCLUDED.quiet_hours_end,
        timezone = EXCLUDED.timezone,
        updated_at = NOW()
    `;

    return Response.json({
      success: true,
      message: 'Notification preferences updated successfully'
    });

  } catch (error) {
    console.error('Error updating notification preferences:', error);
    return Response.json({
      success: false,
      error: 'Failed to update notification preferences'
    }, { status: 500 });
  }
}