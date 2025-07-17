import 'dotenv/config';
import { getDatabase } from '@/lib/database';


interface RegisterTokenRequest {
  clerkId: string;
  token: string;
  deviceId?: string;
  platform?: 'ios' | 'android' | 'web';
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const body: RegisterTokenRequest = await request.json();
    const { clerkId, token, deviceId, platform } = body;

    if (!clerkId || !token) {
      return Response.json({ error: 'clerkId and token are required' }, { status: 400 });
    }

    console.log('Registering push token for user:', clerkId);

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      if (process.env.NODE_ENV === 'development') console.log('User not found in database for clerkId:', clerkId);
      return Response.json({ 
        success: true, 
        message: 'User not found - token registration skipped. Please sign out and sign in again.' 
      });
    }

    const userId = user.id;

    // Upsert the push token (insert or update if exists)
    await sql`
      INSERT INTO user_push_tokens (user_id, token, device_id, platform, is_active)
      VALUES (${userId}, ${token}, ${deviceId}, ${platform}, TRUE)
      ON CONFLICT (user_id, device_id) 
      DO UPDATE SET 
        token = EXCLUDED.token,
        platform = EXCLUDED.platform,
        is_active = TRUE,
        updated_at = NOW()
    `;

    // Deactivate old tokens for this user (except the current one)
    await sql`
      UPDATE user_push_tokens 
      SET is_active = FALSE, updated_at = NOW()
      WHERE user_id = ${userId} 
      AND token != ${token}
      AND is_active = TRUE
    `;

    console.log('Push token registered successfully for user:', clerkId);

    return Response.json({ 
      success: true, 
      message: 'Push token registered successfully' 
    });

  } catch (error) {
    console.error('Error registering push token:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to register push token' 
    }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const sql = getDatabase();
    const body: { clerkId: string; token?: string; deviceId?: string } = await request.json();
    const { clerkId, token, deviceId } = body;

    if (!clerkId) {
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    // Get user's database ID from clerk_id
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      if (process.env.NODE_ENV === 'development') console.log('User not found in database for clerkId:', clerkId);
      return Response.json({ 
        success: true, 
        message: 'User not found - token deactivation skipped. Please sign out and sign in again.' 
      });
    }

    const userId = user.id;

    // Deactivate specific token or all tokens for device
    if (token) {
      await sql`
        UPDATE user_push_tokens 
        SET is_active = FALSE, updated_at = NOW()
        WHERE user_id = ${userId} AND token = ${token}
      `;
    } else if (deviceId) {
      await sql`
        UPDATE user_push_tokens 
        SET is_active = FALSE, updated_at = NOW()
        WHERE user_id = ${userId} AND device_id = ${deviceId}
      `;
    } else {
      // Deactivate all tokens for user
      await sql`
        UPDATE user_push_tokens 
        SET is_active = FALSE, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    }

    return Response.json({ 
      success: true, 
      message: 'Push token(s) deactivated successfully' 
    });

  } catch (error) {
    console.error('Error deactivating push token:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to deactivate push token' 
    }, { status: 500 });
  }
}