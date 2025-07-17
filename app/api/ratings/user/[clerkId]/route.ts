import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    // Extract clerkId from the URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const clerkId = pathParts[pathParts.length - 1];
    
    const searchParams = url.searchParams;
    const ratingType = searchParams.get('type'); // 'driver', 'rider', or null for both
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!clerkId) {
      return Response.json({ 
        success: false, 
        error: 'User ID is required' 
      }, { status: 400 });
    }

    // Get user ID from clerk ID
    const [user] = await sql`
      SELECT id FROM users WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ 
        success: false, 
        error: 'User not found' 
      }, { status: 404 });
    }

    // Build rating type filter
    let ratingTypeFilter = sql``;
    if (ratingType === 'driver') {
      ratingTypeFilter = sql`AND rr.rating_type = 'driver_rating'`;
    } else if (ratingType === 'rider') {
      ratingTypeFilter = sql`AND rr.rating_type = 'rider_rating'`;
    }

    // Get ratings received by this user
    const ratingsReceived = await sql`
      SELECT 
        rr.id,
        rr.rating,
        rr.review_text,
        rr.punctuality,
        rr.communication,
        rr.cleanliness,
        rr.safety,
        rr.rating_type,
        rr.is_anonymous,
        rr.created_at,
        
        -- Ride details
        r.origin_label,
        r.destination_label,
        r.departure_time,
        
        -- Rater details (if not anonymous)
        CASE 
          WHEN rr.is_anonymous = true THEN 'Anonymous'
          ELSE CONCAT(rater.first_name, ' ', COALESCE(rater.last_name, ''))
        END as rater_name,
        
        CASE 
          WHEN rr.is_anonymous = true THEN null
          ELSE rater.avatar_url
        END as rater_avatar
        
      FROM ride_ratings rr
      JOIN rides r ON rr.ride_id = r.id
      JOIN users rater ON rr.rater_id = rater.id
      WHERE rr.rated_user_id = ${user.id}
      ${ratingTypeFilter}
      ORDER BY rr.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Get rating summary statistics
    const [summary] = await sql`
      SELECT 
        COUNT(*) as total_ratings,
        ROUND(AVG(rating), 2) as avg_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star,
        
        -- Category averages
        ROUND(AVG(punctuality), 2) as avg_punctuality,
        ROUND(AVG(communication), 2) as avg_communication,
        ROUND(AVG(cleanliness), 2) as avg_cleanliness,
        ROUND(AVG(safety), 2) as avg_safety,
        
        -- Type breakdown
        COUNT(CASE WHEN rating_type = 'driver_rating' THEN 1 END) as driver_ratings,
        COUNT(CASE WHEN rating_type = 'rider_rating' THEN 1 END) as rider_ratings,
        
        ROUND(AVG(CASE WHEN rating_type = 'driver_rating' THEN rating END), 2) as avg_driver_rating,
        ROUND(AVG(CASE WHEN rating_type = 'rider_rating' THEN rating END), 2) as avg_rider_rating
        
      FROM ride_ratings 
      WHERE rated_user_id = ${user.id}
      ${ratingTypeFilter}
    `;

    // Get total count for pagination
    const [countResult] = await sql`
      SELECT COUNT(*) as total
      FROM ride_ratings
      WHERE rated_user_id = ${user.id}
      ${ratingTypeFilter}
    `;

    return Response.json({
      success: true,
      data: {
        ratings: ratingsReceived,
        summary: {
          totalRatings: parseInt(summary.total_ratings),
          averageRating: parseFloat(summary.avg_rating) || 0,
          ratingDistribution: {
            fiveStar: parseInt(summary.five_star),
            fourStar: parseInt(summary.four_star),
            threeStar: parseInt(summary.three_star),
            twoStar: parseInt(summary.two_star),
            oneStar: parseInt(summary.one_star)
          },
          categoryAverages: {
            punctuality: parseFloat(summary.avg_punctuality) || null,
            communication: parseFloat(summary.avg_communication) || null,
            cleanliness: parseFloat(summary.avg_cleanliness) || null,
            safety: parseFloat(summary.avg_safety) || null
          },
          typeBreakdown: {
            driverRatings: parseInt(summary.driver_ratings),
            riderRatings: parseInt(summary.rider_ratings),
            avgDriverRating: parseFloat(summary.avg_driver_rating) || null,
            avgRiderRating: parseFloat(summary.avg_rider_rating) || null
          }
        },
        pagination: {
          total: parseInt(countResult.total),
          limit: limit,
          offset: offset,
          hasMore: (offset + limit) < parseInt(countResult.total)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching user ratings:', error);
    return Response.json({
      success: false,
      error: 'Failed to fetch ratings',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}