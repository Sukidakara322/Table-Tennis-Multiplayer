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
/**
 * Below real gravity on purpose. Every launch speed is divided by BALL_SLOWDOWN and gravity by its
 * square, which is exactly the scaling that leaves the shape of every trajectory untouched while each
 * flight takes that much longer: the same strokes, the same arcs, the same landing spots, but time to
 * read the spin and shape a stroke instead of a ball that crosses the table the moment it is hit.
 */
export const BALL_SLOWDOWN = 1.4;
export const GRAVITY = 9.81 / (BALL_SLOWDOWN * BALL_SLOWDOWN);
/** Air drag: a = -DRAG_K * |v| * v */
export const DRAG_K = 0.11;
/**
 * Magnus effect: a = MAGNUS_K * (spin × v). Generous on purpose: with the slower ball it gives topspin a
 * clear dip, backspin a floating "parachute" and sidespin a bend you can see and play with.
 */
export const MAGNUS_K = 0.006;
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
export const REST_SPEED = 0.15 / BALL_SLOWDOWN;

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
/**
 * How far over the table you can follow a ball that has already bounced on your half, so a short ball
 * dying before the end line can still be played. Only after the bounce, so reaching in can never become
 * a volley, and only as fast as REACH_IN_SPEED: leaning in over the table costs time, it is not free.
 */
export const REACH_IN_Z = REACH_NEAR_Z - 0.95;
export const REACH_IN_SPEED = 3.5;

/**
 * The viewer's eye, in the viewer's local frame. Shared so the mouse mapping matches what is drawn.
 * Standing close behind your own end and looking down on the table (~28°) is what makes it read as a
 * long table: the far end then looks about 40% as wide as the near one, where a camera parked metres
 * back flattens it to 55% however narrow the lens. The lens zooms back out instead (see `fitLens`).
 */
export const VIEW_EYE_Y = 1.25;
export const VIEW_EYE_Z = HALF_LENGTH + 1.6;
/**
 * The mouse aims the paddle on this plane (the start of the reach). The cursor is projected onto it
 * through the camera, so the paddle moves pixel for pixel with the mouse; the limits below are just
 * how far it can go. At any other depth the paddle stays on the same line of sight from the eye, so it
 * never slides on screen while it travels with the ball.
 */
export const AIM_PLANE_Z = REACH_NEAR_Z;
/** Sideways reach: the table's half width plus a step outside it, and all of it fits on screen. */
export const AIM_X_LIMIT = 0.85;
/** Height range: low enough to dig out a low ball, capped so swings stay controlled. */
export const AIM_Y_MIN = -0.3;
export const AIM_Y_MAX = 0.55;
/** Hard world bounds for the paddle wherever it is. */
export const PADDLE_X_LIMIT = 0.95;
export const PADDLE_Y_MIN = -0.35;
export const PADDLE_Y_MAX = 0.6;
/** Speed at which the paddle glides back to the start of its reach when not riding with the ball. */
export const PADDLE_DEPTH_RETURN_SPEED = 6;
export const PADDLE_READY_HEIGHT = 0.3;
/**
 * Arm arc: reaching wide or very high/low pulls the paddle back towards the body by up to this much,
 * so the paddle moves on a curved surface around the player rather than a flat plane. Kept small: it
 * shifts where the reach starts, and a big shift used to pull the paddle off a ball mid-stroke.
 */
export const ARM_ARC_DEPTH = 0.08;
/** Comfortable reach from the body centre before the arc is fully bent (sideways, vertically). */
export const ARM_REACH_X = 0.8;
export const ARM_REACH_Y = 0.45;
/** The body shuffles after the paddle: it covers ~63% of the gap in this many seconds. */
export const BODY_FOLLOW_TIME = 0.4;
/** A player can't touch the ball again this soon after their own stroke. */
export const HIT_COOLDOWN = 0.3;

// Serve
/**
 * The ball waits here until it is struck: behind the end line, at a fixed height, and following the
 * server sideways so they choose where to serve from. Moving the paddle up or down through it serves.
 */
export const SERVE_BALL_Z = HALF_LENGTH + 0.15;
export const SERVE_BALL_HEIGHT = 0.3;
/** How fast the paddle must be moving up or down to strike the waiting ball. */
export const SERVE_MIN_FLICK = 1.2;
