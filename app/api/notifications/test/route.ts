import 'dotenv/config';
import { getDatabase } from '@/lib/database';
import { NotificationService } from '@/lib/notificationService';


interface TestNotificationRequest {
  clerkId: string;
  type: string;
  customData?: Record<string, any>;
}

export async function POST(request: Request) {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    const sql = getDatabase();
    const body: TestNotificationRequest = await request.json();
    const { clerkId, type, customData } = body;

    if (!clerkId || !type) {
      return Response.json({ error: 'clerkId and type are required' }, { status: 400 });
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('Sending test notification:', { clerkId, type });
    }

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const userId = user.id;

    // Create test data based on notification type
    let testPayload;
    let testOptions = {};

    switch (type) {
      case 'ride_posted':
        testPayload = {
          title: 'New ride: Downtown → Airport',
          body: '$25 · Today 3:30 PM',
          data: { rideId: 'test-ride-123', type: 'ride_posted', ...customData }
        };
        testOptions = { type: 'ride_posted', rideId: 'test-ride-123' };
        break;

      case 'booking_request':
        testPayload = {
          title: '2 seats booked',
          body: 'John Doe reserved 2 seats on your ride',
          data: { bookingId: 'test-booking-123', type: 'booking_request', ...customData }
        };
        testOptions = { type: 'booking_request', bookingId: 'test-booking-123' };
        break;

      case 'booking_confirmation':
        testPayload = {
          title: 'Ride confirmed!',
          body: 'See you Friday 3:30 PM',
          data: { bookingId: 'test-booking-123', type: 'booking_confirmation', ...customData }
        };
        testOptions = { type: 'booking_confirmation', bookingId: 'test-booking-123' };
        break;

      case 'booking_rejection':
        testPayload = {
          title: 'Booking declined',
          body: 'Jane Smith declined your 1 seat request',
          data: { bookingId: 'test-booking-123', type: 'booking_rejection', ...customData }
        };
        testOptions = { type: 'booking_rejection', bookingId: 'test-booking-123' };
        break;

      case 'booking_cancellation':
        testPayload = {
          title: 'Booking cancelled',
          body: 'John Doe cancelled their 2 seats booking',
          data: { bookingId: 'test-booking-123', type: 'booking_cancellation', ...customData }
        };
        testOptions = { type: 'booking_cancellation', bookingId: 'test-booking-123' };
        break;

      case 'payment_confirmation':
        testPayload = {
          title: 'Payment confirmed!',
          body: 'Your booking for Friday 3:30 PM is confirmed',
          data: { bookingId: 'test-booking-123', type: 'payment_confirmation', ...customData }
        };
        testOptions = { type: 'payment_confirmation', bookingId: 'test-booking-123' };
        break;

      case 'ride_completion':
        testPayload = {
          title: 'Ride completed',
          body: 'Hope you had a great trip!',
          data: { rideId: 'test-ride-123', type: 'ride_completion', ...customData }
        };
        testOptions = { type: 'ride_completion', rideId: 'test-ride-123' };
        break;

      case 'chat_message':
        testPayload = {
          title: 'John Doe',
          body: 'Hey, I\'m running 5 minutes late!',
          data: { threadId: 'test-thread-123', rideId: 'test-ride-123', type: 'chat_message', ...customData }
        };
        testOptions = { type: 'chat_message', rideId: 'test-ride-123' };
        break;

      case 'ride_reminder':
        testPayload = {
          title: 'Reminder',
          body: 'Downtown → Airport departs in 30 min',
          data: { rideId: 'test-ride-123', type: 'ride_reminder', ...customData }
        };
        testOptions = { type: 'ride_reminder', rideId: 'test-ride-123' };
        break;

      default:
        return Response.json({ error: 'Invalid notification type' }, { status: 400 });
    }

    // Send the test notification
    await NotificationService.sendToUsers([userId], testPayload, testOptions);

    if (process.env.NODE_ENV === 'development') {
      console.log('Test notification sent successfully:', type);
    }

    return Response.json({ 
      success: true, 
      message: `Test ${type} notification sent successfully`,
      payload: testPayload 
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error sending test notification:', error);
    }
    return Response.json({ 
      success: false, 
      error: 'Failed to send test notification',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Get available test notification types
export async function GET(request: Request) {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    const sql = getDatabase();
    const testTypes = [
      {
        id: 'ride_posted',
        name: 'Ride Posted',
        description: 'Notification when a new ride is posted nearby',
        example: {
          title: 'New ride: Downtown → Airport',
          body: '$25 · Today 3:30 PM'
        }
      },
      {
        id: 'booking_request',
        name: 'Booking Request',
        description: 'Notification when someone requests to book your ride',
        example: {
          title: '2 seats booked',
          body: 'John Doe reserved 2 seats on your ride'
        }
      },
      {
        id: 'booking_confirmation',
        name: 'Booking Confirmation',
        description: 'Notification when your booking is confirmed',
        example: {
          title: 'Ride confirmed!',
          body: 'See you Friday 3:30 PM'
        }
      },
      {
        id: 'booking_rejection',
        name: 'Booking Rejection',
        description: 'Notification when your booking is rejected',
        example: {
          title: 'Booking declined',
          body: 'Jane Smith declined your 1 seat request'
        }
      },
      {
        id: 'booking_cancellation',
        name: 'Booking Cancellation',
        description: 'Notification when a booking is cancelled',
        example: {
          title: 'Booking cancelled',
          body: 'John Doe cancelled their 2 seats booking'
        }
      },
      {
        id: 'payment_confirmation',
        name: 'Payment Confirmation',
        description: 'Notification when payment is successful',
        example: {
          title: 'Payment confirmed!',
          body: 'Your booking for Friday 3:30 PM is confirmed'
        }
      },
      {
        id: 'ride_completion',
        name: 'Ride Completion',
        description: 'Notification when a ride is completed',
        example: {
          title: 'Ride completed',
          body: 'Hope you had a great trip!'
        }
      },
      {
        id: 'chat_message',
        name: 'Chat Message',
        description: 'Notification for new chat messages',
        example: {
          title: 'John Doe',
          body: 'Hey, I\'m running 5 minutes late!'
        }
      },
      {
        id: 'ride_reminder',
        name: 'Ride Reminder',
        description: 'Reminder notification before ride departure',
        example: {
          title: 'Reminder',
          body: 'Downtown → Airport departs in 30 min'
        }
      }
    ];

    return Response.json({ 
      success: true, 
      testTypes 
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error getting test notification types:', error);
    }
    return Response.json({ 
      success: false, 
      error: 'Failed to get test notification types' 
    }, { status: 500 });
  }
}