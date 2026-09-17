/**
 * World units are metres. Origin is the centre of the table surface, y points up.
 * Player 0 stands at +z, player 1 at -z.
 */

// Table (ITTF dimensions)
export const TABLE_LENGTH = 2.74;
export const TABLE_WIDTH = 1.525;
export const HALF_LENGTH = TABLE_LENGTH / 2;
export const HALF_WIDTH = TABLE_WIDTH / 2;
export const TABLE_HEIGHT = 0.76;
export const TABLE_THICKNESS = 0.03;
export const FLOOR_Y = -TABLE_HEIGHT;
export const NET_HEIGHT = 0.1525;
export const NET_HALF_SPAN = HALF_WIDTH + 0.1525;
export const NET_CORD_RADIUS = 0.005;

// Ball
export const BALL_RADIUS = 0.02;

// Simulation
export const PHYSICS_HZ = 240;
export const DT = 1 / PHYSICS_HZ;
export const MAX_SUBSTEPS = 32;

// Forces. Only + - * / and sqrt are used in the step so results match across JS engines.
export const GRAVITY = 9.81;
/** Air drag: a = -DRAG_K * |v| * v */
export const DRAG_K = 0.11;
/** Magnus effect: a = MAGNUS_K * (spin × v) */
export const MAGNUS_K = 0.0035;
/** Per-step spin decay, roughly 10% per second. */
export const SPIN_DAMPING = 0.99958;
export const MAX_SPIN = 600;

// Contacts
export const TABLE_RESTITUTION = 0.9;
export const TABLE_FRICTION = 0.45;
export const FLOOR_RESTITUTION = 0.55;
export const FLOOR_FRICTION = 0.8;
export const NET_CORD_RESTITUTION = 0.35;
export const NET_BODY_RESTITUTION = 0.12;
/** Impacts slower than this settle the ball instead of bouncing (and emit no event). */
export const REST_SPEED = 0.15;

// Paddle zone, expressed in a player's local frame (own end of the table at +z)
export const PADDLE_VISUAL_RADIUS = 0.078;
/** What you see is what you hit: the ball's centre must pass within the drawn blade plus the ball's radius. */
export const PADDLE_HIT_RADIUS = PADDLE_VISUAL_RADIUS + BALL_RADIUS;
/**
 * Depth is not steered: the paddle travels with the incoming ball within this reach, so paddle and ball
 * are always at the same depth and what overlaps on screen is exactly what touches. The reach starts at
 * the end line (no accidental volleys) and ends where the camera can still show low paddle positions.
 */
export const REACH_NEAR_Z = HALF_LENGTH + 0.03;
export const REACH_FAR_Z = HALF_LENGTH + 0.6;

/** The viewer's eye, in the viewer's local frame. Shared so the mouse mapping matches what is drawn. */
export const VIEW_EYE_Y = 1.6;
export const VIEW_EYE_Z = HALF_LENGTH + 2.3;
/**
 * The mouse aims the paddle on this plane (the start of the reach): x ±AIM_X_LIMIT and height
 * AIM_Y_MIN..AIM_Y_MAX across the whole mouse range. At any other depth the paddle stays on the same
 * line of sight from the eye, so it never slides on screen while it travels with the ball.
 */
export const AIM_PLANE_Z = REACH_NEAR_Z;
export const AIM_X_LIMIT = 1.7;
export const AIM_Y_MIN = -0.45;
export const AIM_Y_MAX = 0.75;
/** Hard world bounds for the paddle wherever it is. */
export const PADDLE_X_LIMIT = 1.8;
export const PADDLE_Y_MIN = -0.5;
export const PADDLE_Y_MAX = 1.0;
/** Speed at which the paddle glides back to the start of its reach when not riding with the ball. */
export const PADDLE_DEPTH_RETURN_SPEED = 6;
export const PADDLE_READY_HEIGHT = 0.3;
/**
 * Arm arc: reaching wide or very high/low pulls the paddle back towards the body by up to this much,
 * so the paddle moves on a curved surface around the player rather than a flat plane.
 */
export const ARM_ARC_DEPTH = 0.25;
/** Comfortable reach from the body centre before the arc is fully bent (sideways, vertically). */
export const ARM_REACH_X = 0.8;
export const ARM_REACH_Y = 0.45;
/** The body shuffles after the paddle: it covers ~63% of the gap in this many seconds. */
export const BODY_FOLLOW_TIME = 0.4;
/** A player can't touch the ball again this soon after their own stroke. */
export const HIT_COOLDOWN = 0.3;

// Serve
/** The ball is tossed from this depth behind the end line; the server's paddle sits at the same depth. */
export const SERVE_BALL_Z = HALF_LENGTH + 0.15;
/** Before the toss the ball rests this far above the paddle and follows it. */
export const TOSS_HEIGHT_ABOVE_PADDLE = 0.12;
/** Launch speed of the serve toss: rises ~0.8 m above the hand (ITTF minimum is 0.16 m). */
export const TOSS_SPEED = 4.0;
