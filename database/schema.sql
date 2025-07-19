CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id     VARCHAR(50) UNIQUE NOT NULL, 
    name         VARCHAR(100) NOT NULL,
    email        VARCHAR(100) UNIQUE NOT NULL,
    avatar_url   TEXT,               
    phone        VARCHAR(25),        
    is_driver    BOOLEAN DEFAULT FALSE, 
    rating       NUMERIC(3,2) DEFAULT 5.00, 
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

BEGIN; 


ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vehicle_make   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS vehicle_model  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS vehicle_year   SMALLINT,
  ADD COLUMN IF NOT EXISTS vehicle_color  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS vehicle_plate  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rating_rider   NUMERIC(3,2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS rating_driver  NUMERIC(3,2) DEFAULT 5.00;


 
ALTER TABLE users DROP COLUMN IF EXISTS rating;


ALTER TABLE users
  DROP CONSTRAINT IF EXISTS driver_requires_vehicle,      
  ADD CONSTRAINT driver_requires_vehicle
  CHECK (
    NOT is_driver                                        
    OR (
      vehicle_make  IS NOT NULL
      AND vehicle_model IS NOT NULL
      AND vehicle_year  IS NOT NULL
      AND vehicle_plate IS NOT NULL
    )
  );

COMMIT;

BEGIN;

/* -----------------------------------------------------------
   1. ENUM: status of a ride
----------------------------------------------------------- */
CREATE TYPE ride_status AS ENUM ('open', 'full', 'completed', 'cancelled');

/* -----------------------------------------------------------
   2. RIDES (one row per posted trip)
----------------------------------------------------------- */
CREATE TABLE rides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FK to the driver (must already be a user)
  driver_id        UUID NOT NULL
                       REFERENCES users(id)
                       ON DELETE CASCADE,

  /* ORIGIN & DESTINATION
     - store both human-readable text and geo coords for maps / queries */
  origin_label     TEXT         NOT NULL,   -- “Campus Main Gate”
  origin_lat       NUMERIC(10,6) NOT NULL,  -- 6-dec places ≈ 0.11 m
  origin_lng       NUMERIC(10,6) NOT NULL,

  destination_label TEXT         NOT NULL,  -- “Accra, Circle”
  destination_lat   NUMERIC(10,6) NOT NULL,
  destination_lng   NUMERIC(10,6) NOT NULL,

  /* TIMING */
  departure_time   TIMESTAMPTZ   NOT NULL,
  arrival_time     TIMESTAMPTZ,              -- optional / ETA

  /* CAPACITY */
  seats_total      SMALLINT      NOT NULL CHECK (seats_total > 0),
  seats_available  SMALLINT      NOT NULL
                                 CHECK (seats_available >= 0
                                    AND seats_available <= seats_total),

  /* PRICING */
  price            NUMERIC(8,2)  NOT NULL,   -- total price per seat
  currency         CHAR(3)       NOT NULL DEFAULT 'USD',

  /* STATE */
  status           ride_status   NOT NULL DEFAULT 'open',

  /* AUDIT */
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

/* -----------------------------------------------------------
   3. Keep updated_at fresh
----------------------------------------------------------- */
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_rides
BEFORE UPDATE ON rides
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

/* -----------------------------------------------------------
   4. Helpful indexes
----------------------------------------------------------- */
CREATE INDEX rides_driver_idx     ON rides(driver_id);
CREATE INDEX rides_depart_idx     ON rides(departure_time);
CREATE INDEX rides_status_idx     ON rides(status);

COMMIT;

CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_idx
ON users (clerk_id);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS driver_requires_vehicle,
  ADD CONSTRAINT driver_requires_vehicle
  CHECK (
    NOT is_driver
    OR (
      vehicle_make IS NOT NULL
      AND vehicle_model IS NOT NULL
      AND vehicle_year IS NOT NULL
      AND vehicle_plate IS NOT NULL
    )
  );

-- Enable UUID generation if not already on
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Enum for booking lifecycle
CREATE TYPE booking_status AS ENUM (
  'pending',     -- seat reserved, not yet paid
  'paid',        -- payment confirmed
  'completed',   -- ride finished
  'cancelled'    -- user or driver cancelled
);

-- 2. Bookings table
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- relationships
  ride_id         UUID NOT NULL REFERENCES rides(id)   ON DELETE CASCADE,
  rider_id        UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  -- seat & price snapshot
  seats_booked    SMALLINT NOT NULL CHECK (seats_booked > 0),
  price_per_seat  NUMERIC(8,2) NOT NULL,
  total_price     NUMERIC(10,2) GENERATED ALWAYS AS (seats_booked * price_per_seat) STORED,
  currency        CHAR(3)      NOT NULL DEFAULT 'USD',
  -- lifecycle
  status          booking_status NOT NULL DEFAULT 'pending',
  -- audit
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- 3. Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_bookings
BEFORE UPDATE ON bookings
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

-- 4. Helpful indexes
CREATE INDEX IF NOT EXISTS bookings_ride_idx  ON bookings(ride_id);
CREATE INDEX IF NOT EXISTS bookings_rider_idx ON bookings(rider_id);

-- 5. Optional: Prevent duplicate bookings (recommended)
ALTER TABLE bookings 
ADD CONSTRAINT unique_rider_ride 
UNIQUE (ride_id, rider_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(25),
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS music_ok BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS pets_ok BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS smoking_ok BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS conversation_level VARCHAR(20) DEFAULT 'friendly',
ADD COLUMN IF NOT EXISTS preferred_contact VARCHAR(20) DEFAULT 'app',
ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(25);

ALTER TABLE users 
ADD COLUMN push_token TEXT,
ADD COLUMN notification_preferences JSONB DEFAULT '{"nearby_rides": true, "booking_updates": true, "reminders": true, "chat": true}';

ALTER TABLE users
DROP COLUMN IF EXISTS push_token,
DROP COLUMN IF EXISTS notification_preferences;

-- Notifications and Push Token Management Schema
-- Run this SQL to add notification support to your existing database

-- Enable UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Push Tokens table
-- Stores Expo push tokens for each user device
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL,              -- Expo push token
    device_id       TEXT,                       -- Optional device identifier
    platform        VARCHAR(10),                -- 'ios', 'android', 'web'
    is_active       BOOLEAN DEFAULT TRUE,       -- Token status
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one token per device per user
    UNIQUE(user_id, device_id)
);

-- 2. Notification Preferences table
-- User preferences for different types of notifications
CREATE TABLE IF NOT EXISTS notification_preferences (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Push notification preferences
    rides_near_me           BOOLEAN DEFAULT TRUE,    -- Event #1: Ride Posted Near You
    booking_requests        BOOLEAN DEFAULT TRUE,    -- Event #2: Booking Request (for drivers)
    booking_confirmations   BOOLEAN DEFAULT TRUE,    -- Event #3: Booking Confirmation (for riders)
    ride_reminders          BOOLEAN DEFAULT TRUE,    -- Event #4: Ride Reminder
    ride_cancellations      BOOLEAN DEFAULT TRUE,    -- Event #5: Ride Cancellation
    seat_availability       BOOLEAN DEFAULT TRUE,    -- Event #6: Seat Availability Update
    chat_messages           BOOLEAN DEFAULT TRUE,    -- Event #7: Chat Message
    payment_issues          BOOLEAN DEFAULT TRUE,    -- Event #8: Payment Issue/Refund
    
    -- Location preferences for nearby rides
    nearby_radius_km        SMALLINT DEFAULT 50,     -- Radius for "nearby" rides
    preferred_locations     JSON,                    -- Array of preferred pickup/dropoff areas
    
    -- Timing preferences
    quiet_hours_start       TIME,                    -- No notifications during quiet hours
    quiet_hours_end         TIME,
    timezone                VARCHAR(50) DEFAULT 'UTC',
    
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One preference record per user
    UNIQUE(user_id)
);

-- 3. Notification Log table
-- Track all notifications sent for debugging and analytics
CREATE TABLE IF NOT EXISTS notification_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Notification details
    type            VARCHAR(50) NOT NULL,       -- 'ride_posted', 'booking_request', etc.
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    data            JSON,                       -- Additional payload data
    
    -- Delivery details
    push_token      TEXT,                       -- Token used for delivery
    delivery_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
    delivery_error  TEXT,                       -- Error message if failed
    
    -- References to related entities
    ride_id         UUID REFERENCES rides(id) ON DELETE SET NULL,
    booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
    
    -- Timestamps
    scheduled_at    TIMESTAMPTZ,                -- When notification should be sent
    sent_at         TIMESTAMPTZ,                -- When notification was actually sent
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS user_push_tokens_user_idx ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS user_push_tokens_active_idx ON user_push_tokens(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx ON notification_preferences(user_id);

CREATE INDEX IF NOT EXISTS notification_log_user_idx ON notification_log(user_id);
CREATE INDEX IF NOT EXISTS notification_log_type_idx ON notification_log(type);
CREATE INDEX IF NOT EXISTS notification_log_status_idx ON notification_log(delivery_status);
CREATE INDEX IF NOT EXISTS notification_log_ride_idx ON notification_log(ride_id);
CREATE INDEX IF NOT EXISTS notification_log_booking_idx ON notification_log(booking_id);
CREATE INDEX IF NOT EXISTS notification_log_scheduled_idx ON notification_log(scheduled_at);

-- 5. Triggers to keep updated_at fresh
CREATE TRIGGER set_updated_at_user_push_tokens
BEFORE UPDATE ON user_push_tokens
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

CREATE TRIGGER set_updated_at_notification_preferences
BEFORE UPDATE ON notification_preferences
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

-- 6. Default notification preferences for existing users
-- Insert default preferences for users who don't have them yet
INSERT INTO notification_preferences (user_id)
SELECT id FROM users 
WHERE id NOT IN (SELECT user_id FROM notification_preferences)
ON CONFLICT (user_id) DO NOTHING;

-- 7. Sample location-based query for nearby rides notification
-- This is an example of how to find users who should be notified about new rides
/*
Example query to find users who should receive "Ride Posted Near You" notifications:

WITH nearby_users AS (
    SELECT DISTINCT u.id as user_id
    FROM users u
    JOIN notification_preferences np ON u.id = np.user_id
    WHERE np.rides_near_me = TRUE
    AND EXISTS (
        -- Check if user has any saved locations within radius of the new ride
        SELECT 1 FROM user_locations ul
        WHERE ul.user_id = u.id
        AND (
            -- Distance from user location to ride origin
            6371 * acos(
                cos(radians(ul.latitude)) 
                * cos(radians(:ride_origin_lat)) 
                * cos(radians(:ride_origin_lng) - radians(ul.longitude)) 
                + sin(radians(ul.latitude)) 
                * sin(radians(:ride_origin_lat))
            ) <= np.nearby_radius_km
            OR
            -- Distance from user location to ride destination
            6371 * acos(
                cos(radians(ul.latitude)) 
                * cos(radians(:ride_dest_lat)) 
                * cos(radians(:ride_dest_lng) - radians(ul.longitude)) 
                + sin(radians(ul.latitude)) 
                * sin(radians(:ride_dest_lat))
            ) <= np.nearby_radius_km
        )
    )
)
SELECT u.id, u.name, upt.token
FROM nearby_users nu
JOIN users u ON nu.user_id = u.id
JOIN user_push_tokens upt ON u.id = upt.user_id
WHERE upt.is_active = TRUE;
*/


-- Chat Database Schema for Loop

-- 1. Chat Threads (one per booking)
CREATE TABLE chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  
  -- Participants
  rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Status
  status VARCHAR(20) DEFAULT 'active', -- active, archived, closed
  last_message_at TIMESTAMPTZ,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(booking_id), -- One thread per booking
  CHECK (rider_id != driver_id)
);

-- 2. Chat Messages
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  
  -- Message content
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type VARCHAR(20) DEFAULT 'text', -- text, image, location, system
  content TEXT NOT NULL,
  
  -- Metadata
  read_by_rider BOOLEAN DEFAULT FALSE,
  read_by_driver BOOLEAN DEFAULT FALSE,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX chat_threads_booking_idx ON chat_threads(booking_id);
CREATE INDEX chat_threads_rider_idx ON chat_threads(rider_id);
CREATE INDEX chat_threads_driver_idx ON chat_threads(driver_id);
CREATE INDEX chat_messages_thread_idx ON chat_messages(thread_id);
CREATE INDEX chat_messages_created_idx ON chat_messages(created_at DESC);

-- 4. Trigger to update thread timestamp
CREATE OR REPLACE FUNCTION update_thread_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_threads 
  SET last_message_at = NEW.created_at, updated_at = NOW()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_thread_timestamp
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_last_message();






-- STEP 1: Add columns only (no transaction needed for this)
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(50);

-- Check if columns were added successfully
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name IN ('first_name', 'last_name');

-- STEP 2: Test the name splitting logic on a few records
SELECT 
  name,
  CASE
    WHEN position(' ' in name) > 0
    THEN trim(substring(name from 1 for position(' ' in name) - 1))
    ELSE trim(name)
  END as computed_first_name,
  CASE
    WHEN position(' ' in name) > 0
    THEN trim(substring(name from position(' ' in name) + 1))
    ELSE ''
  END as computed_last_name
FROM users 
WHERE name IS NOT NULL 
LIMIT 5;

-- STEP 3: Update first_name (simple cases first)
UPDATE users
SET first_name = trim(substring(name from 1 for position(' ' in name) - 1))
WHERE name IS NOT NULL 
  AND position(' ' in name) > 0 
  AND (first_name IS NULL OR first_name = '');

-- Check progress
SELECT COUNT(*) as updated_with_space FROM users WHERE first_name IS NOT NULL;

-- STEP 4: Update first_name for single names
UPDATE users
SET first_name = trim(name)
WHERE name IS NOT NULL 
  AND position(' ' in name) = 0 
  AND (first_name IS NULL OR first_name = '');

-- Check progress
SELECT COUNT(*) as total_first_names FROM users WHERE first_name IS NOT NULL;

-- STEP 5: Update last_name
UPDATE users
SET last_name = trim(substring(name from position(' ' in name) + 1))
WHERE name IS NOT NULL 
  AND position(' ' in name) > 0 
  AND (last_name IS NULL OR last_name = '');

-- STEP 6: Handle any remaining NULL first_names
UPDATE users
SET first_name = 'User'
WHERE first_name IS NULL OR trim(first_name) = '';

-- STEP 7: Verify before adding constraints
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN first_name IS NULL OR trim(first_name) = '' THEN 1 END) as problematic_first_names,
  COUNT(CASE WHEN last_name IS NULL THEN 1 END) as null_last_names
FROM users;

-- STEP 8: Add constraints (only if Step 7 shows no problematic_first_names)
-- ALTER TABLE users ALTER COLUMN first_name SET NOT NULL;

-- STEP 9: Add constraint (only if no problematic names)
-- ALTER TABLE users ADD CONSTRAINT check_name_not_empty CHECK (length(trim(first_name)) > 0);

-- STEP 10: Add index
CREATE INDEX IF NOT EXISTS idx_users_names ON users(first_name, last_name);

-- STEP 11: Keep name column for data consistency
-- DECISION: Keep the name column to maintain data integrity and backward compatibility
-- The name column will be automatically populated from first_name + last_name
-- All queries now use CONCAT(first_name, ' ', last_name) instead of selecting name directly
-- This provides the best of both worlds: proper name structure + backward compatibility

-- Optional: Add trigger to auto-update name column when first_name/last_name change
-- CREATE OR REPLACE FUNCTION update_user_name() RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.name = CONCAT(NEW.first_name, ' ', COALESCE(NEW.last_name, ''));
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- 
-- CREATE TRIGGER trigger_update_user_name
--   BEFORE UPDATE OF first_name, last_name ON users
--   FOR EACH ROW EXECUTE FUNCTION update_user_name();

-- ================================================================
-- DRIVER VERIFICATION SYSTEM - Stripe Identity Integration
-- ================================================================

-- Add verification status to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'unverified';
-- Values: unverified, pending, verified, rejected, suspended

-- Create driver verification table for detailed tracking
CREATE TABLE IF NOT EXISTS driver_verification (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_verification_id VARCHAR(255), -- Stripe Identity session ID
  
  -- Document URLs (optional - Stripe handles storage)
  license_front_url     TEXT,
  license_back_url      TEXT,
  insurance_doc_url     TEXT,
  
  -- Verification Status
  identity_status       VARCHAR(50) DEFAULT 'pending', -- pending, verified, failed
  document_status       VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  overall_status        VARCHAR(50) DEFAULT 'pending', -- pending, verified, rejected
  
  -- Verification Details
  verified_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  requires_resubmission BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint for user_id (required for ON CONFLICT)
ALTER TABLE driver_verification ADD CONSTRAINT unique_driver_verification_user_id UNIQUE (user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_driver_verification_user_id ON driver_verification(user_id);
CREATE INDEX IF NOT EXISTS idx_driver_verification_stripe_id ON driver_verification(stripe_verification_id);
CREATE INDEX IF NOT EXISTS idx_driver_verification_status ON driver_verification(overall_status);
CREATE INDEX IF NOT EXISTS idx_users_verification_status ON users(verification_status);

-- Update existing drivers to have 'legacy_verified' status
UPDATE users 
SET verification_status = 'legacy_verified' 
WHERE is_driver = TRUE AND verification_status = 'unverified';

-- ================================================================
-- RATING & REVIEW SYSTEM
-- ================================================================

-- Create rating/review table for detailed ride feedback
CREATE TABLE IF NOT EXISTS ride_ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  rater_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Rating details
  rating          SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text     TEXT,
  
  -- Category ratings (optional detailed feedback)
  punctuality     SMALLINT CHECK (punctuality IS NULL OR (punctuality >= 1 AND punctuality <= 5)),
  communication   SMALLINT CHECK (communication IS NULL OR (communication >= 1 AND communication <= 5)),
  cleanliness     SMALLINT CHECK (cleanliness IS NULL OR (cleanliness >= 1 AND cleanliness <= 5)),
  safety          SMALLINT CHECK (safety IS NULL OR (safety >= 1 AND safety <= 5)),
  
  -- Rating type
  rating_type     VARCHAR(20) NOT NULL CHECK (rating_type IN ('driver_rating', 'rider_rating')),
  
  -- Metadata
  is_anonymous    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(booking_id, rater_id, rated_user_id), -- One rating per booking per user pair
  CHECK (rater_id != rated_user_id) -- Can't rate yourself
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS ride_ratings_ride_idx ON ride_ratings(ride_id);
CREATE INDEX IF NOT EXISTS ride_ratings_booking_idx ON ride_ratings(booking_id);
CREATE INDEX IF NOT EXISTS ride_ratings_rater_idx ON ride_ratings(rater_id);
CREATE INDEX IF NOT EXISTS ride_ratings_rated_user_idx ON ride_ratings(rated_user_id);
CREATE INDEX IF NOT EXISTS ride_ratings_type_idx ON ride_ratings(rating_type);
CREATE INDEX IF NOT EXISTS ride_ratings_created_idx ON ride_ratings(created_at DESC);

-- Add trigger for updated_at
CREATE TRIGGER set_updated_at_ride_ratings
BEFORE UPDATE ON ride_ratings
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

-- ================================================================
-- RIDE HISTORY & AUTOMATIC STATUS MANAGEMENT
-- ================================================================

-- Add additional status for expired rides
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'expired';

-- Add fields for ride completion tracking
ALTER TABLE rides ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS auto_completed BOOLEAN DEFAULT FALSE;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rating_submitted BOOLEAN DEFAULT FALSE;

-- Create function to automatically expire rides
CREATE OR REPLACE FUNCTION expire_old_rides()
RETURNS INTEGER AS $$
DECLARE
  affected_rides INTEGER;
  affected_bookings INTEGER;
BEGIN
  -- Update rides that are past departure time and still open/full
  UPDATE rides 
  SET 
    status = 'expired',
    auto_completed = TRUE,
    updated_at = NOW()
  WHERE 
    departure_time < NOW() - INTERVAL '2 hours' -- 2 hour grace period
    AND status IN ('open', 'full')
    AND status != 'expired';
  
  GET DIAGNOSTICS affected_rides = ROW_COUNT;
  
  -- Update associated bookings
  UPDATE bookings 
  SET 
    status = 'expired',
    updated_at = NOW()
  WHERE 
    ride_id IN (
      SELECT id FROM rides 
      WHERE status = 'expired' AND auto_completed = TRUE
    )
    AND status IN ('pending', 'paid');
  
  GET DIAGNOSTICS affected_bookings = ROW_COUNT;
  
  -- Log the operation
  RAISE NOTICE 'Auto-expired % rides and % bookings', affected_rides, affected_bookings;
  
  RETURN affected_rides;
END;
$$ LANGUAGE plpgsql;

-- Create function to auto-complete rides after departure
CREATE OR REPLACE FUNCTION auto_complete_rides()
RETURNS INTEGER AS $$
DECLARE
  affected_rides INTEGER;
  affected_bookings INTEGER;
BEGIN
  -- Update rides that are 4+ hours past departure and have paid bookings
  UPDATE rides 
  SET 
    status = 'completed',
    completed_at = NOW(),
    auto_completed = TRUE,
    updated_at = NOW()
  WHERE 
    departure_time < NOW() - INTERVAL '4 hours' -- 4 hour completion window
    AND status IN ('open', 'full')
    AND EXISTS (
      SELECT 1 FROM bookings 
      WHERE ride_id = rides.id AND status = 'paid'
    );
  
  GET DIAGNOSTICS affected_rides = ROW_COUNT;
  
  -- Update associated paid bookings to completed
  UPDATE bookings 
  SET 
    status = 'completed',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE 
    ride_id IN (
      SELECT id FROM rides 
      WHERE status = 'completed' AND auto_completed = TRUE AND completed_at >= NOW() - INTERVAL '1 minute'
    )
    AND status = 'paid';
  
  GET DIAGNOSTICS affected_bookings = ROW_COUNT;
  
  -- Log the operation
  RAISE NOTICE 'Auto-completed % rides and % bookings', affected_rides, affected_bookings;
  
  RETURN affected_rides;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- RATING SUMMARY VIEWS FOR PERFORMANCE
-- ================================================================

-- Create materialized view for user rating summaries
CREATE MATERIALIZED VIEW IF NOT EXISTS user_rating_summary AS
SELECT 
  u.id as user_id,
  u.clerk_id,
  u.first_name,
  u.last_name,
  
  -- Driver ratings (when user was rated as driver)
  COUNT(CASE WHEN rr.rating_type = 'driver_rating' THEN 1 END) as total_driver_ratings,
  ROUND(AVG(CASE WHEN rr.rating_type = 'driver_rating' THEN rr.rating END), 2) as avg_driver_rating,
  ROUND(AVG(CASE WHEN rr.rating_type = 'driver_rating' THEN rr.punctuality END), 2) as avg_driver_punctuality,
  ROUND(AVG(CASE WHEN rr.rating_type = 'driver_rating' THEN rr.communication END), 2) as avg_driver_communication,
  ROUND(AVG(CASE WHEN rr.rating_type = 'driver_rating' THEN rr.cleanliness END), 2) as avg_driver_cleanliness,
  ROUND(AVG(CASE WHEN rr.rating_type = 'driver_rating' THEN rr.safety END), 2) as avg_driver_safety,
  
  -- Rider ratings (when user was rated as rider)
  COUNT(CASE WHEN rr.rating_type = 'rider_rating' THEN 1 END) as total_rider_ratings,
  ROUND(AVG(CASE WHEN rr.rating_type = 'rider_rating' THEN rr.rating END), 2) as avg_rider_rating,
  ROUND(AVG(CASE WHEN rr.rating_type = 'rider_rating' THEN rr.punctuality END), 2) as avg_rider_punctuality,
  ROUND(AVG(CASE WHEN rr.rating_type = 'rider_rating' THEN rr.communication END), 2) as avg_rider_communication,
  
  -- Total rides
  COUNT(DISTINCT CASE WHEN r.driver_id = u.id THEN r.id END) as total_rides_driven,
  COUNT(DISTINCT CASE WHEN b.rider_id = u.id THEN b.ride_id END) as total_rides_taken,
  
  -- Last rating received
  MAX(rr.created_at) as last_rating_at
  
FROM users u
LEFT JOIN ride_ratings rr ON u.id = rr.rated_user_id
LEFT JOIN rides r ON u.id = r.driver_id
LEFT JOIN bookings b ON u.id = b.rider_id
GROUP BY u.id, u.clerk_id, u.first_name, u.last_name;

-- Create unique index for materialized view
CREATE UNIQUE INDEX IF NOT EXISTS user_rating_summary_user_id_idx ON user_rating_summary(user_id);

-- Function to refresh rating summaries
CREATE OR REPLACE FUNCTION refresh_rating_summaries()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_rating_summary;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- BACKGROUND JOB SCHEDULING SIMULATION
-- ================================================================

-- Create a simple job log table for tracking automated tasks
CREATE TABLE IF NOT EXISTS background_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        VARCHAR(50) NOT NULL, -- 'expire_rides', 'complete_rides', 'refresh_ratings'
  status          VARCHAR(20) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  affected_rows   INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS background_jobs_type_idx ON background_jobs(job_type);
CREATE INDEX IF NOT EXISTS background_jobs_status_idx ON background_jobs(status);
CREATE INDEX IF NOT EXISTS background_jobs_created_idx ON background_jobs(created_at DESC);

-- ================================================================
-- UPDATE EXISTING USER RATINGS
-- ================================================================

-- Update the users table rating columns based on new rating system
-- This will be handled by the application layer for real-time updates

-- Add helpful indexes for ride history queries
CREATE INDEX IF NOT EXISTS rides_completed_at_idx ON rides(completed_at DESC) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS rides_driver_status_idx ON rides(driver_id, status);
CREATE INDEX IF NOT EXISTS bookings_rider_status_idx ON bookings(rider_id, status);
CREATE INDEX IF NOT EXISTS bookings_completed_rating_idx ON bookings(completed_at DESC, rating_submitted) WHERE status = 'completed';





-- ================================================================
-- NOTIFICATIONS & PUSH TOKENS
-- ================================================================

-- Enable UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Push Tokens table
-- Stores Expo push tokens for each user device
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT NOT NULL,              -- Expo push token
    device_id       TEXT,                       -- Optional device identifier
    platform        VARCHAR(10),                -- 'ios', 'android', 'web'
    is_active       BOOLEAN DEFAULT TRUE,       -- Token status
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one token per device per user
    UNIQUE(user_id, device_id)
);

-- 2. Notification Preferences table
-- User preferences for different types of notifications
CREATE TABLE IF NOT EXISTS notification_preferences (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Push notification preferences
    rides_near_me           BOOLEAN DEFAULT TRUE,    -- Event #1: Ride Posted Near You
    booking_requests        BOOLEAN DEFAULT TRUE,    -- Event #2: Booking Request (for drivers)
    booking_confirmations   BOOLEAN DEFAULT TRUE,    -- Event #3: Booking Confirmation (for riders)
    ride_reminders          BOOLEAN DEFAULT TRUE,    -- Event #4: Ride Reminder
    ride_cancellations      BOOLEAN DEFAULT TRUE,    -- Event #5: Ride Cancellation
    seat_availability       BOOLEAN DEFAULT TRUE,    -- Event #6: Seat Availability Update
    chat_messages           BOOLEAN DEFAULT TRUE,    -- Event #7: Chat Message
    payment_issues          BOOLEAN DEFAULT TRUE,    -- Event #8: Payment Issue/Refund
    
    -- Location preferences for nearby rides
    nearby_radius_km        SMALLINT DEFAULT 50,     -- Radius for "nearby" rides
    preferred_locations     JSON,                    -- Array of preferred pickup/dropoff areas
    
    -- Timing preferences
    quiet_hours_start       TIME,                    -- No notifications during quiet hours
    quiet_hours_end         TIME,
    timezone                VARCHAR(50) DEFAULT 'UTC',
    
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One preference record per user
    UNIQUE(user_id)
);

-- 3. Notification Log table
-- Track all notifications sent for debugging and analytics
CREATE TABLE IF NOT EXISTS notification_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Notification details
    type            VARCHAR(50) NOT NULL,       -- 'ride_posted', 'booking_request', etc.
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    data            JSON,                       -- Additional payload data
    
    -- Delivery details
    push_token      TEXT,                       -- Token used for delivery
    delivery_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
    delivery_error  TEXT,                       -- Error message if failed
    
    -- References to related entities
    ride_id         UUID REFERENCES rides(id) ON DELETE SET NULL,
    booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
    
    -- Timestamps
    scheduled_at    TIMESTAMPTZ,                -- When notification should be sent
    sent_at         TIMESTAMPTZ,                -- When notification was actually sent
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS user_push_tokens_user_idx ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS user_push_tokens_active_idx ON user_push_tokens(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx ON notification_preferences(user_id);

CREATE INDEX IF NOT EXISTS notification_log_user_idx ON notification_log(user_id);
CREATE INDEX IF NOT EXISTS notification_log_type_idx ON notification_log(type);
CREATE INDEX IF NOT EXISTS notification_log_status_idx ON notification_log(delivery_status);
CREATE INDEX IF NOT EXISTS notification_log_ride_idx ON notification_log(ride_id);
CREATE INDEX IF NOT EXISTS notification_log_booking_idx ON notification_log(booking_id);
CREATE INDEX IF NOT EXISTS notification_log_scheduled_idx ON notification_log(scheduled_at);

-- 5. Triggers to keep updated_at fresh
CREATE TRIGGER set_updated_at_user_push_tokens
BEFORE UPDATE ON user_push_tokens
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

CREATE TRIGGER set_updated_at_notification_preferences
BEFORE UPDATE ON notification_preferences
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

-- 6. Default notification preferences for existing users
-- Insert default preferences for users who don't have them yet
INSERT INTO notification_preferences (user_id)
SELECT id FROM users 
WHERE id NOT IN (SELECT user_id FROM notification_preferences)
ON CONFLICT (user_id) DO NOTHING;

-- 7. Sample location-based query for nearby rides notification
-- This is an example of how to find users who should be notified about new rides
/*
Example query to find users who should receive "Ride Posted Near You" notifications:

WITH nearby_users AS (
    SELECT DISTINCT u.id as user_id
    FROM users u
    JOIN notification_preferences np ON u.id = np.user_id
    WHERE np.rides_near_me = TRUE
    AND EXISTS (
        -- Check if user has any saved locations within radius of the new ride
        SELECT 1 FROM user_locations ul
        WHERE ul.user_id = u.id
        AND (
            -- Distance from user location to ride origin
            6371 * acos(
                cos(radians(ul.latitude)) 
                * cos(radians(:ride_origin_lat)) 
                * cos(radians(:ride_origin_lng) - radians(ul.longitude)) 
                + sin(radians(ul.latitude)) 
                * sin(radians(:ride_origin_lat))
            ) <= np.nearby_radius_km
            OR
            -- Distance from user location to ride destination
            6371 * acos(
                cos(radians(ul.latitude)) 
                * cos(radians(:ride_dest_lat)) 
                * cos(radians(:ride_dest_lng) - radians(ul.longitude)) 
                + sin(radians(ul.latitude)) 
                * sin(radians(:ride_dest_lat))
            ) <= np.nearby_radius_km
        )
    )
)
SELECT u.id, u.name, upt.token
FROM nearby_users nu
JOIN users u ON nu.user_id = u.id
JOIN user_push_tokens upt ON u.id = upt.user_id
WHERE upt.is_active = TRUE;
*/



-- ================================================================
-- Performance Indexes
-- ================================================================

-- Step 1: Core indexes for maximum performance impact
CREATE INDEX IF NOT EXISTS idx_rides_geographic ON rides (origin_lat, origin_lng);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides (status);
CREATE INDEX IF NOT EXISTS idx_rides_departure ON rides (departure_time);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id);

-- Step 2: Essential user and booking indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_id ON users (clerk_id);
CREATE INDEX IF NOT EXISTS idx_bookings_rider ON bookings (rider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings (ride_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);

-- Step 3: Chat system indexes
CREATE INDEX IF NOT EXISTS idx_chat_threads_rider ON chat_threads (rider_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_driver ON chat_threads (driver_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (sender_id);

-- Step 4: Rating and notification indexes
CREATE INDEX IF NOT EXISTS idx_ride_ratings_booking ON ride_ratings (booking_id);
CREATE INDEX IF NOT EXISTS idx_ride_ratings_rater ON ride_ratings (rater_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_clerk ON user_push_tokens (clerk_id);

-- Step 5: Composite indexes for complex queries (most important ones)
CREATE INDEX IF NOT EXISTS idx_rides_feed_main ON rides (status, departure_time, origin_lat, origin_lng);
CREATE INDEX IF NOT EXISTS idx_bookings_rider_time ON bookings (rider_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ride_status ON bookings (ride_id, status, approval_status);

-- Update statistics for query planner
ANALYZE rides;
ANALYZE bookings; 
ANALYZE users;
ANALYZE chat_threads;
ANALYZE chat_messages;
ANALYZE ride_ratings;
ANALYZE user_push_tokens;

-- Verify indexes were created
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;



-- ================================================================
-- DRIVER PAYOUT SYSTEM - Stripe Connect Integration
-- ================================================================


-- 1. Driver Payout Accounts Table
-- Stores Stripe Connect account information for drivers
CREATE TABLE IF NOT EXISTS driver_payout_accounts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Stripe Connect Account
  stripe_connect_account_id VARCHAR(255) NOT NULL,
  account_status            VARCHAR(50) DEFAULT 'pending', -- pending, active, rejected, restricted
  
  -- Bank Account Info (encrypted/hashed for security)
  bank_account_id           VARCHAR(255), -- Stripe external account ID
  bank_name                 VARCHAR(100),
  account_type              VARCHAR(20), -- checking, savings
  last_four_digits          VARCHAR(4),
  routing_number_last_four  VARCHAR(4), -- Last 4 of routing number for display
  
  -- Verification & Compliance
  onboarding_completed      BOOLEAN DEFAULT FALSE,
  onboarding_url            TEXT, -- Stripe onboarding URL
  requirements_due          TEXT[], -- Array of missing requirements
  capabilities_enabled      TEXT[], -- Array of enabled capabilities
  
  -- Account Details
  country                   CHAR(2) DEFAULT 'US', -- ISO country code
  default_currency          CHAR(3) DEFAULT 'USD',
  
  -- Status Tracking
  charges_enabled           BOOLEAN DEFAULT FALSE,
  payouts_enabled           BOOLEAN DEFAULT FALSE,
  details_submitted         BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  stripe_dashboard_url      TEXT, -- Stripe Express dashboard URL
  business_type             VARCHAR(50), -- individual, company
  
  -- Audit
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id), -- One payout account per driver
  UNIQUE(stripe_connect_account_id)
);

-- 2. Payout Transactions Table
-- Tracks all payout requests and their status
CREATE TABLE IF NOT EXISTS payout_transactions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Payout Details
  amount                    NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency                  CHAR(3) NOT NULL DEFAULT 'USD',
  
  -- Stripe References
  stripe_transfer_id        VARCHAR(255), -- Stripe transfer to Connect account
  stripe_payout_id          VARCHAR(255), -- Stripe payout to bank account
  
  -- Status Tracking
  status                    VARCHAR(50) DEFAULT 'pending', 
  -- pending, processing, in_transit, paid, failed, canceled
  
  -- Fee Breakdown
  platform_fee              NUMERIC(10,2) DEFAULT 0,
  stripe_fee                NUMERIC(10,2) DEFAULT 0,
  net_amount                NUMERIC(10,2) GENERATED ALWAYS AS (amount - platform_fee - stripe_fee) STORED,
  
  -- Bank Account Details (snapshot)
  destination_bank_name     VARCHAR(100),
  destination_last_four     VARCHAR(4),
  
  -- Processing Details
  description               TEXT,
  failure_reason            TEXT,
  failure_code              VARCHAR(50),
  expected_arrival_date     DATE,
  processed_at              TIMESTAMPTZ,
  arrived_at                TIMESTAMPTZ,
  
  -- Audit
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Driver Earnings Summary Table
-- Consolidated view of driver earnings and payouts
CREATE TABLE IF NOT EXISTS driver_earnings_summary (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Balance Tracking
  total_earned              NUMERIC(10,2) DEFAULT 0,
  total_withdrawn           NUMERIC(10,2) DEFAULT 0,
  pending_withdrawal        NUMERIC(10,2) DEFAULT 0,
  available_balance         NUMERIC(10,2) GENERATED ALWAYS AS (total_earned - total_withdrawn - pending_withdrawal) STORED,
  
  -- Lifetime Statistics
  total_rides               INTEGER DEFAULT 0,
  total_bookings            INTEGER DEFAULT 0,
  total_riders_served       INTEGER DEFAULT 0,
  average_ride_earnings     NUMERIC(8,2),
  highest_ride_earnings     NUMERIC(8,2),
  
  -- Recent Activity
  current_month_earnings    NUMERIC(10,2) DEFAULT 0,
  last_month_earnings       NUMERIC(10,2) DEFAULT 0,
  current_week_earnings     NUMERIC(10,2) DEFAULT 0,
  
  -- Payout History
  total_payouts             INTEGER DEFAULT 0,
  last_payout_amount        NUMERIC(10,2),
  last_payout_at            TIMESTAMPTZ,
  first_payout_at           TIMESTAMPTZ,
  
  -- Update Tracking
  last_earnings_update      TIMESTAMPTZ,
  last_calculation_at       TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id)
);

-- 4. Payout Settings Table
-- Driver preferences for payouts
CREATE TABLE IF NOT EXISTS driver_payout_settings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Payout Preferences
  auto_payout_enabled       BOOLEAN DEFAULT FALSE,
  auto_payout_threshold     NUMERIC(8,2) DEFAULT 100.00, -- Auto payout when balance reaches this
  payout_schedule           VARCHAR(20) DEFAULT 'manual', -- manual, daily, weekly, monthly
  preferred_payout_day      SMALLINT, -- 1-7 for weekly, 1-31 for monthly
  
  -- Notification Preferences
  notify_on_payout_complete BOOLEAN DEFAULT TRUE,
  notify_on_payout_failed   BOOLEAN DEFAULT TRUE,
  notify_earnings_milestone BOOLEAN DEFAULT TRUE,
  
  -- Security
  require_2fa_for_payouts   BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id),
  CHECK (auto_payout_threshold >= 10.00), -- Minimum $10 threshold
  CHECK (preferred_payout_day IS NULL OR (preferred_payout_day >= 1 AND preferred_payout_day <= 31))
);

-- 5. Indexes for Performance
CREATE INDEX IF NOT EXISTS driver_payout_accounts_user_idx ON driver_payout_accounts(user_id);
CREATE INDEX IF NOT EXISTS driver_payout_accounts_stripe_idx ON driver_payout_accounts(stripe_connect_account_id);
CREATE INDEX IF NOT EXISTS driver_payout_accounts_status_idx ON driver_payout_accounts(account_status);

CREATE INDEX IF NOT EXISTS payout_transactions_user_idx ON payout_transactions(user_id);
CREATE INDEX IF NOT EXISTS payout_transactions_status_idx ON payout_transactions(status);
CREATE INDEX IF NOT EXISTS payout_transactions_created_idx ON payout_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS payout_transactions_stripe_transfer_idx ON payout_transactions(stripe_transfer_id);
CREATE INDEX IF NOT EXISTS payout_transactions_stripe_payout_idx ON payout_transactions(stripe_payout_id);

CREATE INDEX IF NOT EXISTS driver_earnings_summary_user_idx ON driver_earnings_summary(user_id);
CREATE INDEX IF NOT EXISTS driver_earnings_summary_balance_idx ON driver_earnings_summary(available_balance DESC);
CREATE INDEX IF NOT EXISTS driver_earnings_summary_updated_idx ON driver_earnings_summary(last_earnings_update DESC);

CREATE INDEX IF NOT EXISTS driver_payout_settings_user_idx ON driver_payout_settings(user_id);
CREATE INDEX IF NOT EXISTS driver_payout_settings_auto_idx ON driver_payout_settings(auto_payout_enabled) WHERE auto_payout_enabled = TRUE;

-- 6. Triggers to keep updated_at fresh
CREATE TRIGGER set_updated_at_driver_payout_accounts
BEFORE UPDATE ON driver_payout_accounts
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

CREATE TRIGGER set_updated_at_payout_transactions
BEFORE UPDATE ON payout_transactions
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

CREATE TRIGGER set_updated_at_driver_earnings_summary
BEFORE UPDATE ON driver_earnings_summary
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

CREATE TRIGGER set_updated_at_driver_payout_settings
BEFORE UPDATE ON driver_payout_settings
FOR EACH ROW
EXECUTE PROCEDURE trg_set_updated_at();

-- 7. Functions for Earnings Calculation

-- Function to recalculate driver earnings

CREATE OR REPLACE FUNCTION recalculate_driver_earnings(driver_user_id UUID)
RETURNS VOID AS $$
DECLARE
  total_earned_val NUMERIC(10,2) := 0;
  total_withdrawn_val NUMERIC(10,2) := 0;
  pending_withdrawal_val NUMERIC(10,2) := 0;
  total_rides_val INTEGER := 0;
  total_bookings_val INTEGER := 0;
  total_riders_served_val INTEGER := 0;
  avg_ride_earnings_val NUMERIC(8,2) := 0;
  max_ride_earnings_val NUMERIC(8,2) := 0;
  current_month_val NUMERIC(10,2) := 0;
  last_month_val NUMERIC(10,2) := 0;
  current_week_val NUMERIC(10,2) := 0;
  total_payouts_val INTEGER := 0;
  last_payout_amount_val NUMERIC(10,2);
  last_payout_at_val TIMESTAMPTZ;
  first_payout_at_val TIMESTAMPTZ;
BEGIN
  -- Calculate earnings from completed bookings
  SELECT 
    COALESCE(SUM(b.total_price), 0),
    COUNT(DISTINCT r.id),
    COUNT(b.id),
    COUNT(DISTINCT b.rider_id),
    COALESCE(AVG(ride_earnings.earnings), 0),
    COALESCE(MAX(ride_earnings.earnings), 0),
    COALESCE(SUM(CASE WHEN b.created_at >= date_trunc('month', CURRENT_DATE) THEN b.total_price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN b.created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') 
                     AND b.created_at < date_trunc('month', CURRENT_DATE) THEN b.total_price ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN b.created_at >= date_trunc('week', CURRENT_DATE) THEN b.total_price ELSE 0 END), 0)
  INTO total_earned_val, total_rides_val, total_bookings_val, total_riders_served_val, 
       avg_ride_earnings_val, max_ride_earnings_val, current_month_val, last_month_val, current_week_val
  FROM rides r
  LEFT JOIN bookings b ON r.id = b.ride_id AND b.status = 'completed'
  LEFT JOIN (
    SELECT 
      r2.id as ride_id,
      SUM(b2.total_price) as earnings
    FROM rides r2
    LEFT JOIN bookings b2 ON r2.id = b2.ride_id AND b2.status = 'completed'
    WHERE r2.driver_id = driver_user_id
    GROUP BY r2.id
  ) ride_earnings ON r.id = ride_earnings.ride_id
  WHERE r.driver_id = driver_user_id;

  -- Get total withdrawn amount
  SELECT COALESCE(SUM(net_amount), 0) 
  INTO total_withdrawn_val
  FROM payout_transactions
  WHERE user_id = driver_user_id AND status IN ('paid', 'in_transit');

  -- Get pending withdrawal amount
  SELECT COALESCE(SUM(net_amount), 0) 
  INTO pending_withdrawal_val
  FROM payout_transactions
  WHERE user_id = driver_user_id AND status IN ('pending', 'processing');

  -- Get payout statistics
  SELECT 
    COUNT(*),
    MAX(net_amount),
    MAX(processed_at),
    MIN(processed_at)
  INTO total_payouts_val, last_payout_amount_val, last_payout_at_val, first_payout_at_val
  FROM payout_transactions
  WHERE user_id = driver_user_id AND status IN ('paid', 'in_transit');

  -- Upsert earnings summary
  INSERT INTO driver_earnings_summary (
    user_id, total_earned, total_withdrawn, pending_withdrawal,
    total_rides, total_bookings, total_riders_served,
    average_ride_earnings, highest_ride_earnings,
    current_month_earnings, last_month_earnings, current_week_earnings,
    total_payouts, last_payout_amount, last_payout_at, first_payout_at,
    last_earnings_update, last_calculation_at
  ) VALUES (
    driver_user_id, 
    total_earned_val,
    total_withdrawn_val,
    pending_withdrawal_val,
    total_rides_val,
    total_bookings_val,
    total_riders_served_val,
    avg_ride_earnings_val,
    max_ride_earnings_val,
    current_month_val,
    last_month_val,
    current_week_val,
    total_payouts_val,
    last_payout_amount_val,
    last_payout_at_val,
    first_payout_at_val,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_earned = EXCLUDED.total_earned,
    total_withdrawn = EXCLUDED.total_withdrawn,
    pending_withdrawal = EXCLUDED.pending_withdrawal,
    total_rides = EXCLUDED.total_rides,
    total_bookings = EXCLUDED.total_bookings,
    total_riders_served = EXCLUDED.total_riders_served,
    average_ride_earnings = EXCLUDED.average_ride_earnings,
    highest_ride_earnings = EXCLUDED.highest_ride_earnings,
    current_month_earnings = EXCLUDED.current_month_earnings,
    last_month_earnings = EXCLUDED.last_month_earnings,
    current_week_earnings = EXCLUDED.current_week_earnings,
    total_payouts = EXCLUDED.total_payouts,
    last_payout_amount = EXCLUDED.last_payout_amount,
    last_payout_at = EXCLUDED.last_payout_at,
    first_payout_at = EXCLUDED.first_payout_at,
    last_earnings_update = NOW(),
    last_calculation_at = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 8. Initialize earnings summary for existing drivers
INSERT INTO driver_earnings_summary (user_id)
SELECT id FROM users 
WHERE is_driver = TRUE 
  AND id NOT IN (SELECT user_id FROM driver_earnings_summary)
ON CONFLICT (user_id) DO NOTHING;

-- 9. Initialize payout settings for existing drivers
INSERT INTO driver_payout_settings (user_id)
SELECT id FROM users 
WHERE is_driver = TRUE 
  AND id NOT IN (SELECT user_id FROM driver_payout_settings)
ON CONFLICT (user_id) DO NOTHING;

-- 10. Create view for quick earnings lookup
CREATE OR REPLACE VIEW driver_earnings_overview AS
SELECT 
  u.id as user_id,
  u.clerk_id,
  u.first_name,
  u.last_name,
  u.verification_status,
  des.available_balance,
  des.total_earned,
  des.total_withdrawn,
  des.pending_withdrawal,
  des.total_rides,
  des.current_month_earnings,
  des.last_payout_at,
  dpa.account_status as payout_account_status,
  dpa.payouts_enabled,
  dpa.onboarding_completed,
  CASE 
    WHEN u.verification_status = 'verified' AND dpa.payouts_enabled = TRUE THEN TRUE
    ELSE FALSE
  END as can_withdraw
FROM users u
LEFT JOIN driver_earnings_summary des ON u.id = des.user_id
LEFT JOIN driver_payout_accounts dpa ON u.id = dpa.user_id
WHERE u.is_driver = TRUE;