import { getDatabase } from '@/lib/database';


export async function POST(request: Request, { params }: { params?: { rideId?: string } }) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const rideId = params?.rideId || pathParts[pathParts.length - 2];

    if (!rideId) {
      return Response.json({ 
        success: false, 
        error: 'Ride ID is required' 
      }, { status: 400 });
    }

    const body = await request.json();
    const { seatsRequested } = body;

    if (!seatsRequested || seatsRequested <= 0) {
      return Response.json({ 
        success: false, 
        error: 'Valid number of seats required' 
      }, { status: 400 });
    }

    // Use the database validation function
    const [validation] = await sql`
      SELECT * FROM validate_booking_request(${rideId}::UUID, ${seatsRequested})
    `;

    return Response.json({
      success: true,
      isValid: validation.is_valid,
      availableSeats: validation.available_seats,
      errorMessage: validation.error_message
    });

  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({
      success: false,
      error: 'Failed to validate booking request'
    }, { status: 500 });
  }
}