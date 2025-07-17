import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const threadId = url.pathname.split('/').pop()?.replace('+api', '');
    const clerkId = url.searchParams.get('clerkId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    if (!clerkId || !threadId) {
      return Response.json({ error: 'ClerkId and threadId required' }, { status: 400 });
    }

    // Verify user has access to thread
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const [access] = await sql`
      SELECT id FROM chat_threads 
      WHERE id = ${threadId}
      AND (rider_id = ${user.id} OR driver_id = ${user.id})
    `;

    if (!access) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get messages
    const messages = await sql`
      SELECT 
        cm.*,
        CONCAT(u.first_name, ' ', u.last_name) as sender_name,
        u.avatar_url as sender_avatar
      FROM chat_messages cm
      JOIN users u ON cm.sender_id = u.id
      WHERE cm.thread_id = ${threadId}
      ORDER BY cm.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return Response.json({
      success: true,
      messages: messages.reverse(), // Reverse to show oldest first
      hasMore: messages.length === limit
    });

  } catch (error) {
    console.error('Error getting messages:', error);
    return Response.json({ error: 'Failed to get messages' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const threadId = url.pathname.split('/').pop()?.replace('+api', '');
    const { clerkId, content, messageType = 'text' } = await request.json();

    if (!clerkId || !threadId || !content) {
      return Response.json({ error: 'ClerkId, threadId, and content required' }, { status: 400 });
    }

    // Get user
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify thread access
    const [thread] = await sql`
      SELECT * FROM chat_threads 
      WHERE id = ${threadId}
      AND (rider_id = ${user.id} OR driver_id = ${user.id})
    `;

    if (!thread) {
      return Response.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Insert message
    const [message] = await sql`
      INSERT INTO chat_messages (
        thread_id,
        sender_id,
        content,
        message_type,
        read_by_rider,
        read_by_driver
      ) VALUES (
        ${threadId},
        ${user.id},
        ${content},
        ${messageType},
        ${user.id === thread.rider_id}, -- Mark as read by sender
        ${user.id === thread.driver_id}  -- Mark as read by sender
      ) RETURNING *
    `;

    // Send push notification to recipient
    const recipientUserId = user.id === thread.rider_id ? thread.driver_id : thread.rider_id;
    
    try {
    const sql = getDatabase();
      const { NotificationService } = await import('@/lib/notificationService');
      const [senderInfo] = await sql`
        SELECT CONCAT(first_name, ' ', last_name) as name FROM users WHERE id = ${user.id}
      `;
      
      // Get recipient's clerk_id for notification
      const [recipientInfo] = await sql`
        SELECT clerk_id FROM users WHERE id = ${recipientUserId}
      `;
      
      if (senderInfo && recipientInfo) {
        await NotificationService.notifyChatMessage(
          threadId,
          senderInfo.name,
          content,
          recipientInfo.clerk_id,  // Now passing clerk_id instead of user UUID
          thread.ride_id
        );
      }
    } catch (notifError) {
      console.error('Error sending chat notification:', notifError);
      // Don't fail the message send if notification fails
    }

    return Response.json({
      success: true,
      message: message
    });

  } catch (error) {
    console.error('Error sending message:', error);
    return Response.json({ error: 'Failed to send message' }, { status: 500 });
  }
}