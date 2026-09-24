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
export const BALL_SLOWDOWN = 1.75;
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
 * How far up the table a player can be. They stand at the end line and hold the racket in front of
 * them; the only thing that moves them is stepping in for a ball dying short of the line, which the
 * game does for them, since nobody can choose to stand in two places at once.
 */
export const REACH_NEAR_Z = HALF_LENGTH + 0.03;
export const REACH_FAR_Z = HALF_LENGTH + 0.6;
/** Furthest in over the table the racket can be pushed, for a short ball dying near the net. */
export const REACH_IN_Z = REACH_NEAR_Z - 0.95;
/**
 * The racket is held in front of you, at one fixed distance, and the mouse moves it freely across
 * that plane: sideways and up and down. Depth is not yours to steer — you stand where you stand and
 * the ball comes to you — so the only question a stroke asks is where on the plane the racket is and
 * how it is moving when the ball arrives.
 */
export const AIM_X_LIMIT = 0.85;
export const AIM_Y_MIN = 0.05;
export const AIM_Y_MAX = 0.62;
/** Where the blade rides with nothing asked of it: the middle of the plane, where the face is square. */
export const PADDLE_HOVER_Y = (AIM_Y_MIN + AIM_Y_MAX) / 2;

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
export const SERVE_BALL_Z = HALF_LENGTH + 0.08;
export const SERVE_BALL_HEIGHT = PADDLE_HOVER_Y + 0.06;
/**
 * How fast the mouse must sweep to strike the waiting ball. The ball rides at the racket's own height
 * while it waits, so the racket can never run into it by standing somewhere: a serve is a deliberate
 * flick and nothing else. Set high enough — about a third of the racket's plane crossed in a tenth of
 * a second — that settling the racket where you want to serve from never strikes the ball by accident.
 */
export const SERVE_MIN_FLICK = 1.8;
/** Where the player stands: ready behind the end line, and just behind the ball when serving. */
export const READY_STAND_Z = REACH_NEAR_Z + 0.1;
export const SERVE_STAND_Z = SERVE_BALL_Z + 0.12;
/** How fast a player steps in for a short ball. Quick, because there is never much time. */
export const STEP_IN_SPEED = 4;
/** How far from the waiting ball the racket can be and still strike it: it is held against the bat. */
export const SERVE_REACH = 0.3;
