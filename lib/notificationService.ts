import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { getDatabase } from './database';

const expo = new Expo();

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
}

export interface NotificationEvent {
  type: 'ride_posted' | 'booking_request' | 'booking_confirmation' | 'ride_reminder' | 
        'ride_cancellation' | 'seat_availability' | 'chat_message' | 'payment_issue';
  userIds?: string[];  // Specific user IDs to notify
  rideId?: string;     // For ride-related notifications
  bookingId?: string;  // For booking-related notifications
  payload: NotificationPayload;
  scheduleAt?: Date;   // For scheduled notifications (like ride reminders)
}

export class NotificationService {
  /**
   * Send notification to specific users
   */
  static async sendToUsers(userIds: string[], payload: NotificationPayload, options?: {
    type?: string;
    rideId?: string;
    bookingId?: string;
  }): Promise<void> {
    try {
      const sql = getDatabase();
      // First check which users actually exist
      const existingUsers = await sql`
        SELECT clerk_id FROM users WHERE clerk_id = ANY(${userIds})
      `;
      
      const existingUserIds = existingUsers.map(u => u.clerk_id);
      const missingUserIds = userIds.filter(id => !existingUserIds.includes(id));
      
      if (existingUserIds.length === 0) {
        return;
      }

      // Get active push tokens for existing users only
      const tokens = await sql`
        SELECT upt.token, u.clerk_id as user_id
        FROM user_push_tokens upt
        JOIN users u ON upt.user_id = u.id
        WHERE u.clerk_id = ANY(${existingUserIds})
        AND upt.is_active = TRUE
        AND upt.token IS NOT NULL
      `;


      if (tokens.length === 0) {
        return;
      }

      // Prepare push messages
      const messages: ExpoPushMessage[] = tokens
        .filter(tokenData => Expo.isExpoPushToken(tokenData.token))
        .map(tokenData => ({
          to: tokenData.token,
          title: payload.title,
          body: payload.body,
          data: payload.data || {},
          sound: payload.sound || 'default',
          badge: payload.badge,
        }));

      if (messages.length === 0) {
        return;
      }

      // Send notifications in chunks
      const chunks = expo.chunkPushNotifications(messages);
      const receipts: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          receipts.push(...ticketChunk);
        } catch (error) {
          if (process.env.NODE_ENV === 'development') console.error('Error sending notification chunk:', error);
        }
      }

      // Log notifications to database
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const receipt = receipts[i];
        
        // Get user.id from clerk_id for logging
        const [user] = await sql`SELECT id FROM users WHERE clerk_id = ${token.user_id}`;
        if (user) {
          await sql`
            INSERT INTO notification_log (
              user_id,
              type,
              title,
              body,
              data,
              push_token,
              delivery_status,
              delivery_error,
              ride_id,
              booking_id,
              sent_at
            ) VALUES (
              ${user.id},
              ${options?.type || 'generic'},
              ${payload.title},
              ${payload.body},
              ${JSON.stringify(payload.data || {})},
              ${token.token},
              ${receipt?.status === 'ok' ? 'sent' : 'failed'},
              ${receipt?.status === 'error' ? receipt.message : null},
              ${options?.rideId || null},
              ${options?.bookingId || null},
              NOW()
            )
          `;
        }
      }

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in sendToUsers:', error);
      throw error;
    }
  }

  /**
   * Send notification for ride posted near users
   */
  static async notifyRidePostedNearby(rideId: string, originLat: number, originLng: number, 
                                     destinationLat: number, destinationLng: number): Promise<void> {
    try {
      const sql = getDatabase();
      // Get ride details and driver info first
      const [ride] = await sql`
        SELECT r.origin_label, r.destination_label, r.price, r.departure_time, r.driver_id
        FROM rides r
        WHERE r.id = ${rideId}
      `;

      if (!ride) {
        if (process.env.NODE_ENV === 'development') console.error('Ride not found for notification:', rideId);
        return;
      }

      // Find users who should be notified about nearby rides (excluding the driver who posted it)
      const nearbyUsers = await sql`
        SELECT DISTINCT u.clerk_id as id
        FROM users u
        JOIN user_push_tokens upt ON u.id = upt.user_id
        LEFT JOIN notification_preferences np ON u.id = np.user_id
        WHERE (np.rides_near_me = TRUE OR np.rides_near_me IS NULL)  -- Include users without prefs (default enabled)
        AND upt.is_active = TRUE
        AND u.clerk_id != ${ride.driver_id}  -- Exclude the driver who posted the ride
        -- Add location-based filtering here when user locations are implemented
        -- For now, notify all users who opted in (except the driver)
        LIMIT 100  -- Prevent spam
      `;

      if (nearbyUsers.length === 0) {
        if (process.env.NODE_ENV === 'development') console.log('No users to notify for nearby ride (excluding driver)');
        return;
      }

      const departureTime = new Date(ride.departure_time);
      const timeStr = departureTime.toLocaleDateString('en-US', { 
        weekday: 'short', 
        hour: '2-digit', 
        minute: '2-digit' 
      });

      const payload: NotificationPayload = {
        title: `New ride: ${ride.origin_label} → ${ride.destination_label}`,
        body: `$${ride.price} · ${timeStr}`,
        data: { rideId, type: 'ride_posted' }
      };

      await this.sendToUsers(
        nearbyUsers.map(u => u.id), 
        payload, 
        { type: 'ride_posted', rideId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyRidePostedNearby:', error);
    }
  }

  /**
   * Send booking request notification to driver
   */
  static async notifyBookingRequest(bookingId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get booking and ride details
      const [booking] = await sql`
        SELECT 
          b.id as booking_id,
          b.seats_booked,
          b.ride_id,
          d.clerk_id as driver_clerk_id,
          r.origin_label,
          r.destination_label,
          CONCAT(u.first_name, ' ', u.last_name) as rider_name
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users u ON b.rider_id = u.id
        JOIN users d ON r.driver_id = d.id
        WHERE b.id = ${bookingId}
      `;

      if (!booking) {
        if (process.env.NODE_ENV === 'development') console.error('Booking not found for notification:', bookingId);
        return;
      }

      const payload: NotificationPayload = {
        title: `${booking.seats_booked} seats booked`,
        body: `${booking.rider_name} reserved ${booking.seats_booked} seat${booking.seats_booked > 1 ? 's' : ''} on your ride`,
        data: { bookingId, rideId: booking.ride_id, type: 'booking_request' }
      };

      await this.sendToUsers(
        [booking.driver_clerk_id], 
        payload, 
        { type: 'booking_request', bookingId, rideId: booking.ride_id }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyBookingRequest:', error);
    }
  }

  /**
   * Send booking confirmation to rider
   */
  static async notifyBookingConfirmation(bookingId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get booking details
      const [booking] = await sql`
        SELECT 
          u.clerk_id as rider_clerk_id,
          r.departure_time,
          r.origin_label,
          r.destination_label
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users u ON b.rider_id = u.id
        WHERE b.id = ${bookingId}
      `;

      if (!booking) {
        if (process.env.NODE_ENV === 'development') console.error('Booking not found for notification:', bookingId);
        return;
      }

      const departureTime = new Date(booking.departure_time);
      const timeStr = departureTime.toLocaleDateString('en-US', { 
        weekday: 'long',
        hour: '2-digit', 
        minute: '2-digit' 
      });

      const payload: NotificationPayload = {
        title: 'Ride confirmed!',
        body: `See you ${timeStr}`,
        data: { bookingId, type: 'booking_confirmation' }
      };

      await this.sendToUsers(
        [booking.rider_clerk_id], 
        payload, 
        { type: 'booking_confirmation', bookingId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyBookingConfirmation:', error);
    }
  }

  /**
   * Send ride cancellation notifications
   */
  static async notifyRideCancellation(rideId: string, cancelledBy: 'driver' | 'system'): Promise<void> {
    try {
      const sql = getDatabase();
      // Get all affected users (riders with non-cancelled bookings)
      const affectedUsers = await sql`
        SELECT 
          u.clerk_id as rider_clerk_id,
          r.origin_label,
          r.destination_label
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users u ON b.rider_id = u.id
        WHERE b.ride_id = ${rideId}
        AND b.status != 'cancelled'
      `;

      if (affectedUsers.length === 0) {
        if (process.env.NODE_ENV === 'development') console.log('No users to notify for ride cancellation');
        return;
      }

      const ride = affectedUsers[0]; // All bookings have same ride info
      const payload: NotificationPayload = {
        title: 'Ride cancelled',
        body: `${cancelledBy === 'driver' ? 'Driver' : 'System'} cancelled the trip`,
        data: { rideId, type: 'ride_cancellation' }
      };

      const riderClerkIds = affectedUsers.map(u => u.rider_clerk_id);
      await this.sendToUsers(
        riderClerkIds, 
        payload, 
        { type: 'ride_cancellation', rideId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyRideCancellation:', error);
    }
  }

  /**
   * Schedule ride reminder notifications
   */
  static async scheduleRideReminder(rideId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get ride details and all participants
      const participants = await sql`
        SELECT DISTINCT
          u.clerk_id as user_clerk_id,
          r.departure_time,
          r.origin_label,
          r.destination_label
        FROM rides r
        LEFT JOIN bookings b ON r.id = b.ride_id AND b.status IN ('paid', 'completed')
        LEFT JOIN users u ON b.rider_id = u.id
        WHERE r.id = ${rideId}
        AND r.status != 'cancelled'
        AND u.clerk_id IS NOT NULL
        UNION
        SELECT 
          d.clerk_id as user_clerk_id,
          r.departure_time,
          r.origin_label,
          r.destination_label
        FROM rides r
        JOIN users d ON r.driver_id = d.id
        WHERE r.id = ${rideId}
        AND r.status != 'cancelled'
      `;

      if (participants.length === 0) {
        if (process.env.NODE_ENV === 'development') console.log('No participants to remind for ride');
        return;
      }

      const ride = participants[0];
      const departureTime = new Date(ride.departure_time);
      const reminderTime = new Date(departureTime.getTime() - 30 * 60 * 1000); // 30 minutes before

      // Only schedule if reminder time is in the future
      if (reminderTime > new Date()) {
        const payload: NotificationPayload = {
          title: 'Reminder',
          body: `${ride.origin_label} → ${ride.destination_label} departs in 30 min`,
          data: { rideId, type: 'ride_reminder' }
        };

        // Store scheduled notification in database
        const userClerkIds = participants.map(p => p.user_clerk_id);
        for (const clerkId of userClerkIds) {
          // Get user.id from clerk_id for logging
          const [user] = await sql`SELECT id FROM users WHERE clerk_id = ${clerkId}`;
          if (user) {
            await sql`
              INSERT INTO notification_log (
                user_id,
                type,
                title,
                body,
                data,
                ride_id,
                delivery_status,
                scheduled_at
              ) VALUES (
                ${user.id},
                'ride_reminder',
                ${payload.title},
                ${payload.body},
                ${JSON.stringify(payload.data)},
                ${rideId},
                'pending',
                ${reminderTime.toISOString()}
              )
            `;
          }
        }

        if (process.env.NODE_ENV === 'development') console.log(`Scheduled ${userClerkIds.length} ride reminders for ${reminderTime}`);
      }

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in scheduleRideReminder:', error);
    }
  }

  /**
   * Send booking rejection notification to rider
   */
  static async notifyBookingRejection(bookingId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get booking details
      const [booking] = await sql`
        SELECT 
          u.clerk_id as rider_clerk_id,
          b.seats_booked,
          r.origin_label,
          r.destination_label,
          CONCAT(d.first_name, ' ', d.last_name) as driver_name
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users d ON r.driver_id = d.id
        JOIN users u ON b.rider_id = u.id
        WHERE b.id = ${bookingId}
      `;

      if (!booking) {
        if (process.env.NODE_ENV === 'development') console.error('Booking not found for rejection notification:', bookingId);
        return;
      }

      const payload: NotificationPayload = {
        title: 'Booking declined',
        body: `${booking.driver_name} declined your ${booking.seats_booked} seat${booking.seats_booked > 1 ? 's' : ''} request`,
        data: { bookingId, type: 'booking_rejection' }
      };

      await this.sendToUsers(
        [booking.rider_clerk_id], 
        payload, 
        { type: 'booking_rejection', bookingId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyBookingRejection:', error);
    }
  }

  /**
   * Send booking cancellation notification to driver
   */
  static async notifyBookingCancellation(bookingId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get booking details
      const [booking] = await sql`
        SELECT 
          b.seats_booked,
          d.clerk_id as driver_clerk_id,
          r.origin_label,
          r.destination_label,
          CONCAT(u.first_name, ' ', u.last_name) as rider_name
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users u ON b.rider_id = u.id
        JOIN users d ON r.driver_id = d.id
        WHERE b.id = ${bookingId}
      `;

      if (!booking) {
        if (process.env.NODE_ENV === 'development') console.error('Booking not found for cancellation notification:', bookingId);
        return;
      }

      const payload: NotificationPayload = {
        title: 'Booking cancelled',
        body: `${booking.rider_name} cancelled their ${booking.seats_booked} seat${booking.seats_booked > 1 ? 's' : ''} booking`,
        data: { bookingId, type: 'booking_cancellation' }
      };

      await this.sendToUsers(
        [booking.driver_clerk_id], 
        payload, 
        { type: 'booking_cancellation', bookingId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyBookingCancellation:', error);
    }
  }

  /**
   * Send payment confirmation notification
   */
  static async notifyPaymentConfirmation(bookingId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get booking details
      const [booking] = await sql`
        SELECT 
          u.clerk_id as rider_clerk_id,
          d.clerk_id as driver_clerk_id,
          b.seats_booked,
          b.ride_id,
          r.origin_label,
          r.destination_label,
          r.departure_time,
          r.price
        FROM bookings b
        JOIN rides r ON b.ride_id = r.id
        JOIN users u ON b.rider_id = u.id
        JOIN users d ON r.driver_id = d.id
        WHERE b.id = ${bookingId}
      `;

      if (!booking) {
        if (process.env.NODE_ENV === 'development') console.error('Booking not found for payment confirmation:', bookingId);
        return;
      }

      const departureTime = new Date(booking.departure_time);
      const timeStr = departureTime.toLocaleDateString('en-US', { 
        weekday: 'long',
        hour: '2-digit', 
        minute: '2-digit' 
      });

      // Notify rider
      const riderPayload: NotificationPayload = {
        title: 'Payment confirmed!',
        body: `Your booking for ${timeStr} is confirmed`,
        data: { bookingId, type: 'payment_confirmation' }
      };

      // Notify driver - include rideId for driver navigation
      const driverPayload: NotificationPayload = {
        title: 'Payment received',
        body: `$${booking.price} payment confirmed for ${booking.seats_booked} seat${booking.seats_booked > 1 ? 's' : ''}`,
        data: { bookingId, rideId: booking.ride_id, type: 'payment_confirmation_driver' }
      };

      await Promise.all([
        this.sendToUsers([booking.rider_clerk_id], riderPayload, { type: 'payment_confirmation', bookingId }),
        this.sendToUsers([booking.driver_clerk_id], driverPayload, { type: 'payment_confirmation_driver', bookingId, rideId: booking.ride_id })
      ]);

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyPaymentConfirmation:', error);
    }
  }

  /**
   * Send ride completion notification
   */
  static async notifyRideCompletion(rideId: string): Promise<void> {
    try {
      const sql = getDatabase();
      // Get all participants
      const participants = await sql`
        SELECT DISTINCT
          u.clerk_id as user_clerk_id,
          r.origin_label,
          r.destination_label
        FROM rides r
        JOIN bookings b ON r.id = b.ride_id
        JOIN users u ON b.rider_id = u.id
        WHERE r.id = ${rideId}
        AND b.status IN ('paid', 'completed')
        UNION
        SELECT 
          d.clerk_id as user_clerk_id,
          r.origin_label,
          r.destination_label
        FROM rides r
        JOIN users d ON r.driver_id = d.id
        WHERE r.id = ${rideId}
      `;

      if (participants.length === 0) {
        if (process.env.NODE_ENV === 'development') console.log('No participants to notify for ride completion');
        return;
      }

      const ride = participants[0];
      const payload: NotificationPayload = {
        title: 'Ride completed',
        body: `Hope you had a great trip!`,
        data: { rideId, type: 'ride_completion' }
      };

      const userClerkIds = participants.map(p => p.user_clerk_id);
      await this.sendToUsers(
        userClerkIds, 
        payload, 
        { type: 'ride_completion', rideId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyRideCompletion:', error);
    }
  }

  /**
   * Send chat message notification
   */
  static async notifyChatMessage(threadId: string, senderName: string, content: string, recipientId: string, rideId: string): Promise<void> {
    try {
      const payload: NotificationPayload = {
        title: senderName,
        body: content.length > 50 ? content.substring(0, 47) + '...' : content,
        data: { threadId, rideId, type: 'chat_message' }
      };

      await this.sendToUsers(
        [recipientId], 
        payload, 
        { type: 'chat_message', rideId }
      );

    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error('Error in notifyChatMessage:', error);
    }
  }
}