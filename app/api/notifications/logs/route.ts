import 'dotenv/config';
import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const clerkId = url.searchParams.get('clerkId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const type = url.searchParams.get('type'); // Optional filter by notification type

    if (!clerkId) {
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    console.log('Fetching notification logs for user:', clerkId);

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const userId = user.id;

    // Build query with optional type filter
    let logsQuery;
    if (type) {
      logsQuery = await sql`
        SELECT 
          id,
          type,
          title,
          body,
          data,
          delivery_status,
          delivery_error,
          ride_id,
          booking_id,
          scheduled_at,
          sent_at,
          created_at
        FROM notification_log
        WHERE user_id = ${userId}
        AND type = ${type}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      logsQuery = await sql`
        SELECT 
          id,
          type,
          title,
          body,
          data,
          delivery_status,
          delivery_error,
          ride_id,
          booking_id,
          scheduled_at,
          sent_at,
          created_at
        FROM notification_log
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    // Get total count for pagination
    const [countResult] = type 
      ? await sql`
          SELECT COUNT(*) as total
          FROM notification_log
          WHERE user_id = ${userId}
          AND type = ${type}
        `
      : await sql`
          SELECT COUNT(*) as total
          FROM notification_log
          WHERE user_id = ${userId}
        `;

    const total = parseInt(countResult.total);
    const hasMore = offset + limit < total;

    // Format the logs
    const formattedLogs = logsQuery.map(log => ({
      ...log,
      data: typeof log.data === 'string' ? JSON.parse(log.data) : log.data,
      created_at: log.created_at,
      sent_at: log.sent_at,
      scheduled_at: log.scheduled_at
    }));

    console.log(`Found ${formattedLogs.length} notification logs for user`);

    return Response.json({
      success: true,
      logs: formattedLogs,
      pagination: {
        total,
        limit,
        offset,
        hasMore,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching notification logs:', error);
    return Response.json({
      success: false,
      error: 'Failed to fetch notification logs',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

// Get notification statistics
export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { clerkId } = await request.json();

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

    // Get notification statistics
    const stats = await sql`
      SELECT 
        type,
        delivery_status,
        COUNT(*) as count
      FROM notification_log
      WHERE user_id = ${userId}
      AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY type, delivery_status
      ORDER BY type, delivery_status
    `;

    // Get recent notification activity (last 24 hours)
    const recentActivity = await sql`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as count
      FROM notification_log
      WHERE user_id = ${userId}
      AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour
    `;

    // Calculate summary statistics
    const summary = {
      totalSent: 0,
      totalFailed: 0,
      totalPending: 0,
      byType: {} as Record<string, { sent: number; failed: number; pending: number }>
    };

    stats.forEach(stat => {
      const { type, delivery_status, count } = stat;
      
      // Initialize type if doesn't exist
      if (!summary.byType[type]) {
        summary.byType[type] = { sent: 0, failed: 0, pending: 0 };
      }

      // Add to totals
      const numCount = parseInt(count);
      if (delivery_status === 'sent') {
        summary.totalSent += numCount;
        summary.byType[type].sent += numCount;
      } else if (delivery_status === 'failed') {
        summary.totalFailed += numCount;
        summary.byType[type].failed += numCount;
      } else if (delivery_status === 'pending') {
        summary.totalPending += numCount;
        summary.byType[type].pending += numCount;
      }
    });

    return Response.json({
      success: true,
      stats: {
        summary,
        byType: stats,
        recentActivity: recentActivity.map(activity => ({
          hour: activity.hour,
          count: parseInt(activity.count)
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching notification statistics:', error);
    return Response.json({
      success: false,
      error: 'Failed to fetch notification statistics',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}