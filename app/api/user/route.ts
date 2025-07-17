import { getDatabase } from '@/lib/database';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { firstName, lastName, email, clerkId, avatarUrl } = await request.json();

    if (!firstName || !email || !clerkId) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Create full name for backward compatibility with existing name column
    const fullName = lastName ? `${firstName} ${lastName}` : firstName;

    const response = await sql`
      INSERT INTO users (
        name,
        first_name,
        last_name, 
        email, 
        clerk_id,
        avatar_url
      ) 
      VALUES (
        ${fullName},
        ${firstName},
        ${lastName || ''},
        ${email},
        ${clerkId},
        ${avatarUrl}
      )
      ON CONFLICT (clerk_id) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = NOW();`;

    // Create default notification preferences for new users
    try {
    const sql = getDatabase();
      // Get the user ID that was just created/updated
      const [createdUser] = await sql`
        SELECT id FROM users WHERE clerk_id = ${clerkId}
      `;
      
      if (createdUser) {
        await sql`
          INSERT INTO notification_preferences (user_id) 
          VALUES (${createdUser.id})
          ON CONFLICT (user_id) 
          DO NOTHING;`;
        
        if (process.env.NODE_ENV === 'development') {
          console.log("Default notification preferences created for user:", clerkId);
        }
      }
    } catch (prefError) {
      // Log error but don't fail user creation
      if (process.env.NODE_ENV === 'development') {
        console.error("Error creating default notification preferences:", prefError);
      }
    }
    
    return new Response(JSON.stringify({ data: response }), {
      status: 201,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error("Error creating user:", error);
    }
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}