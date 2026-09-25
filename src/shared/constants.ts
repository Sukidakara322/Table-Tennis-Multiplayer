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
 * Magnus effect: a = MAGNUS_K * (spin × v). Still generous — the slower ball turns the same curve into
 * a much longer arc, so topspin dips hard, backspin floats and sidespin bends visibly — but not so
 * generous that a heavy cut simply beats gravity. That is the ceiling on this number, and it is a hard
 * one: gravity here is a quarter of the real thing (see BALL_SLOWDOWN), so at MAX_SPIN and rally pace
 * anything much above this lifts a backspin ball more than gravity pulls it down, and it flies off the
 * end of the table without ever coming back. No stroke and no aim can save a ball that never lands.
 */
export const MAGNUS_K = 0.002;
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
 * The one depth a player is ever at. The racket is held on a plane here, just behind their own end
 * line, and it never leaves it: the mouse moves the blade across the plane and nothing in the game
 * moves it for them, not to chase a ball and not between shots. A racket that is only ever where the
 * player put it is the whole point — it is what makes reaching a ball an act rather than a gift, and
 * it keeps the blade still under the hand instead of sliding out from under a stroke mid-rally.
 *
 * Far enough back that any legal ball has bounced before it arrives, so nothing is volleyed by
 * accident, and no further: a ball dying in front of this plane simply cannot be played, and every
 * centimetre added here is another ball nobody could have reached.
 */
export const STAND_Z = HALF_LENGTH + 0.08;
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
 * The ball waits just in front of the racket until it is struck, following it sideways so the server
 * chooses where to serve from without the racket having to leave its plane. Flicking up through it
 * serves with topspin, flicking down cuts under it for backspin.
 */
export const SERVE_BALL_Z = STAND_Z - 0.14;
/**
 * And it waits low, at one fixed height, rather than riding up and down with the blade. A serve is
 * struck out over the table with barely a metre of your own half in front of it, so the higher it
 * starts the less room there is to put the first bounce anywhere legal: from here every swing can be
 * served, and a hand's width higher most of them have nowhere to go. Serving is therefore something
 * you come down to the ball to do, which is what a serve is.
 */
export const SERVE_BALL_HEIGHT = 0.12;
/**
 * Where the server's racket starts the point: high enough that the ball is plainly visible below the
 * blade rather than hidden behind it. The view looks down the table at a shallow angle, so a ball only
 * a little below the racket and a little beyond it sits inside the blade's own silhouette — and being
 * told to bring the racket down to a ball you cannot see is no instruction at all.
 */
export const SERVE_READY_Y = 0.42;
/**
 * How fast the mouse must sweep to strike the waiting ball. A serve is a deliberate flick and nothing
 * else: about a third of the racket's plane crossed in a tenth of a second, far past anything that
 * settling the racket where you want to serve from could do by accident.
 */
export const SERVE_MIN_FLICK = 1.8;
/**
 * How near the waiting ball the racket has to be to strike it. Wide enough to reach from where the
 * racket starts the point, and narrow enough that one held up at the top of its plane has to be
 * brought down to the ball first — which is the one thing a serve asks of you.
 */
export const SERVE_REACH = 0.34;
