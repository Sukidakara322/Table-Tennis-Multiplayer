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
export const MAGNUS_K = 0.0035;
/** Per-step spin decay, roughly 10% per second. */
export const SPIN_DAMPING = 0.99958;
export const MAX_SPIN = 400;

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
 * Depth is steered by the player: the mouse moves the racket around the table, sideways and towards or
 * away from the net. Nothing follows the ball on its own, so a ball is only met where the player puts
 * the racket, and the stroke is that same forward or backward motion.
 */
export const REACH_NEAR_Z = HALF_LENGTH + 0.03;
export const REACH_FAR_Z = HALF_LENGTH + 0.6;
/** Furthest in over the table the racket can be pushed, for a short ball dying near the net. */
export const REACH_IN_Z = REACH_NEAR_Z - 0.95;
/**
 * The racket does not slide around at one height: it runs up a ramp. Down by the net it skims the
 * table, and it rises as it is drawn back behind the end line, the way a bat sits higher when you
 * stand off the table and comes down as you step in. That slope is what gives height its meaning —
 * a ball still climbing is met back where the blade is high, a short low one by stepping in.
 */
export const PADDLE_HOVER_Y = 0.17;
export const PADDLE_LOW_Y = 0.09;
export const PADDLE_HIGH_Y = 0.42;
/**
 * Kept gentle on purpose. The stroke itself runs along this slope, so every centimetre of it also
 * moves the blade up or down: too steep and driving through the ball slides the bat out from under it,
 * turning a well-placed stroke into a miss over a few hundredths of a second.
 */
export const PADDLE_RAMP_SLOPE = 0.25;

/** Height of the blade's centre when the racket stands at `z`, before any stroke lifts it. */
export function hoverAt(z: number): number {
  const ramped = PADDLE_HOVER_Y + (z - REACH_NEAR_Z) * PADDLE_RAMP_SLOPE;
  return ramped < PADDLE_LOW_Y ? PADDLE_LOW_Y : ramped > PADDLE_HIGH_Y ? PADDLE_HIGH_Y : ramped;
}

/**
 * How far a stroke reaches above and below the blade itself. A real stroke is not a flat slide: the
 * racket rises through the ball, so it covers a band of heights rather than one. That band is what
 * makes height playable at all — where a ball has got to by the time it reaches you depends on where
 * it bounced, and varies by far more than the blade is wide, so a racket that only struck at its own
 * exact height would be beaten by half the balls that came at it however well it was placed. Where
 * you stand along the table and how you meet the ball are yours to judge, and both are plain to see;
 * a few centimetres of height in a shallow view are neither, so the stroke covers them.
 */
export const STROKE_SWEEP = 0.14;

/**
 * The viewer's eye, in the viewer's local frame. Shared so the mouse mapping matches what is drawn.
 * Standing close behind your own end and looking down on the table (~28°) is what makes it read as a
 * long table: the far end then looks about 40% as wide as the near one, where a camera parked metres
 * back flattens it to 55% however narrow the lens. The lens zooms back out instead (see `fitLens`).
 */
export const VIEW_EYE_Y = 1.25;
export const VIEW_EYE_Z = HALF_LENGTH + 1.6;
/**
 * The mouse moves the racket on the table: the cursor is projected onto the blade's hovering plane
 * through the camera, so pointing at a spot on the table puts the racket there. `aim.x` is sideways and
 * `aim.y` is how far forward of the back of the reach it stands, so pushing the mouse away drives the
 * racket towards the net and pulling it back draws the racket away — which is also the stroke.
 */
/** Sideways reach: the table's half width plus a step outside it, and all of it fits on screen. */
export const AIM_X_LIMIT = 0.85;
/** Forward reach, from standing right back to leaning in over the table. */
export const AIM_FORWARD_MIN = 0;
export const AIM_FORWARD_MAX = REACH_FAR_Z - REACH_IN_Z;
/** Where the racket rests along the table when the mouse is centred. */
export const PADDLE_READY_FORWARD = REACH_FAR_Z - REACH_NEAR_Z;
/** Hard world bounds for the paddle wherever it is. */
export const PADDLE_X_LIMIT = 0.95;
/** The body shuffles after the paddle: it covers ~63% of the gap in this many seconds. */
export const BODY_FOLLOW_TIME = 0.4;
/** A player can't touch the ball again this soon after their own stroke. */
export const HIT_COOLDOWN = 0.3;

// Serve
/**
 * The ball waits here until it is struck: in front of the server at blade height, following them
 * sideways so they choose where to serve from. Driving the racket forward through it serves with
 * topspin, dragging the racket back through it cuts under the ball for backspin.
 */
export const SERVE_BALL_Z = HALF_LENGTH + 0.15;
export const SERVE_BALL_HEIGHT = PADDLE_HOVER_Y + 0.06;
/** How fast the racket must be travelling along the table to strike the waiting ball. */
export const SERVE_MIN_FLICK = 1.2;
/** How far from the waiting ball the racket can be and still strike it: it is held against the bat. */
export const SERVE_REACH = 0.45;
