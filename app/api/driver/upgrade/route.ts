import { users } from '@clerk/clerk-sdk-node';
import { getDatabase } from '@/lib/database';


interface DriverUpgradeRequest {
  clerkId: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: number;
  vehicleColor: string;
  vehiclePlate: string;
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const body: DriverUpgradeRequest = await request.json();
    const { 
      clerkId, 
      vehicleMake, 
      vehicleModel, 
      vehicleYear, 
      vehicleColor, 
      vehiclePlate 
    } = body;

    // Validate required fields
    if (!clerkId || !vehicleMake || !vehicleModel || !vehicleYear || !vehicleColor || !vehiclePlate) {
      return Response.json({ error: 'All fields are required' }, { status: 400 });
    }

    // Validate year is reasonable
    const currentYear = new Date().getFullYear();
    if (vehicleYear < 1900 || vehicleYear > currentYear + 1) {
      return Response.json({ error: 'Invalid vehicle year' }, { status: 400 });
    }

    // Check if user exists
    const [existingUser] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!existingUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Update user to driver status in DB
    await sql`
      UPDATE users 
      SET 
        is_driver = TRUE,
        vehicle_make = ${vehicleMake},
        vehicle_model = ${vehicleModel},
        vehicle_year = ${vehicleYear},
        vehicle_color = ${vehicleColor},
        vehicle_plate = ${vehiclePlate},
        updated_at = NOW()
      WHERE clerk_id = ${clerkId}
    `;

    // Only update Clerk metadata if secret key is available
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (clerkSecretKey) {
      try {
    const sql = getDatabase();
        await users.updateUser(clerkId, {
          publicMetadata: {
            is_driver: true,
          },
        });
      } catch (clerkError) {
        console.error('Clerk update error:', clerkError);
        // Continue with the response even if Clerk update fails
        // The database update was successful
      }
    } else {
      console.warn('CLERK_SECRET_KEY not found - skipping Clerk metadata update');
    }

    return Response.json({ success: true, message: 'Driver status updated successfully' });
  } catch (error) {
    console.error('Driver upgrade error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}