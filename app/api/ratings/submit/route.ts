import { getDatabase } from '@/lib/database';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const {
      clerkId,
      bookingId,
      ratedUserId,
      rating,
      reviewText,
      punctuality,
      communication,
      cleanliness,
      safety,
      ratingType,
      isAnonymous
    } = await request.json();

    // Validate required fields
    if (!clerkId || !bookingId || !ratedUserId || !rating || !ratingType) {
      return Response.json({ 
        success: false, 
        error: 'Missing required fields' 
      }, { status: 400 });
    }

    if (rating < 1 || rating > 5) {
      return Response.json({ 
        success: false, 
        error: 'Rating must be between 1 and 5' 
      }, { status: 400 });
    }

    if (!['driver_rating', 'rider_rating'].includes(ratingType)) {
      return Response.json({ 
        success: false, 
        error: 'Invalid rating type' 
      }, { status: 400 });
    }

    // Get the rater's user ID from clerk ID
    const [rater] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!rater) {
      return Response.json({ 
        success: false, 
        error: 'User not found' 
      }, { status: 404 });
    }

    // Verify the booking exists and user is part of it
    const [booking] = await sql`
      SELECT 
        b.id,
        b.ride_id,
        b.rider_id,
        b.status,
        r.driver_id
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      WHERE b.id = ${bookingId}
      AND (b.rider_id = ${rater.id} OR r.driver_id = ${rater.id})
    `;

    if (!booking) {
      return Response.json({ 
        success: false, 
        error: 'Booking not found or unauthorized' 
      }, { status: 404 });
    }

    // Verify booking is completed
    if (booking.status !== 'completed') {
      return Response.json({ 
        success: false, 
        error: 'Can only rate completed rides' 
      }, { status: 400 });
    }

    // Verify the rated user is part of the booking
    const isRatingDriver = ratingType === 'driver_rating';
    const expectedRatedUserId = isRatingDriver ? booking.driver_id : booking.rider_id;
    
    const [ratedUser] = await sql`
      SELECT id FROM users WHERE id = ${ratedUserId}
    `;

    if (!ratedUser || ratedUser.id !== expectedRatedUserId) {
      return Response.json({ 
        success: false, 
        error: 'Invalid rated user for this booking' 
      }, { status: 400 });
    }

    // Check if rating already exists
    const [existingRating] = await sql`
      SELECT id FROM ride_ratings
      WHERE booking_id = ${bookingId}
      AND rater_id = ${rater.id}
      AND rated_user_id = ${ratedUserId}
    `;

    if (existingRating) {
      return Response.json({ 
        success: false, 
        error: 'Rating already submitted for this booking' 
      }, { status: 409 });
    }

    // Insert the rating
    const [newRating] = await sql`
      INSERT INTO ride_ratings (
        ride_id,
        booking_id,
        rater_id,
        rated_user_id,
        rating,
        review_text,
        punctuality,
        communication,
        cleanliness,
        safety,
        rating_type,
        is_anonymous
      )
      VALUES (
        ${booking.ride_id},
        ${bookingId},
        ${rater.id},
        ${ratedUserId},
        ${rating},
        ${reviewText || null},
        ${punctuality || null},
        ${communication || null},
        ${cleanliness || null},
        ${safety || null},
        ${ratingType},
        ${isAnonymous || false}
      )
      RETURNING id, created_at
    `;

    // Mark booking as rating submitted
    await sql`
      UPDATE bookings 
      SET rating_submitted = true, updated_at = NOW()
      WHERE id = ${bookingId}
    `;

    // Update user's average rating
    const [avgRating] = await sql`
      SELECT ROUND(AVG(rating), 2) as avg_rating
      FROM ride_ratings
      WHERE rated_user_id = ${ratedUserId} 
      AND rating_type = ${ratingType}
    `;

    // Update the appropriate rating field based on rating type
    if (ratingType === 'driver_rating') {
      await sql`
        UPDATE users 
        SET rating_driver = ${avgRating.avg_rating || 5.00}
        WHERE id = ${ratedUserId}
      `;
    } else {
      await sql`
        UPDATE users 
        SET rating_rider = ${avgRating.avg_rating || 5.00}
        WHERE id = ${ratedUserId}
      `;
    }

    console.log(`Rating submitted: ${rating} stars for ${ratingType} by user ${clerkId}`);

    return Response.json({
      success: true,
      message: 'Rating submitted successfully',
      rating: {
        id: newRating.id,
        rating: rating,
        ratingType: ratingType,
        createdAt: newRating.created_at
      }
    });

  } catch (error) {
    console.error('Error submitting rating:', error);
    return Response.json({
      success: false,
      error: 'Failed to submit rating',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}